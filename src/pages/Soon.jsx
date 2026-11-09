// Platzhalter für Seiten, die in der Rust-Version noch nicht umgesetzt sind.
import { Construction } from 'lucide-solid';
import { t } from '../lib/i18n.js';

export default function Soon(props) {
  return (
    <div class="page">
      <div class="empty">
        <Construction size={40} />
        <h2>{t(props.label)}</h2>
        <p>{t('Diese Seite kommt in einem der nächsten Schritte in die Rust-Version.')}</p>
      </div>
    </div>
  );
}
