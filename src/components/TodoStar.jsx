import { Star } from 'lucide-solid';
import { todo, toggleTodo } from '../lib/gamedb.js';
import { t } from '../lib/i18n.js';

/** Stern zum Hinzufügen/Entfernen eines Items auf der To-Do-Liste. */
export default function TodoStar(props) {
  const on = () => todo().includes(props.id);
  return (
    <button
      class="todo-star"
      classList={{ on: on() }}
      onClick={(e) => {
        e.stopPropagation();
        toggleTodo(props.id);
      }}
      title={t(on() ? 'Von der To-Do-Liste entfernen' : 'Auf die To-Do-Liste setzen')}
      aria-pressed={on()}
    >
      <Star size={props.size ?? 18} fill={on() ? 'currentColor' : 'none'} />
    </button>
  );
}
