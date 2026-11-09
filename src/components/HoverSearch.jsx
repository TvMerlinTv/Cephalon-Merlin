// Suchfeld, das nur beim Drüberfahren (oder beim Tippen) aufklappt.
import { Show } from 'solid-js';
import { Search, Trash2 } from 'lucide-solid';
import { t } from '../lib/i18n.js';

export default function HoverSearch(props) {
  return (
    <div class="gb-searchbox" classList={{ 'has-value': !!props.value }}>
      <Search size={17} class="gb-search-ico" />
      <input placeholder={t('Suchen')} value={props.value} onInput={(e) => props.onChange(e.currentTarget.value)} />
      <Show when={props.value}>
        <button class="gb-search-clear" onClick={() => props.onChange('')} title={t('Suche leeren')}>
          <Trash2 size={15} />
        </button>
      </Show>
    </div>
  );
}
