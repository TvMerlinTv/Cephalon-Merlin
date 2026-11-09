import { useEffect, useState } from 'react';
import { isElectron, load, save } from './api.js';

// To-Do-Liste des Mastery-Helfers: Item-IDs in der Reihenfolge, in der sie hinzugefügt wurden.
// In der Desktop-App liegt sie als Datei im Datenordner (todo.json) – der Browser-Speicher ist
// je nach Startart (Entwicklung / .exe) ein anderer. localStorage bleibt Kopie und Browser-Fallback.
const KEY = 'td.todo.v1';
let todo = load(KEY, []);
const listeners = new Set();
const emit = () => listeners.forEach((fn) => fn(todo));

if (isElectron && window.wf.storeGet) {
  window.wf.storeGet('todo').then((stored) => {
    if (Array.isArray(stored)) {
      todo = stored;
      save(KEY, todo);
      emit();
    } else if (todo.length) {
      // Einmalig übernehmen: Liste stand bisher nur im Browser-Speicher
      window.wf.storeSet('todo', todo);
    }
  });
}

function set(next) {
  todo = next;
  save(KEY, todo);
  if (isElectron) window.wf.storeSet?.('todo', todo);
  emit();
}

export function toggleTodo(id) {
  set(todo.includes(id) ? todo.filter((x) => x !== id) : [...todo, id]);
}

export function removeTodo(id) {
  set(todo.filter((x) => x !== id));
}

export function useTodo() {
  const [list, setList] = useState(todo);
  useEffect(() => {
    listeners.add(setList);
    setList(todo);
    return () => listeners.delete(setList);
  }, []);
  return list;
}
