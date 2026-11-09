import { useState } from 'react';
import GearBrowser from '../components/GearBrowser.jsx';
import ItemDetails from '../components/ItemDetails.jsx';
import FoundryTimers from '../components/FoundryTimers.jsx';

// Foundry: alle Warframes, Waffen und Begleiter mit Bauteilen und Besitz-Status.
// Klick auf eine Karte öffnet den Bauplan mit Fundorten, Klick auf ein Bauteil direkt dieses Teil.
export default function Foundry() {
  const [details, setDetails] = useState(null);
  return (
    <div className="page">
      <FoundryTimers wide />
      <GearBrowser
        mode="foundry"
        onPick={(item) => setDetails({ item })}
        onPickPart={(item, part) => setDetails({ item, partId: part.id })}
      />
      {details && <ItemDetails item={details.item} partId={details.partId} onClose={() => setDetails(null)} />}
    </div>
  );
}
