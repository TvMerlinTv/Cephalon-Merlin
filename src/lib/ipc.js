// Verbindung zum Rust-Teil. Im Browser (npm run dev ohne Tauri) gibt es kein Backend –
// dann laufen die Seiten im Testmodus mit localStorage.
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export const isTauri = typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__;

/** Befehl im Rust-Teil aufrufen. Fehler kommen als Text zurück und werden zu Error. */
export async function call(cmd, args) {
  if (!isTauri) throw new Error('Nur in der Desktop-App verfügbar');
  try {
    return await invoke(cmd, args);
  } catch (e) {
    throw e instanceof Error ? e : new Error(String(e));
  }
}

/** Auf ein Ereignis aus dem Rust-Teil hören. Gibt eine Abmelde-Funktion zurück. */
export function on(event, fn) {
  if (!isTauri) return () => {};
  const p = listen(event, (e) => fn(e.payload));
  return () => p.then((un) => un());
}

// ---------- kleine localStorage-Helfer (können im privaten Modus fehlen) ----------
export function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}
export function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* egal */
  }
}

export function openExternal(url) {
  if (isTauri) call('open_external', { url }).catch((e) => logError('link', e));
  else window.open(url, '_blank', 'noopener');
}

// ---------- Fehlerprotokoll: Fehler der Oberfläche landen in logs\cephalon-merlin.log ----------
export function logError(source, err) {
  const message = err?.stack ?? err?.message ?? String(err);
  console.error(`[${source}]`, err);
  if (isTauri) invoke('log_write', { level: 'error', source, message }).catch(() => {});
}

if (isTauri) {
  window.addEventListener('error', (e) => logError('window', e.error ?? `${e.message} (${e.filename}:${e.lineno})`));
  window.addEventListener('unhandledrejection', (e) => logError('promise', e.reason));
}
