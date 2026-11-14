// Tastatur-Helfer für Dialoge.
import { onCleanup } from 'solid-js';

/**
 * Esc schließt den Dialog. Der zuletzt geöffnete Dialog bekommt die Taste zuerst und behält sie
 * (Capture-Phase + stopImmediatePropagation) – ein Dialog über den Einstellungen schließt also nur sich selbst.
 */
export function onEscape(fn) {
  const onKey = (e) => {
    if (e.key !== 'Escape') return;
    if (fn() === false) return; // false = gerade nicht schließbar, Taste weiterreichen
    e.stopImmediatePropagation();
    e.preventDefault();
  };
  window.addEventListener('keydown', onKey, true);
  onCleanup(() => window.removeEventListener('keydown', onKey, true));
}
