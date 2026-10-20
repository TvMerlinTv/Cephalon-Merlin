import { Lock, Star, ThumbsUp } from 'lucide-react';
import { expectedValue } from '../lib/relicMath.js';
import { Plat, Ducat } from './Icons.jsx';
import RelicIcon from './RelicIcon.jsx';
import { useT } from '../lib/i18n.js';

const STATUS = {
  need: { text: 'Fehlt dir', cls: 'need' },
  have: { text: 'Hast du', cls: 'have' },
  owned: { text: 'Item im Besitz', cls: 'owned' },
  mastered: { text: 'Gemeistert', cls: 'mastered' },
  forma: { text: 'Forma', cls: 'none' },
  none: { text: '', cls: 'none' },
};

const REF_LABEL = { intact: 'Intact', exceptional: 'Exceptional', flawless: 'Flawless', radiant: 'Radiant' };

function num(v, digits = 0) {
  return v == null ? '–' : Number(v).toFixed(digits).replace(/\.0+$/, '');
}

/** Eine Spalte unter einer Belohnung (wie bei AlecaFrame). */
export function RewardColumn({ info, best }) {
  const t = useT();
  const st = STATUS[info.status];
  return (
    <div className={`rw-col ${best ? 'best' : ''} st-${st.cls}`}>
      <div className="rw-name">{info.name}</div>
      <div className="rw-values">
        <span>
          {num(info.plat)} <Plat />
        </span>
        {info.vaulted && <Lock size={13} className="rw-vault" title="Vaulted" />}
        <span>
          {info.ducats} <Ducat />
        </span>
      </div>
      {info.status === 'forma' && (
        <div className="rw-bar" title={t('Forma-Blaupausen im Inventar')}>
          <span>{t('Hast du')}</span>
          <b>{info.have}</b>
        </div>
      )}
      {info.item && (
        <div className="rw-bar" title={info.neededFor ? t('Wird noch für {x} gebraucht', { x: info.neededFor }) : t('Hast du / braucht das Set')}>
          <span>{info.neededFor ? t('Für {x}', { x: info.neededFor }) : t(st.text)}</span>
          <b>
            {info.have}/{info.need}
          </b>
        </div>
      )}
      {info.setParts.length > 0 && (
        <div className="rw-set">
          {info.setParts.map((p) => (
            <span key={p.id} className={`rw-part ${p.have >= p.count ? 'ok' : ''}`} title={`${p.name}: ${p.have}/${p.count}`}>
              {p.image ? <img src={p.image} alt="" /> : p.name[0]}
              <i>{p.have}</i>
            </span>
          ))}
        </div>
      )}
      {info.setPrice != null && (
        <div className="rw-setprice" title={t('Set-Preis')}>
          Set {num(info.setPrice)} <Plat />
        </div>
      )}
      <div className="rw-tags">
        {best && (
          <span className="rw-best">
            <ThumbsUp size={11} /> {t('Nimm das')}
          </span>
        )}
        {info.onTodo && (
          <span className="rw-todo">
            <Star size={11} fill="currentColor" /> To-Do
          </span>
        )}
      </div>
    </div>
  );
}

/** Panel für den Belohnungs-Bildschirm: alle 4 Teile (deins und die deiner Teammates). */
export function RewardsPanel({ result, ri, showWallet = true }) {
  const infos = result.items.map((it) => ri.info(it.name));
  const best = ri.pick(infos);
  return (
    <div className="rw-panel">
      <div className="rw-cols">
        {infos.map((info, i) => (
          <RewardColumn key={i} info={info} best={info === best} />
        ))}
      </div>
      <div className="rw-footer">
        <span>Cephalon Merlin</span>
        {showWallet && ri.player && (
          <span className="rw-wallet">
            {ri.player.platinum?.toLocaleString('de-DE')} <Plat /> {ri.player.ducats?.toLocaleString('de-DE')} <Ducat />
          </span>
        )}
      </div>
    </div>
  );
}

