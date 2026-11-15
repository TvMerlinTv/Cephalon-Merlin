// Tests für die Kernlogik der Oberfläche (npm test). Werte von Hand nachgerechnet.
import { describe, expect, it } from 'vitest';
import { expectedValue, rarityOf, evaluate, compact } from './gamedb.js';
import { describeRiven, dispositionDots, nextRollKuva, spentKuva, parseMarketError } from './rivens.js';
import { countdown } from './world.js';
import { spareParts, spareSets, wtsMessages } from './trade.js';

describe('Relikt-Erwartungswert (Radshare)', () => {
  // Intakt: 3× gewöhnlich 25,33 %, 2× ungewöhnlich 11 %, 1× selten 2 %
  const intact = [25.33, 25.33, 25.34, 11, 11, 2].map((chance, i) => ({ chance, v: [1, 2, 3, 10, 20, 100][i] }));
  const val = (r) => r.v;

  it('allein = Summe Wert × Chance', () => {
    const solo = 0.2533 * 1 + 0.2533 * 2 + 0.2534 * 3 + 0.11 * 10 + 0.11 * 20 + 0.02 * 100;
    expect(expectedValue(intact, val, 1)).toBeCloseTo(solo, 6);
  });

  it('zwei gleiche Teile 50/50: 4er-Trupp nimmt das bessere', () => {
    const r = [{ chance: 50, v: 10 }, { chance: 50, v: 0 }];
    expect(expectedValue(r, val, 1)).toBeCloseTo(5, 9);
    expect(expectedValue(r, val, 4)).toBeCloseTo(10 * (1 - 0.5 ** 4), 9); // 9,375
  });

  it('mehr Spieler bringen nie weniger', () => {
    const evs = [1, 2, 3, 4].map((n) => expectedValue(intact, val, n));
    for (let i = 1; i < evs.length; i++) expect(evs[i]).toBeGreaterThan(evs[i - 1]);
    expect(evs[3]).toBeLessThanOrEqual(100);
  });

  it('Reihenfolge der Eingabe egal', () => {
    expect(expectedValue([...intact].reverse(), val, 4)).toBeCloseTo(expectedValue(intact, val, 4), 9);
  });

  it('Seltenheit aus der Chance', () => {
    expect(rarityOf(2)).toBe('rare');
    expect(rarityOf(10)).toBe('rare');
    expect(rarityOf(11)).toBe('uncommon');
    expect(rarityOf(20)).toBe('uncommon');
    expect(rarityOf(25.33)).toBe('common');
  });
});

