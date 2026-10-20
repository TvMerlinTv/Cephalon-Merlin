import { useState } from 'react';
import { ExternalLink, Youtube, Copy } from 'lucide-react';
import { openExternal } from '../lib/api.js';
import { useT } from '../lib/i18n.js';

// Kleiner, sicherer Markdown-Renderer für Build-Guides von overframe.gg.
// Baut nur React-Elemente (kein innerHTML): HTML im Text erscheint als Text,
// Links öffnen nur über openExternal (Main-Prozess erlaubt nur bekannte Hosts).

// Hosts, die openExternal im Main-Prozess öffnet (electron/main.cjs EXTERNAL_HOSTS)
const OPENABLE = new Set(['overframe.gg', 'www.youtube.com', 'wiki.warframe.com', 'warframe.market', 'github.com', 'www.warframe.com']);

/** Wohin führt ein Link? { kind: 'build' | 'open' | 'copy', url, id? } */
export function linkTarget(href) {
  try {
    const u = new URL(href.trim(), 'https://overframe.gg');
    if (!/^https?:$/.test(u.protocol)) return null;
    u.protocol = 'https:';
    let host = u.hostname.toLowerCase();
    if (host === 'youtu.be') {
      const id = u.pathname.slice(1);
      return { kind: 'open', url: `https://www.youtube.com/watch?v=${encodeURIComponent(id)}` };
    }
    if (host === 'youtube.com' || host === 'm.youtube.com') host = 'www.youtube.com';
    if (host === 'www.overframe.gg') host = 'overframe.gg';
    u.hostname = host;
    const build = host === 'overframe.gg' && /^\/build\/(\d+)/.exec(u.pathname);
    if (build) return { kind: 'build', id: Number(build[1]), url: u.toString() };
    return { kind: OPENABLE.has(host) ? 'open' : 'copy', url: u.toString() };
  } catch {
    return null;
  }
}

const youtubeUrl = (id) => `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;

function Link({ href, children, onOpenBuild }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const target = linkTarget(href);
  if (!target) return <span>{children}</span>;
  if (target.kind === 'copy') {
    // Fremde Seiten öffnet die App nicht – Link stattdessen kopieren
    const copy = () => {
      if (window.wf?.copyText) window.wf.copyText(target.url);
      else navigator.clipboard?.writeText(target.url).catch(() => {});
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    };
    return (
      <button className="md-link md-link-copy" onClick={copy} title={`${t('Externer Link – klicken zum Kopieren')}\n${target.url}`}>
        {children}
        <Copy size={11} />
        {copied && <small className="md-copied">{t('Kopiert')}</small>}
      </button>
    );
  }
  const open = () => (target.kind === 'build' && onOpenBuild ? onOpenBuild(target.id) : openExternal(target.url));
  return (
    <button className="md-link" onClick={open} title={target.url}>
      {children}
      {target.kind === 'open' && <ExternalLink size={11} />}
    </button>
  );
}

function YoutubeLink({ id }) {
  const t = useT();
  return (
    <button className="md-link md-youtube" onClick={() => openExternal(youtubeUrl(id))} title={youtubeUrl(id)}>
      <Youtube size={15} /> {t('Video auf YouTube ansehen')}
    </button>
  );
}

// ---------- Inline ----------
const INLINE_SRC = new RegExp(
  [
    '`([^`]+)`', // 1 Code
    '!\\[([^\\]]*)\\]\\(\\s*([^)\\s]+)[^)]*\\)', // 2,3 Bild
    '\\[\\[\\s*youtube\\s+id\\s*=\\s*["\u201c\u201d]?([\\w-]+)["\u201c\u201d]?\\s*\\]\\]', // 4 YouTube-Tag
    '\\[\\[([^\\]]*)\\]\\]', // 5 andere Overframe-Tags
    '\\[([^\\]]+)\\]\\(\\s*([^)\\s]+)[^)]*\\)', // 6,7 Link
    '\\*\\*(.+?)\\*\\*', // 8 fett
    '__(.+?)__', // 9 fett
    '~~(.+?)~~', // 10 durchgestrichen
    '\\*(?!\\s)(.+?)\\*', // 11 kursiv
    '(?<![\\w])_(?!\\s)(.+?)_(?![\\w])', // 12 kursiv
    '(https?://[^\\s<>()\\]]+[^\\s<>()\\].,;:!?\'"])', // 13 nackte URL
  ].join('|'),
);

