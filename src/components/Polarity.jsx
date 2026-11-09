// Polaritäts-Symbole wie auf den Mod-Karten im Spiel – eigene Nachzeichnungen (die Originale gehören DE),
// einfarbig über currentColor, damit sie die Farbe der Kosten übernehmen (grün = passt, rot = passt nicht).
const PATHS = {
  // Madurai: schräges „V“ – kurzer linker, langer rechter Arm (wie ein Haken)
  madurai: () => <path d="M2.5 10.5h4.2l4.4 6.2 8-14.2h3.4L12.6 21h-2.5z" />,
  // Vazarin: liegendes „D“ (Schild)
  vazarin: () => <path fill-rule="evenodd" d="M4 3.5h16v7a8 8 0 0 1-16 0zm3.4 3.3v3.7a4.6 4.6 0 0 0 9.2 0V6.8z" />,
  // Naramon: Balken mit Haken nach unten
  naramon: () => <path d="M2.5 8h19v4.2H9.2V19H5V12.2H2.5z" />,
  // Zenurik: Kratzspuren
  zenurik: () => <path d="M5.5 20.5 12.6 3.5h3.3l-7.1 17zm6.4 0 4.3-10.3h3.3l-4.3 10.3zM2.5 13.5l2-4.8h3.2l-2 4.8z" />,
  // Unairu: rundes „U“ mit Spitze unten
  unairu: () => <path fill-rule="evenodd" d="M3 3.5h3.6v7.2c0 3 2.4 5.3 5.4 5.3s5.4-2.3 5.4-5.3V3.5H21v7.6c0 4.2-3 7.7-7 8.6L12 22l-2-2.3c-4-.9-7-4.4-7-8.6z" />,
  // Penjaga: Gabel
  penjaga: () => <path d="M10.2 21v-8.4L3 3.5h4.4l4.6 6 4.6-6H21l-7.2 9.1V21z" />,
  // Koneksi: Bogen mit Punkt
  koneksi: () => (
    <>
      <path d="M3.5 21V5h17v16h-3.6V8.6H7.1V21z" />
      <circle cx="12" cy="15.5" r="2.4" />
    </>
  ),
  // Umbra: Dreizack
  umbra: () => <path d="M3.5 3.5h3.3v7.4c2.6 3.3 7.8 3.3 10.4 0V3.5h3.3v8.6c-1.4 2.6-3.6 4.4-6.3 5V21h-4.4v-3.9c-2.7-.6-4.9-2.4-6.3-5zm6.8 0h3.4V13h-3.4z" />,
  // Aura / Universal: Raute
  aura: () => <path fill-rule="evenodd" d="M12 1.5 22.5 12 12 22.5 1.5 12zm0 5L6.5 12l5.5 5.5 5.5-5.5z" />,
};

export default function PolarityIcon(props) {
  const p = PATHS[props.name];
  if (!p) return null;
  const size = props.size ?? '1em';
  return (
    <svg class="pol-icon" viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-label={props.title ?? props.name} role="img">
      {props.title && <title>{props.title}</title>}
      {p()}
    </svg>
  );
}
