// Foundry: alle Warframes, Waffen und Begleiter mit Bauteilen und Besitz-Status, darüber laufende Bauaufträge.
// Klick auf eine Karte öffnet den Bauplan mit Fundorten, Klick auf ein Bauteil direkt dieses Teil.
import { createSignal, Show } from 'solid-js';
import GearBrowser from '../components/GearBrowser.jsx';
import ItemDetails from '../components/ItemDetails.jsx';
import FoundryTimers from '../components/FoundryTimers.jsx';

export default function Foundry() {
  const [details, setDetails] = createSignal(null);
  return (
    <div class="page">
      <FoundryTimers wide />
      <GearBrowser mode="foundry" onPick={(item) => setDetails({ item })} onPickPart={(item, part) => setDetails({ item, partId: part.id })} />
      <Show when={details()}>
        <ItemDetails item={details().item} partId={details().partId} onClose={() => setDetails(null)} />
      </Show>
    </div>
  );
}