/** Die besten eigenen Relikte einer Ära – Karten wie bei AlecaFrame ("6x Lith A12 Intact"). */
function Recommended({ era, ri, squad }) {
  const t = useT();
  const { list, total } = ri.recommend({ squad, tier: era, limit: 6 });
  return (
    <>
      <div className="rec-head">
        <span className="rec-count">
          {era && <RelicIcon tier={era} size={22} />} {total}
        </span>
        <b>{era ? t('Beste {era}-Relikte', { era }) : t('Empfohlene Relikte')}</b>
        <span className="muted small">{t('{n}er-Squad', { n: squad })}</span>
      </div>
      <div className="rec-grid">
        {list.map((r) => (
          <div key={`${r.relic.id}|${r.refinement}`} className="rec-card">
            <div className="rec-name">
              {r.relic.vaulted && <Lock size={12} className="rw-vault" />}
              <span className="muted">{r.count}x</span> {r.relic.name} {REF_LABEL[r.refinement]}
            </div>
            <div className="rec-ev">
              <span className="muted">{t('Gewinn:')}</span>
              <span>
                {r.plat.toFixed(1)} <Plat />
              </span>
              <span>
                {r.ducats.toFixed(1)} <Ducat />
              </span>
            </div>
            {r.needed > 0 && <div className="need-count">{t('{n} Teile fehlen dir', { n: r.needed })}</div>}
          </div>
        ))}
        {list.length === 0 && <div className="muted small">{era ? t('Keine {era}-Relikte im Inventar.', { era }) : t('Keine Relikte im Inventar.')}</div>}
      </div>
    </>
  );
}

/** Gerade angeklicktes Relikt: alle 6 Teile mit Chance, Wert und ob sie dir fehlen. */
function SelectedRelic({ result, ri, squad }) {
  const t = useT();
  const relic = ri.relicById(result.relicId);
  if (!relic) return null;
  const rewards = relic.rewards[result.refinement] ?? relic.rewards.intact ?? [];
  const rows = rewards
    .map((w) => ({ w, info: ri.info(w.name) }))
    .sort((a, b) => (b.info.status === 'need') - (a.info.status === 'need') || (b.info.plat ?? 0) - (a.info.plat ?? 0));
  const ev = expectedValue(rewards, (w) => ri.priceOf(w.name) ?? 0, squad);
  const evDucats = expectedValue(rewards, (w) => ri.info(w.name).ducats, squad);

  return (
    <div className="sel-selected">
      <div className="sel-head">
        <RelicIcon tier={relic.tier} size={28} />
        <div>
          <b>
            {relic.name} {REF_LABEL[result.refinement]}
          </b>
          <div className="sel-ev">
            {t('Gewinn:')} {ev.toFixed(1)} <Plat /> · {evDucats.toFixed(1)} <Ducat />
            {relic.vaulted && (
              <span className="rw-vault-tag">
                <Lock size={11} /> Vaulted
              </span>
            )}
          </div>
        </div>
      </div>
      <table className="sel-table">
        <tbody>
          {rows.map(({ w, info }) => (
            <tr key={w.name} className={`st-${STATUS[info.status].cls}`}>
              <td className="sel-name">
                {info.onTodo && <Star size={11} fill="currentColor" className="rw-todo-ico" />} {w.name}
              </td>
              <td className="sel-chance">{w.chance} %</td>
              <td>
                {num(info.plat)} <Plat />
              </td>
              <td>
                {info.ducats} <Ducat />
              </td>
              <td className="sel-status" title={info.neededFor ? t('Wird noch für {x} gebraucht', { x: info.neededFor }) : undefined}>
                {t(STATUS[info.status].text)}
                {info.neededFor ? ` ${t('(für {x})', { x: info.neededFor })}` : info.item && ` ${info.have}/${info.need}`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Panel für die Relikt-Auswahl: beste 6 Relikte der Ära (+ im App-Fenster das angeklickte Relikt).
 * `compact` (Overlay): ohne Tabelle – die Infos stehen dort als Schilder direkt an den Belohnungen.
 */
export function SelectionPanel({ result, ri, squad = 4, compact = false }) {
  const era = result.era ?? ri.relicById(result.relicId)?.tier ?? null;
  return (
    <div className="sel-panel">
      <Recommended era={era} ri={ri} squad={squad} />
      {result.relicId && !compact && <SelectedRelic result={result} ri={ri} squad={squad} />}
    </div>
  );
}

/** Kleines Schild an einer Belohnung in der Relikt-Auswahl des Spiels. */
export function RewardTag({ info }) {
  const t = useT();
  const st = STATUS[info.status];
  return (
    <div className={`rw-tag st-${st.cls}`}>
      <span>
        {num(info.plat)} <Plat size={11} />
      </span>
      <span>
        {info.ducats} <Ducat size={11} />
      </span>
      {info.item && (
        <b>
          {t(st.text)} {info.have}/{info.need}
        </b>
      )}
      {info.onTodo && <Star size={10} fill="currentColor" className="rw-todo-ico" />}
    </div>
  );
}