describe('Riven', () => {
  const meta = {
    weapons: new Map([['/Lotus/Weapons/Rifle', { name: 'Testgewehr', disposition: 1.0, slug: 'test', thumb: null }]]),
    attributes: new Map(),
  };
  const riven = (buffs, curses = []) => ({ type: 'LotusRifle', compat: '/Lotus/Weapons/Rifle', polarity: 'AP_ATTACK', buffs, curses });

  it('2 Buffs ohne Curse: Krit-Chance bei Disposition 1, mittlerer Wurf = 150 % × 0,99', () => {
    const r = describeRiven(riven([{ tag: 'WeaponCritChanceMod', roll: 0.5 }, { tag: 'WeaponDamageAmountMod', roll: 0.5 }]), meta);
    expect(r.stats[0].text).toBe('+148.5%');
    expect(r.polarityName).toBe('Madurai');
    expect(r.dots).toBe(3);
    expect(r.quality).toBeCloseTo(0.5, 9);
  });

  it('2 Buffs + Curse: Buffs × 1,2375, Curse × 0,495 und negativ', () => {
    const r = describeRiven(riven([{ tag: 'WeaponCritChanceMod', roll: 0.5 }, { tag: 'WeaponDamageAmountMod', roll: 0.5 }], [{ tag: 'WeaponCritChanceMod', roll: 0.5 }]), meta);
    expect(r.stats[0].text).toBe('+185.6%');
    expect(r.stats[2].text).toBe('−74.2%');
    expect(r.stats[2].curse).toBe(true);
  });

  it('Wurf 0 / 1 = −10 % / +10 %', () => {
    const lo = describeRiven(riven([{ tag: 'WeaponCritChanceMod', roll: 0 }, { tag: 'WeaponDamageAmountMod', roll: 1 }]), meta);
    expect(lo.stats[0].text).toBe('+133.6%'); // 148,5 × 0,9
    expect(lo.stats[1].text).toBe('+179.7%'); // 0,018333 × 90 × 0,99 × 1,1
  });

  it('Fraktionsschaden als Multiplikator', () => {
    const r = describeRiven(riven([{ tag: 'WeaponFactionDamageCorpus', roll: 1 }, { tag: 'WeaponDamageAmountMod', roll: 0.5 }]), meta);
    expect(r.stats[0].text).toBe('x1.49'); // 1 + 0,005 × 90 × 0,99 × 1,1
  });

  it('ohne Disposition kein Wert, aber kein Absturz', () => {
    const r = describeRiven({ ...riven([{ tag: 'WeaponCritChanceMod', roll: 0.5 }]), compat: '/Lotus/Unbekannt' }, meta);
    expect(r.stats[0].text).toBe('?');
    expect(r.dots).toBe(0);
  });

  it('Dispositions-Punkte an den Grenzen', () => {
    expect([0.5, 0.69, 0.7, 0.89, 0.9, 1.1, 1.11, 1.3, 1.31, 1.55].map(dispositionDots)).toEqual([1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
    expect(dispositionDots(null)).toBe(0);
  });

  it('Kuva pro Umwürfeln', () => {
    expect(nextRollKuva(0)).toBe(900);
    expect(nextRollKuva(8)).toBe(3150);
    expect(nextRollKuva(9)).toBe(3500);
    expect(nextRollKuva(50)).toBe(3500);
    expect(spentKuva(0)).toBe(0);
    expect(spentKuva(3)).toBe(900 + 1000 + 1200);
    expect(spentKuva(10)).toBe(900 + 1000 + 1200 + 1400 + 1700 + 2000 + 2350 + 2750 + 3150 + 3500);
  });

  it('Markt-Fehler aus dem Rust-Teil', () => {
    expect(parseMarketError(new Error('HTTP 429 für /v2/x (retryAt 1794000000000)'))).toEqual({
      busy: true, retryAt: 1794000000000, aborted: false, message: 'HTTP 429 für /v2/x',
    });
    expect(parseMarketError('HTTP 503').busy).toBe(true);
    expect(parseMarketError('HTTP 404').busy).toBe(false);
    expect(parseMarketError('Abgebrochen').aborted).toBe(true);
  });
});

describe('Countdown', () => {
  const at = Date.UTC(2026, 10, 9, 12, 0, 0);
  const iso = (sec) => new Date(at + sec * 1000).toISOString();
  it('Formate', () => {
    expect(countdown(iso(65), at)).toBe('1m 5s');
    expect(countdown(iso(3 * 3600 + 12 * 60 + 5), at)).toBe('3h 12m 5s');
    expect(countdown(iso(2 * 86400 + 4 * 3600 + 59), at)).toBe('2d 4h');
  });
  it('abgelaufen = 0', () => {
    expect(countdown(iso(-30), at)).toBe('0m 0s');
  });
});

describe('Mastery-Status und Handel', () => {
  // Prime-Waffe aus 2 Teilen + Rohstoff, Warframe mit Bauteil (…Component / …Blueprint)
  const gun = {
    id: '/G', name: 'Gun Prime', isPrime: true, maxXp: 450000, maxRank: 30, credits: 25000,
    components: [
      { kind: 'part', id: '/G/Barrel', count: 1, ducats: 45 },
      { kind: 'part', id: '/G/Stock', count: 2, ducats: 15 },
      { kind: 'resource', id: '/Res/Orokin', count: 1 },
    ],
  };
  const frame = {
    id: '/F', name: 'Frame Prime', isPrime: true, maxXp: 1600000, maxRank: 30, credits: 25000,
    components: [{ kind: 'part', id: '/F/ChassisComponent', count: 1, ducats: 100 }],
  };
  const inv = (counts = {}, extra = {}) => ({ counts, owned: {}, xp: {}, player: { credits: 1e6 }, ...extra });

  it('Status-Stufen', () => {
    expect(evaluate(gun, inv()).status).toBe('missing');
    expect(evaluate(gun, inv({ '/G/Barrel': 1, '/G/Stock': 2 })).status).toBe('blueprints'); // Rohstoff fehlt
    expect(evaluate(gun, inv({ '/G/Barrel': 1, '/G/Stock': 2, '/Res/Orokin': 1 })).status).toBe('buildable');
    expect(evaluate(gun, inv({}, { player: { credits: 0 } })).creditsOk).toBe(false);
    expect(evaluate(gun, inv({}, { xp: { '/G': 1000 } })).status).toBe('leveling');
    const m = evaluate(gun, inv({}, { xp: { '/G': 450000 } }));
    expect(m.status).toBe('mastered');
    expect(m.rank).toBe(30);
  });

  it('Rang aus XP (Rang² × maxXp / 900)', () => {
    expect(evaluate(gun, inv({}, { xp: { '/G': 500 * 100 } })).rank).toBe(10);
    expect(evaluate(gun, inv({}, { xp: { '/G': 500 * 100 - 1 } })).rank).toBe(9);
  });

  it('Übrige Teile: nur über den Bedarf hinaus, Bauteile nur als Blaupause', () => {
    const db = { items: [gun, frame] };
    // 3 Läufe, 2 Schäfte (gebraucht: 1 Lauf, 2 Schäfte) + 2 Chassis-Blaupausen (gebraucht: 1)
    const spare = spareParts(db, inv({ '/G/Barrel': 3, '/G/Stock': 2, '/F/ChassisBlueprint': 2, '/F/ChassisComponent': 1 }));
    const by = Object.fromEntries(spare.map((s) => [s.id, s.spare]));
    // Gebautes Chassis deckt den Bedarf, also sind beide Blaupausen übrig
    expect(by).toEqual({ '/G/Barrel': 2, '/F/ChassisComponent': 2 });
  });

  it('Gemeisterte Items brauchen keine Teile mehr', () => {
    const db = { items: [gun] };
    const spare = spareParts(db, inv({ '/G/Barrel': 1, '/G/Stock': 2 }, { xp: { '/G': 450000 } }));
    expect(spare.map((s) => [s.id, s.spare])).toEqual([['/G/Barrel', 1], ['/G/Stock', 2]]);
  });

  it('Komplette Sets aus übrigen Teilen', () => {
    const spare = new Map([['/G/Barrel', 3], ['/G/Stock', 5]]);
    const sets = spareSets({ items: [gun] }, spare);
    expect(sets).toEqual([{ item: gun, count: 2 }]);
    expect(spare.get('/G/Barrel')).toBe(1);
    expect(spare.get('/G/Stock')).toBe(1);
  });

  it('WTS-Nachrichten bleiben unter dem Chat-Limit', () => {
    const entries = Array.from({ length: 12 }, (_, i) => ({ name: `Some Prime Part ${i}`, price: 10 + i, qty: i % 3 }));
    const msgs = wtsMessages(entries);
    expect(msgs.length).toBeGreaterThan(1);
    for (const m of msgs) {
      expect(m.startsWith('WTS ')).toBe(true);
      expect(m.length).toBeLessThanOrEqual(180);
    }
    expect(msgs.join(' ')).toContain('[Some Prime Part 2] x2 12p');
    expect(wtsMessages([])).toEqual([]);
  });

  it('kurze Zahlen', () => {
    expect(compact(950)).toBe('950');
    expect(compact(1500)).toBe('1.5K');
    expect(compact(2000000)).toBe('2M');
    expect(compact(null)).toBe('–');
  });
});

describe('Fehlertexte aus dem Rust-Teil', () => {
  it('Deutsch bleibt unverändert', async () => {
    const { translateError } = await import('./i18n.js');
    expect(translateError('de', new Error('Keine Verbindung – bist du online?'))).toBe('Keine Verbindung – bist du online?');
  });
  it('Englisch: feste Texte, Muster und retryAt-Zusatz', async () => {
    const { translateError } = await import('./i18n.js');
    expect(translateError('en', new Error('Keine Verbindung – bist du online?'))).toBe('No connection – are you online?');
    expect(translateError('en', 'HTTP 503 für /v2/items')).toBe('HTTP 503 for /v2/items');
    expect(translateError('en', 'HTTP 429 für /v1/auctions (retryAt 1794000000000)')).toBe('HTTP 429 for /v1/auctions (retryAt 1794000000000)');
    expect(translateError('en', 'Warframe-API antwortete mit HTTP 502. Später erneut versuchen.')).toBe('The Warframe API responded with HTTP 502. Try again later.');
    expect(translateError('en', 'etwas Unbekanntes')).toBe('etwas Unbekanntes');
    expect(translateError('en', null)).toBe('');
  });
});

// ---------- Suche, Seitenleiste, Startseite, Preisverlauf ----------
import { matchScore, searchList } from './search.js';
import { orderNav } from './nav.js';
import { nearlyComplete, tradeTip } from './today.js';
import { priceTrend, sparkPath } from './priceHistory.js';

describe('Suche', () => {
  it('bewertet Namensanfang höher als Wortanfang und Mitte', () => {
    expect(matchScore('Mirage Prime', 'mir')).toBeGreaterThan(matchScore('Ash Mirage', 'mir'));
    expect(matchScore('Ash Mirage', 'mir')).toBeGreaterThan(matchScore('Admirage', 'mir'));
    expect(matchScore('Mirage Prime', 'xyz')).toBe(0);
    expect(matchScore('Mirage Prime', '')).toBe(0);
  });
  it('verlangt alle Suchwörter und ignoriert Akzente und Großschreibung', () => {
    expect(matchScore('Mirage Prime Systems', 'prime sys')).toBeGreaterThan(0);
    expect(matchScore('Mirage Prime Systems', 'prime neuro')).toBe(0);
    expect(matchScore('Déjà Vu', 'deja')).toBeGreaterThan(0);
  });
  it('liefert die besten Treffer zuerst und begrenzt die Anzahl', () => {
    const list = ['Ash Prime', 'Prime Flow', 'Braton Prime', 'Primed Reach'].map((name) => ({ name }));
    const hits = searchList(list, 'prime', 3).map((h) => h.name);
    expect(hits).toHaveLength(3);
    expect(hits[0]).toBe('Prime Flow');
  });
});

describe('Seitenleiste', () => {
  const nav = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  it('behält ohne Einstellung die Reihenfolge', () => {
    expect(orderNav(nav, []).map((n) => n.id)).toEqual(['a', 'b', 'c']);
  });
  it('sortiert nach gespeicherter Reihenfolge, neue Seiten bleiben an ihrem Platz', () => {
    expect(orderNav(nav, ['c', 'a']).map((n) => n.id)).toEqual(['c', 'b', 'a']);
    expect(orderNav(nav, ['c', 'b', 'a']).map((n) => n.id)).toEqual(['c', 'b', 'a']);
    expect(orderNav([{ id: 'neu' }, ...nav], ['a', 'b', 'c'])[0].id).toBe('neu');
  });
});

describe('Startseite', () => {
  const part = (id, count = 1) => ({ kind: 'part', id, name: id, count, ducats: 45 });
  const item = (id, parts) => ({ id, name: id, isPrime: true, maxXp: 900000, maxRank: 30, components: parts });
  const db = { items: [item('A', [part('a1'), part('a2'), part('a3')]), item('B', [part('b1'), part('b2')]), item('C', [part('c1'), part('c2'), part('c3'), part('c4')])] };
  const inv = { xp: {}, owned: {}, counts: { a1: 1, a2: 1, c1: 1 }, player: { credits: 0 } };
  it('zeigt nur angefangene Sets, denen höchstens zwei Teile fehlen', () => {
    const r = nearlyComplete(db, inv);
    expect(r.map((x) => x.item.id)).toEqual(['A']);
    expect(r[0].have).toBe(2);
    expect(r[0].total).toBe(3);
    expect(r[0].missing.map((m) => m.id)).toEqual(['a3']);
  });
  it('überspringt gemeisterte Items und gefilterte', () => {
    expect(nearlyComplete(db, { ...inv, xp: { A: 900000 } })).toHaveLength(0);
    expect(nearlyComplete(db, inv, { skip: (i) => i.id === 'A' })).toHaveLength(0);
    expect(nearlyComplete(null, inv)).toEqual([]);
  });
  it('empfiehlt Baro ab 10 Ducats pro Platin', () => {
    expect(tradeTip(100, 5)).toBe('baro');
    expect(tradeTip(45, 20)).toBe('sell');
    expect(tradeTip(45, null)).toBe(null);
  });
});

describe('Preisverlauf', () => {
  const days = (values) => values.map((median) => ({ median, volume: 10 }));
  it('braucht mindestens vier Tage', () => {
    expect(priceTrend(days([1, 2, 3]))).toBe(null);
  });
  it('erkennt steigende und fallende Preise', () => {
    const up = priceTrend(days([10, 10, 10, 10, 10, 10, 10, 20, 20, 20, 20, 20, 20, 20]));
    expect(up.dir).toBe('up');
    expect(up.change).toBe(100);
    expect(up.hint).toMatch(/Verkaufen/);
    const down = priceTrend(days([20, 20, 20, 20, 20, 20, 20, 10, 10, 10, 10, 10, 10, 10]));
    expect(down.dir).toBe('down');
    expect(down.hint).toMatch(/Kaufen/);
    expect(priceTrend(days([10, 10, 10, 10, 10])).dir).toBe('flat');
  });
  it('zeichnet einen Pfad über die ganze Breite', () => {
    const p = sparkPath([1, 2, 3], 100, 40);
    expect(p.startsWith('M0 ')).toBe(true);
    expect(p).toContain('L100 ');
    expect(sparkPath([5], 100, 40)).toBe('');
  });
});

// ---------- Farm-Plan und Diagnose ----------
import { farmPlan } from './today.js';
import { diagnose, reportText } from './diagnose.js';

describe('Farm-Plan', () => {
  const sets = [{ item: { name: 'A Prime' }, missing: [{ id: '/x/APrimeChassisComponent', name: 'Chassis' }, { id: '/x/APrimeBarrel', name: 'Barrel' }] }];
  const relics = [
    { id: 'r1', name: 'Lith A1', tier: 'Lith', vaulted: false, rewards: { intact: [{ id: '/x/APrimeChassisBlueprint', chance: 11 }] } },
    { id: 'r2', name: 'Axi B2', tier: 'Axi', vaulted: false, rewards: { intact: [{ id: '/x/APrimeChassisBlueprint', chance: 2 }] } },
    { id: 'r3', name: 'Neo C3', tier: 'Neo', vaulted: false, rewards: { intact: [{ id: '/x/APrimeBarrel', chance: 25.33 }] } },
    { id: 'r4', name: 'Meso D4', tier: 'Meso', vaulted: true, rewards: { intact: [{ id: '/x/APrimeBarrel', chance: 25.33 }] } },
  ];
  it('findet eigene Relikte auch über die Blaupausen-Variante und stellt aktive Ären nach vorn', () => {
    const plan = farmPlan(sets, relics, { r1: { intact: 2 }, r2: { radiant: 1, intact: 1 } }, new Set(['Axi']));
    const chassis = plan.find((p) => p.part.name === 'Chassis');
    expect(chassis.active).toBe(true);
    expect(chassis.relics.map((r) => r.name)).toEqual(['Axi B2', 'Lith A1']);
    expect(chassis.relics[0].owned).toBe(2);
    expect(plan[0].part.name).toBe('Chassis');
  });
  it('nennt ohne eigenes Relikt nur Quellen außerhalb des Vaults', () => {
    const barrel = farmPlan(sets, relics, {}, new Set()).find((p) => p.part.name === 'Barrel');
    expect(barrel.relics).toEqual([]);
    expect(barrel.sources).toEqual(['Neo C3']);
    expect(farmPlan(sets, null, {}, new Set())).toEqual([]);
  });
});

describe('Diagnose', () => {
  const now = Date.UTC(2026, 10, 15, 12);
  const good = { version: '0.2.3', webview: '1', game: true, log: { size: 5, modified: now - 120000 }, writable: true, net: { online: true }, market: { ok: true, ms: 300 }, overlay: true, relicDb: true };
  const state = (rows, id) => rows.find((r) => r.id === id).state;
  it('meldet alles grün, wenn alles da ist', () => {
    const rows = diagnose(good, { syncedAt: now - 3600000, syncError: null, worldAt: now - 60000, worldOffline: false, now });
    expect(rows.every((r) => r.state === 'ok')).toBe(true);
    expect(rows.find((r) => r.id === 'sync').vars.t).toBe('1 h');
  });
  it('erkennt fehlendes Spiel, Offline und Markt-Fehler', () => {
    const rows = diagnose({ ...good, game: false, log: null, net: { online: false }, market: { ok: false, error: 'HTTP 503' }, writable: false }, { syncedAt: null, syncError: null, worldAt: null, worldOffline: true, now });
    expect(state(rows, 'game')).toBe('warn');
    expect(state(rows, 'log')).toBe('warn');
    expect(state(rows, 'net')).toBe('bad');
    expect(state(rows, 'market')).toBe('bad');
    expect(state(rows, 'data')).toBe('bad');
    expect(state(rows, 'sync')).toBe('warn');
    const text = reportText({ ...good, overlay: false }, rows);
    expect(text).toContain('[FEHLER] warframe.market: Nicht erreichbar: HTTP 503');
    expect(text).toContain('Cephalon Merlin 0.2.3');
  });
});

// ---------- Checkliste und Baros Angebot ----------
import { periodKey, nextReset, isDone, toggled } from './checklist.js';
import { baroOffer, prettyId } from './baro.js';

describe('Checkliste', () => {
  const mon = Date.UTC(2026, 10, 16); // Montag, 16.11.2026
  const H = 3600000;
  it('wechselt täglich um Mitternacht UTC und wöchentlich am Montag', () => {
    expect(periodKey('daily', mon - 1)).toBe(periodKey('daily', mon) - 1);
    expect(periodKey('weekly', mon - 1)).toBe(periodKey('weekly', mon) - 1);
    expect(periodKey('weekly', mon + 6 * 24 * H + 23 * H)).toBe(periodKey('weekly', mon));
    expect(nextReset('daily', mon + 5 * H)).toBe(mon + 24 * H);
    expect(nextReset('weekly', mon + 5 * H)).toBe(mon + 7 * 24 * H);
    expect(nextReset('weekly', mon - 1)).toBe(mon);
  });
  it('setzt Haken, die mit dem Zeitraum verfallen, und räumt alte auf', () => {
    const a = { id: 'a', kind: 'daily' };
    const w = { id: 'w', kind: 'weekly' };
    let s = { tasks: [a, w], done: { weg: 1 } };
    s = toggled(s, a, mon);
    s = toggled(s, w, mon);
    expect(s.done.weg).toBeUndefined();
    expect(isDone(s, a, mon + 23 * H)).toBe(true);
    expect(isDone(s, a, mon + 24 * H)).toBe(false);
    expect(isDone(s, w, mon + 24 * H)).toBe(true);
    expect(isDone(toggled(s, a, mon), a, mon)).toBe(false);
  });
});

describe('Baros Angebot', () => {
  it('macht aus internen Namen lesbare', () => {
    expect(prettyId('/Lotus/Upgrades/Mods/PrimedContinuityMod')).toBe('Primed Continuity Mod');
    expect(prettyId('/Lotus/Types/TNWGlyph')).toBe('TNW Glyph');
  });
  it('löst Namen auf, erkennt Besitz und Leistbarkeit und sortiert Fehlendes nach vorn', () => {
    const items = [
      { id: '/a/Owned', ducats: 500, credits: 100 },
      { id: '/a/Known', ducats: 300, credits: 100 },
      { id: '/a/UnknownThing', ducats: 400, credits: 999999 },
    ];
    const byRef = new Map([['/a/Known', { name: 'Primed Flow', thumb: 't.png' }], ['/a/Owned', { name: 'Primed Reach' }]]);
    const inv = { counts: { '/a/Owned': 1 }, owned: {}, player: { ducats: 350, credits: 5000 } };
    const o = baroOffer(items, byRef, new Map(), inv);
    expect(o.map((x) => x.name)).toEqual(['Primed Flow', 'Unknown Thing', 'Primed Reach']);
    expect(o[0].affordable).toBe(true);
    expect(o[1].affordable).toBe(false);
    expect(o[1].known).toBe(false);
    expect(o[2].owned).toBe(1);
    expect(baroOffer(undefined, byRef, null, null)).toEqual([]);
  });
});
