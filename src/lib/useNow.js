import { useEffect, useState } from 'react';

/** Aktuelle Zeit, die sich jede Sekunde aktualisiert (für Countdowns). */
export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
