import { useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import { useT } from '../lib/i18n.js';

/** Suchfeld + Trefferliste über alle warframe.market-Items. */
export default function ItemPicker({ items, onPick, onClose, title = 'Item hinzufügen' }) {
  const t = useT();
  const [q, setQ] = useState('');
  const hits = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (s.length < 2) return [];
    return items.filter((i) => i.name.toLowerCase().includes(s)).slice(0, 40);
  }, [q, items]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{t(title)}</h3>
          <button className="icon-btn" onClick={onClose} aria-label={t('Schließen')}>
            <X size={18} />
          </button>
        </div>
        <label className="search big">
          <Search size={16} />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('z. B. Afuris Prime Barrel')} />
        </label>
        <ul className="picker-list">
          {hits.map((i) => (
            <li key={i.slug}>
              <button onClick={() => onPick(i)}>
                {i.thumb && <img src={i.thumb} alt="" />}
                <span>{i.name}</span>
              </button>
            </li>
          ))}
          {q.trim().length >= 2 && hits.length === 0 && <li className="muted">{t('Nichts gefunden.')}</li>}
        </ul>
      </div>
    </div>
  );
}
