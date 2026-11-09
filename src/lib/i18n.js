// Übersetzungen: Schlüssel ist der deutsche Text, so bleibt der Code lesbar und alles,
// was (noch) nicht übersetzt ist, erscheint einfach auf Deutsch.
// Platzhalter: t('{n} weitere', { n: 5 }). t() ist reaktiv (liest settings.language).
import { settings } from './settings.js';
import EN_OLD from './i18n-en.js';
import EN_RS from './i18n-en-rs.js';

const EN = { ...EN_OLD, ...EN_RS };

const DICTS = { en: EN };

export function translate(lang, text, vars) {
  let out = DICTS[lang]?.[text] ?? text;
  if (vars) for (const [k, v] of Object.entries(vars)) out = out.replaceAll(`{${k}}`, v);
  return out;
}

export const t = (text, vars) => translate(settings.language, text, vars);

/** Zahl im Format der eingestellten Sprache. */
export const num = (n) => (n == null ? '–' : Number(n).toLocaleString(settings.language === 'en' ? 'en-US' : 'de-DE'));
