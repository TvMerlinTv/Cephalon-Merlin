// Liest neue Zeilen aus dem Warframe-Log (EE.log) mit – wie WFinfo:
//  "Pause countdown done" / "Got rewards"              -> Belohnungs-Bildschirm ist offen
//  "Relic timer closed" / "MatchingService::EndSession" -> Auswahl vorbei
//  "Created …/ThemedProjectionManager.swf"              -> Relikt-Auswahl (Void Relics) geöffnet
//  "Subscribing for …/<Anderer>.swf"                    -> anderer Bildschirm, Relikt-Auswahl zu
//  "WM_ACTIVATEAPP 0/1"                                 -> Spiel verliert/bekommt den Fokus
const path = require('node:path');
const fs = require('node:fs');
const { EventEmitter } = require('node:events');

const POLL_MS = 500;

function watchLog() {
  const events = new EventEmitter();
  const local = process.env.LOCALAPPDATA;
  if (!local) return events;
  const file = path.join(local, 'Warframe', 'EE.log');
  let pos = null;
  let rest = '';

  const tick = () => {
    fs.stat(file, (err, st) => {
      if (err) return;
      if (pos === null || st.size < pos) pos = st.size; // Start oder neues Log (Spielneustart)
      if (st.size === pos) return;
      const stream = fs.createReadStream(file, { start: pos, end: st.size - 1, encoding: 'latin1' });
      pos = st.size;
      let data = '';
      stream.on('data', (c) => (data += c));
      stream.on('end', () => {
        const lines = (rest + data).split(/\r?\n/);
        rest = lines.pop();
        for (const line of lines) {
          if (line.includes('Pause countdown done') || line.includes('Got rewards')) events.emit('rewards');
          else if (line.includes('Relic timer closed') || line.includes('MatchingService::EndSession')) events.emit('closed');
          else if (line.includes('Created /Lotus/Interface/ThemedProjectionManager.swf')) events.emit('selectionOpen');
          else if (line.includes('WM_ACTIVATEAPP 0')) events.emit('focus', false);
          else if (line.includes('WM_ACTIVATEAPP 1')) events.emit('focus', true);
          else {
            // Ein anderer Menü-Bildschirm wurde geöffnet -> Relikt-Auswahl ist zu
            const m = /Subscribing for \/Lotus\/Interface\/(\w+)\.swf/.exec(line);
            if (m && m[1] !== 'ThemedProjectionManager') events.emit('screen', m[1]);
          }
        }
      });
    });
  };

  const id = setInterval(tick, POLL_MS);
  events.stop = () => clearInterval(id);
  return events;
}

module.exports = { watchLog };
