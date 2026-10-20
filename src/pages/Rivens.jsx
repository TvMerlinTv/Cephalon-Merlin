import { useEffect, useMemo, useState } from 'react';
import { Dices, Lock, RefreshCw, ExternalLink, X } from 'lucide-react';
import { useGameData } from '../lib/GameData.jsx';
import { useSettings } from '../lib/settings.js';
import { useT } from '../lib/i18n.js';
import { load, save, openExternal, isAbort, isBusy } from '../lib/api.js';
import { Plat } from '../components/Icons.jsx';
import { HoverSearch } from '../components/GearBrowser.jsx';
import {
  RIVEN_TYPES, RAW_LABELS, useRivenMeta, describeRiven, challengeText, getRivenAuctions, nextRollKuva, spentKuva,
} from '../lib/rivens.js';

const SORTS = [
  { id: 'weapon', label: 'Waffe' },
  { id: 'disposition', label: 'Disposition' },
  { id: 'quality', label: 'Würfelglück' },
  { id: 'rerolls', label: 'Umgewürfelt' },
];
const VIEW_KEY = 'td.rivens.view.v1';

function Dots({ n }) {
  return (
    <span className="rv-dots" aria-label={`${n}/5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <i key={i} className={i <= n ? 'on' : ''} />
      ))}
    </span>
  );
}

/** Balken: wie gut der Stat gewürfelt ist (90 % … 110 % des Basiswerts). */
function RollBar({ roll }) {
  const pct = Math.round(roll * 100);
  const cls = roll >= 0.75 ? 'hi' : roll >= 0.35 ? 'mid' : 'lo';
  return (
    <span className={`rv-roll ${cls}`} title={`${pct}%`}>
      <i style={{ width: `${Math.max(4, pct)}%` }} />
    </span>
  );
}

function StatLine({ s }) {
  // Beim Curse ist ein schlechter Wurf (niedriger Wert) gut – Balken zeigt trotzdem die Stärke
  return (
    <li className={s.curse ? 'curse' : 'buff'}>
      <b>{s.text}</b>
      <span>{s.label}</span>
      <RollBar roll={s.roll} />
    </li>
  );
}

function RivenCard({ r, active, onPick }) {
  const t = useT();
  return (
    <button className={`rv-card ${active ? 'active' : ''}`} onClick={() => onPick(r)}>
      <div className="rv-head">
        {r.thumb ? <img src={r.thumb} alt="" loading="lazy" /> : <Dices size={22} />}
        <div>
          <strong>{r.weapon ?? t('Unbekannt')}</strong>
          <small>{t(r.typeLabel)}</small>
        </div>
        <Dots n={r.dots} />
      </div>
      <ul className="rv-stats">
        {r.stats.map((s) => (
          <StatLine key={s.tag + s.curse} s={s} />
        ))}
      </ul>
      <div className="rv-foot">
        <span title={t('Mastery-Rang')}>MR {r.mr ?? '–'}</span>
        <span title={t('Rang')}>{t('Rang')} {r.rank}/8</span>
        {r.polarityName && <span>{r.polarityName}</span>}
        <span title={t('So oft umgewürfelt')}>
          <RefreshCw size={12} /> {r.rerolls}
        </span>
      </div>
    </button>
  );
}

function Prices({ r }) {
  const t = useT();
  const positive = r.stats.filter((s) => !s.curse && s.slug).map((s) => s.slug);
  const [same, setSame] = useState(null);
  const [all, setAll] = useState(null);
  const [error, setError] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const [slow, setSlow] = useState(false);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!r.slug) return;
    // Beim Wegklicken abbrechen: noch wartende Anfragen gehen dann gar nicht erst raus
    const ctrl = new AbortController();
    const { signal } = ctrl;
    setSame(null);
    setAll(null);
    setError(null);
    setSlow(false);
    const slowTimer = setTimeout(() => setSlow(true), 2500);
    const fail = (e) => {
      if (signal.aborted || isAbort(e)) return;
      setError({ busy: isBusy(e), retryAt: e.retryAt ?? null, message: String(e.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '') });
    };
    getRivenAuctions(r.slug, [], { signal })
      .then((a) => !signal.aborted && setAll(a))
      .catch(fail);
    if (positive.length)
      getRivenAuctions(r.slug, positive, { signal })
        .then((a) => !signal.aborted && setSame(a))
        .catch(fail);
    return () => {
      clearTimeout(slowTimer);
      ctrl.abort();
    };
  }, [r.id, r.slug, attempt]);

  // Ausgelastet: Countdown anzeigen und danach von selbst neu versuchen
  useEffect(() => {
    if (!error?.retryAt) return;
    const tick = setInterval(() => {
      setNow(Date.now());
      if (Date.now() >= error.retryAt) setAttempt((n) => n + 1);
    }, 1000);
    return () => clearInterval(tick);
  }, [error]);

  if (!r.slug) return <p className="muted">{t('Diese Waffe gibt es auf warframe.market nicht.')}</p>;
  if (error) {
    const secs = error.retryAt ? Math.max(0, Math.ceil((error.retryAt - now) / 1000)) : 0;
    return (
      <div className="rv-price-error">
        <p className={error.busy ? 'muted' : 'err'}>
          {error.busy
            ? secs > 0
              ? t('warframe.market ist gerade ausgelastet – neuer Versuch in {n} s.', { n: secs })
              : t('warframe.market ist gerade ausgelastet – bitte gleich nochmal versuchen.')
            : `${t('Preise konnten nicht geladen werden.')} (${error.message})`}
        </p>
        <button className="btn" onClick={() => setAttempt((n) => n + 1)}>
          <RefreshCw size={14} /> {t('Erneut versuchen')}
        </button>
      </div>
    );
  }

  const row = (title, list) => (
    <div className="rv-price">
      <span>{title}</span>
      {list == null ? (
        <span className="muted">…</span>
      ) : list.length === 0 ? (
        <span className="muted">{t('keine Angebote')}</span>
      ) : (
        <span>
          <b>
            <Plat size={14} /> {list[0].price}
          </b>
          <small>
            {' '}
            · {t('Median')} {list[Math.floor(Math.min(list.length, 10) / 2)].price} · {t('{n} Angebote', { n: list.length })}
          </small>
        </span>
      )}
    </div>
  );

  return (
    <>
      {positive.length > 0 && row(t('Gleiche positive Stats'), same)}
      {row(t('Alle Rivens dieser Waffe'), all)}
      {slow && all == null && (
        <p className="muted small">{t('In der Warteschlange – warframe.market erlaubt nur wenige Riven-Abfragen pro Minute.')}</p>
      )}
      {same?.length > 0 && (
        <ul className="rv-offers">
          {same.slice(0, 5).map((a) => (
            <li key={a.id}>
              <span className={`rv-status ${a.status}`} title={a.status} />
              <span className="rv-offer-name">{a.name}</span>
              <small>
                <RefreshCw size={11} /> {a.rerolls}
              </small>
              <b>
                <Plat size={13} /> {a.price}
              </b>
            </li>
          ))}
        </ul>
      )}
      <button
        className="btn"
        onClick={() => openExternal(`https://warframe.market/auctions/search?type=riven&weapon_url_name=${r.slug}&sort_by=price_asc`)}
      >
        <ExternalLink size={14} /> {t('Auf warframe.market ansehen')}
      </button>
    </>
  );
}

function Detail({ r, onClose }) {
  const t = useT();
  return (
    <aside className="rv-detail">
      <button className="rv-close" onClick={onClose} title={t('Schließen')}>
        <X size={16} />
      </button>
      <div className="rv-head big">
        {r.thumb ? <img src={r.thumb} alt="" /> : <Dices size={30} />}
        <div>
          <strong>{r.weapon ?? t('Unbekannt')}</strong>
          <small>
            {t(r.typeLabel)} · {t('Disposition')} {r.disposition?.toFixed(2) ?? '?'}
          </small>
        </div>
        <Dots n={r.dots} />
      </div>
      <p className="muted rv-note">{t('Werte bei Rang 8 (maximal)')}</p>
      <ul className="rv-stats big">
        {r.stats.map((s) => (
          <StatLine key={s.tag + s.curse} s={s} />
        ))}
      </ul>
      <dl className="rv-facts">
        <dt>{t('Würfelglück')}</dt>
        <dd>{r.quality == null ? '–' : `${Math.round(r.quality * 100)}%`}</dd>
        <dt>MR</dt>
        <dd>{r.mr ?? '–'}</dd>
        <dt>{t('Rang')}</dt>
        <dd>{r.rank}/8</dd>
        <dt>{t('Polarität')}</dt>
        <dd>{r.polarityName ?? '–'}</dd>
        <dt>{t('Umgewürfelt')}</dt>
        <dd>
          {r.rerolls}× · {spentKuva(r.rerolls).toLocaleString('de-DE')} Kuva
        </dd>
        <dt>{t('Nächster Wurf')}</dt>
        <dd>{nextRollKuva(r.rerolls).toLocaleString('de-DE')} Kuva</dd>
      </dl>
      <h4>{t('Marktpreis')}</h4>
      <Prices r={r} />
    </aside>
  );
}

export default function Rivens() {
  const { inventory } = useGameData();
  const { language } = useSettings();
  const t = useT();
  const { meta, error } = useRivenMeta(language);
  const [view, setView] = useState(() => load(VIEW_KEY, { type: 'all', sort: 'weapon' }));
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState(null);

  const setV = (patch) => {
    const next = { ...view, ...patch };
    setView(next);
    save(VIEW_KEY, next);
  };

  const data = inventory?.rivens;
  const all = useMemo(() => (data?.list ?? []).map((r) => describeRiven(r, meta)), [data, meta]);
  const unveiled = all.filter((r) => !r.challenge);
  const veiled = all.filter((r) => r.challenge);
  const rawTotal = Object.values(data?.raw ?? {}).reduce((a, b) => a + b, 0);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    const sorters = {
      weapon: (a, b) => (a.weapon ?? '').localeCompare(b.weapon ?? ''),
      disposition: (a, b) => (b.disposition ?? 0) - (a.disposition ?? 0),
      quality: (a, b) => (b.quality ?? 0) - (a.quality ?? 0),
      rerolls: (a, b) => b.rerolls - a.rerolls,
    };
    return unveiled
      .filter((r) => view.type === 'all' || r.type === view.type)
      .filter((r) => !q || (r.weapon ?? '').toLowerCase().includes(q) || r.stats.some((s) => s.label.toLowerCase().includes(q)))
      .sort(sorters[view.sort] ?? sorters.weapon);
  }, [unveiled, view, query]);

  const current = picked && all.find((r) => r.id === picked);

  if (!inventory) return <div className="empty">{t('Synchronisiere zuerst dein Inventar, um deine Rivens zu sehen.')}</div>;
  if (!data) return <div className="empty">{t('Bitte einmal neu synchronisieren – die Riven-Daten fehlen noch.')}</div>;

  const typesPresent = new Set(unveiled.map((r) => r.type));

  return (
    <div className={`page rv ${current ? 'with-detail' : ''}`}>
      <div className="rv-main">
        <div className="rv-summary">
          <span>
            <b>{unveiled.length}</b> {t('enthüllt')}
          </span>
          <span>
            <b>{veiled.length}</b> {t('verschleiert')}
          </span>
          <span title={Object.entries(data.raw).map(([k, n]) => `${t(RAW_LABELS[k] ?? k)}: ${n}`).join('\n')}>
            <b>{rawTotal}</b> {t('ungeöffnet')}
          </span>
          {data.slots > 0 && (
            <span>
              <b>
                {all.length}/{data.slots}
              </b>{' '}
              {t('Plätze')}
            </span>
          )}
        </div>

        <div className="gb-bar">
          <button className={`gb-tab ${view.type === 'all' ? 'active' : ''}`} onClick={() => setV({ type: 'all' })}>
            <span>{t('Alle')}</span>
          </button>
          {RIVEN_TYPES.filter((x) => typesPresent.has(x.id)).map((x) => (
            <button key={x.id} className={`gb-tab ${view.type === x.id ? 'active' : ''}`} onClick={() => setV({ type: x.id })}>
              <span>{t(x.label)}</span>
            </button>
          ))}
          <div className="gb-spacer" />
          <select className="rv-sort" value={view.sort} onChange={(e) => setV({ sort: e.target.value })} title={t('Sortieren')}>
            {SORTS.map((s) => (
              <option key={s.id} value={s.id}>
                {t(s.label)}
              </option>
            ))}
          </select>
          <HoverSearch value={query} onChange={setQuery} />
        </div>

        {error && !meta && <p className="err">{t('warframe.market nicht erreichbar – Werte ohne Disposition.')}</p>}
        {list.length === 0 && <div className="empty">{t('Nichts gefunden.')}</div>}
        <div className="rv-grid">
          {list.map((r) => (
            <RivenCard key={r.id} r={r} active={r.id === picked} onPick={(x) => setPicked(x.id === picked ? null : x.id)} />
          ))}
        </div>

        {veiled.length > 0 && (
          <>
            <h3 className="rv-section">
              <Lock size={16} /> {t('Verschleierte Rivens')}
            </h3>
            <ul className="rv-veiled">
              {veiled.map((r) => (
                <li key={r.id}>
                  <span className="rv-veiled-type">{t(r.typeLabel)}</span>
                  <span className="rv-veiled-text">{challengeText(r.challenge)}</span>
                  <span className="rv-veiled-prog">
                    <i style={{ width: `${Math.min(100, (r.challenge.progress / r.challenge.required) * 100)}%` }} />
                    <small>
                      {r.challenge.progress}/{r.challenge.required}
                    </small>
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
      {current && <Detail r={current} onClose={() => setPicked(null)} />}
    </div>
  );
}
