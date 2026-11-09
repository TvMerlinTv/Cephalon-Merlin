import { Star } from 'lucide-react';
import { toggleTodo, useTodo } from '../lib/todo.js';

/** Stern zum Hinzufügen/Entfernen eines Items auf der To-Do-Liste. */
export default function TodoStar({ id, size = 18 }) {
  const todo = useTodo();
  const on = todo.includes(id);
  return (
    <button
      className={`todo-star ${on ? 'on' : ''}`}
      onClick={(e) => {
        e.stopPropagation();
        toggleTodo(id);
      }}
      title={on ? 'Von der To-Do-Liste entfernen' : 'Auf die To-Do-Liste setzen'}
      aria-pressed={on}
    >
      <Star size={size} fill={on ? 'currentColor' : 'none'} />
    </button>
  );
}