function inline(text, ctx, keyBase = 'i') {
  const out = [];
  let last = 0;
  let k = 0;
  const key = () => `${keyBase}-${k++}`;
  // Eigene Instanz pro Aufruf: die Rekursion (fett in Links …) darf lastIndex nicht verstellen
  const re = new RegExp(INLINE_SRC.source, 'g');
  for (let m; (m = re.exec(text)); ) {
    if (!m[0]) {
      re.lastIndex++;
      continue;
    }
    if (m.index > last) out.push(text.slice(last, m.index));
    last = re.lastIndex;
    if (m[1] != null) out.push(<code key={key()}>{m[1]}</code>);
    else if (m[3] != null) {
      const target = linkTarget(m[3]);
      if (target) out.push(<img key={key()} className="md-img" src={target.url} alt={m[2]} loading="lazy" referrerPolicy="no-referrer" />);
    } else if (m[4] != null) out.push(<YoutubeLink key={key()} id={m[4]} />);
    else if (m[5] != null) out.push(<span key={key()} className="muted">{m[5].trim()}</span>);
    else if (m[6] != null)
      out.push(
        <Link key={key()} href={m[7]} onOpenBuild={ctx.onOpenBuild}>
          {inline(m[6], ctx, key())}
        </Link>,
      );
    else if (m[8] != null || m[9] != null) out.push(<b key={key()}>{inline(m[8] ?? m[9], ctx, key())}</b>);
    else if (m[10] != null) out.push(<s key={key()}>{inline(m[10], ctx, key())}</s>);
    else if (m[11] != null || m[12] != null) out.push(<i key={key()}>{inline(m[11] ?? m[12], ctx, key())}</i>);
    else if (m[13] != null)
      out.push(
        <Link key={key()} href={m[13]} onOpenBuild={ctx.onOpenBuild}>
          {m[13].replace(/^https?:\/\/(www\.)?/, '')}
        </Link>,
      );
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

// Zeilen eines Absatzes mit Zeilenumbruch verbinden
function lines(list, ctx, keyBase) {
  return list.flatMap((l, i) => (i ? [<br key={`${keyBase}-br${i}`} />, ...inline(l, ctx, `${keyBase}-${i}`)] : inline(l, ctx, `${keyBase}-${i}`)));
}

// ---------- Blöcke ----------
const RE = {
  fence: /^\s*(```|~~~)/,
  heading: /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/,
  hr: /^\s{0,3}([-*_])(\s*\1){2,}\s*$/,
  quote: /^\s{0,3}>\s?(.*)$/,
  list: /^(\s*)([-*+]|\d+[.)])\s+(.*)$/,
  tableRow: /^\s*\|.*\|\s*$/,
  tableSep: /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/,
};
const cells = (row) => row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

function blocks(src, ctx, keyBase = 'b') {
  const ls = src.split('\n');
  const out = [];
  let k = 0;
  const key = () => `${keyBase}-${k++}`;
  let i = 0;
  while (i < ls.length) {
    const line = ls[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    if (RE.fence.test(line)) {
      const fence = RE.fence.exec(line)[1];
      const body = [];
      i++;
      while (i < ls.length && !ls[i].trim().startsWith(fence)) body.push(ls[i++]);
      i++;
      out.push(
        <pre key={key()}>
          <code>{body.join('\n')}</code>
        </pre>,
      );
      continue;
    }
    let m = RE.heading.exec(line);
    if (m) {
      const H = `h${Math.min(6, m[1].length + 2)}`; // # -> h3, damit es unter den Seitentitel passt
      out.push(<H key={key()}>{inline(m[2], ctx, key())}</H>);
      i++;
      continue;
    }
    if (RE.hr.test(line)) {
      out.push(<hr key={key()} />);
      i++;
      continue;
    }
    if (RE.quote.test(line)) {
      const body = [];
      while (i < ls.length && RE.quote.test(ls[i])) body.push(RE.quote.exec(ls[i++])[1]);
      out.push(<blockquote key={key()}>{blocks(body.join('\n'), ctx, key())}</blockquote>);
      continue;
    }
    if (RE.tableRow.test(line) && RE.tableSep.test(ls[i + 1] ?? '')) {
      const head = cells(line);
      i += 2;
      const rows = [];
      while (i < ls.length && RE.tableRow.test(ls[i])) rows.push(cells(ls[i++]));
      out.push(
        <div className="md-table" key={key()}>
          <table>
            <thead>
              <tr>
                {head.map((c, j) => (
                  <th key={j}>{inline(c, ctx, `${keyBase}-th${j}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri}>
                  {r.map((c, j) => (
                    <td key={j}>{inline(c, ctx, `${keyBase}-td${ri}-${j}`)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    m = RE.list.exec(line);
    if (m) {
      const ordered = /\d/.test(m[2]);
      const items = [];
      while (i < ls.length) {
        const lm = RE.list.exec(ls[i]);
        if (lm) {
          items.push([lm[3]]);
          i++;
        } else if (ls[i].trim() && /^\s+/.test(ls[i]) && items.length) {
          items[items.length - 1].push(ls[i++].trim()); // Fortsetzungszeile
        } else if (!ls[i].trim() && RE.list.test(ls[i + 1] ?? '')) {
          i++; // Leerzeile zwischen Punkten
        } else break;
      }
      const L = ordered ? 'ol' : 'ul';
      out.push(
        <L key={key()}>
          {items.map((it, j) => (
            <li key={j}>{lines(it, ctx, `${keyBase}-li${k}-${j}`)}</li>
          ))}
        </L>,
      );
      continue;
    }
    // Absatz bis zur nächsten Leerzeile oder einem anderen Block
    const para = [];
    while (
      i < ls.length &&
      ls[i].trim() &&
      !RE.fence.test(ls[i]) &&
      !RE.heading.test(ls[i]) &&
      !RE.hr.test(ls[i]) &&
      !RE.quote.test(ls[i]) &&
      !RE.list.test(ls[i]) &&
      !(RE.tableRow.test(ls[i]) && RE.tableSep.test(ls[i + 1] ?? ''))
    )
      para.push(ls[i++]);
    out.push(<p key={key()}>{lines(para, ctx, key())}</p>);
  }
  return out;
}

// HTML-Schnipsel entschärfen: <br> wird Zeilenumbruch, andere Tags fallen weg (Inhalt bleibt)
function clean(text) {
  return (text ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?[a-z][^>]*>/gi, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

export default function Markdown({ text, onOpenBuild }) {
  return <div className="md">{blocks(clean(text), { onOpenBuild })}</div>;
}
