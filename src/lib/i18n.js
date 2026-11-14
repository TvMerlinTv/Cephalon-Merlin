// Übersetzungen: Schlüssel ist der deutsche Text, so bleibt der Code lesbar und alles,
// was (noch) nicht übersetzt ist, erscheint einfach auf Deutsch.
// Platzhalter: t('{n} weitere', { n: 5 }). t() ist reaktiv (liest settings.language).
import { settings } from './settings.js';
import EN_OLD from './i18n-en.js';
import EN_RS from './i18n-en-rs.js';

const EN = { ...EN_OLD, ...EN_RS };

const DICTS = { en: EN };

export function translate(lang, text, vars) {
  let out = DICTS[lang]?.[text] ?? text;
  if (vars) for (const [k, v] of Object.entries(vars)) out = out.replaceAll(`{${k}}`, v);
  return out;
}

export const t = (text, vars) => translate(settings.language, text, vars);

/** Zahl im Format der eingestellten Sprache. */
export const num = (n) => (n == null ? '–' : Number(n).toLocaleString(settings.language === 'en' ? 'en-US' : 'de-DE'));

// Fehlertexte aus dem Rust-Teil sind deutsch. Feste Texte stehen im Wörterbuch; Texte mit
// eingesetzten Werten ("HTTP 503 für /v2/items") werden über diese Muster übersetzt.
const ERROR_PATTERNS = [
  [/^HTTP (\d{3}) für (.+)$/, 'HTTP $1 for $2'],
  [/^Item-Datenbank: HTTP (\d{3}) für (.+)$/, 'Item database: HTTP $1 for $2'],
  [/^GitHub antwortet mit HTTP (\d{3})$/, 'GitHub responded with HTTP $1'],
  [/^Download fehlgeschlagen \(HTTP (\d{3})\)$/, 'Download failed (HTTP $1)'],
  [/^Warframe-API antwortete mit HTTP (\d{3})\. Später erneut versuchen\.$/, 'The Warframe API responded with HTTP $1. Try again later.'],
  [/^Leser fehlgeschlagen: (.+)$/, 'Reader failed: $1'],
  [/^Neustart fehlgeschlagen: (.+)$/, 'Restart failed: $1'],
  [/^Update speichern: (.+)$/, 'Saving the update: $1'],
  [/^Alte Version beiseitelegen: (.+)$/, 'Moving the old version aside: $1'],
  [/^Neue Version einsetzen: (.+)$/, 'Putting the new version in place: $1'],
];

export function translateError(lang, e) {
  const msg = String(e?.message ?? e ?? '');
  if (lang !== 'en' || !msg) return msg;
  // "… (retryAt 1794…)" vom Markt: Zusatz behalten
  const m = / \(retryAt \d+\)$/.exec(msg);
  const core = m ? msg.slice(0, m.index) : msg;
  if (EN[core]) return EN[core] + (m ? m[0] : '');
  for (const [re, to] of ERROR_PATTERNS) if (re.test(core)) return core.replace(re, to) + (m ? m[0] : '');
  return msg;
}

/** Fehler (Error oder Text) in der eingestellten Sprache – für alles, was aus dem Rust-Teil kommt. */
export const errText = (e) => translateError(settings.language, e);
