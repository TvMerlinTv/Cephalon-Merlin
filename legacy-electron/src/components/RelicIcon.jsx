// Relikt-Bild pro Stufe (aus WFCD). Für Omnia-Spalten gibt es kein eigenes Bild – dort der Buchstabe.
const IMAGES = {
  Lith: 'RelicLithD.png',
  Meso: 'RelicMesoD.png',
  Neo: 'RelicNeoD.png',
  Axi: 'RelicAxiD.png',
  Requiem: 'RelicImmortalD.png',
};

export default function RelicIcon({ tier, size = 26 }) {
  const img = IMAGES[tier];
  if (!img) {
    return (
      <span className={`relic-icon tier-${tier.toLowerCase()}`} style={{ width: size, height: size }} title={tier}>
        {tier[0]}
      </span>
    );
  }
  return (
    <img
      className="relic-img-icon"
      src={`https://cdn.warframestat.us/img/${img}`}
      width={size}
      height={size}
      alt={tier}
      title={tier}
    />
  );
}
