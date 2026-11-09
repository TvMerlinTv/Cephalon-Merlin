//! Erkennt aus OCR-Wörtern, was im Spiel gerade zu sehen ist (Port von electron/screenScan.cjs):
//!  - "selection": Relikt-Auswahl ("Meso V17 Relic [Radiant] - Possible Rewards") + Kacheln im Raster
//!  - "rewards":   Belohnungs-Bildschirm nach der Spalten-Mission (bis zu 4 Teile)
use crate::ocr::Word;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};

// ---------- unscharfer Textvergleich ----------
fn norm(s: &str) -> Vec<char> {
    s.to_lowercase().chars().filter(|c| c.is_ascii_lowercase() || c.is_ascii_digit()).collect()
}

fn levenshtein(a: &[char], b: &[char]) -> usize {
    if a == b {
        return 0;
    }
    let mut prev: Vec<usize> = (0..=b.len()).collect();
    for i in 1..=a.len() {
        let mut diag = prev[0];
        prev[0] = i;
        for j in 1..=b.len() {
            let tmp = prev[j];
            prev[j] = (prev[j] + 1).min(prev[j - 1] + 1).min(diag + usize::from(a[i - 1] != b[j - 1]));
            diag = tmp;
        }
    }
    prev[b.len()]
}

pub fn similarity(a: &str, b: &str) -> f64 {
    let (x, y) = (norm(a), norm(b));
    if x.is_empty() || y.is_empty() {
        return 0.0;
    }
    1.0 - levenshtein(&x, &y) as f64 / x.len().max(y.len()) as f64
}

#[derive(Clone, Debug)]
pub struct Block {
    pub text: String,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

/// Wörter zu Textblöcken gruppieren – ein Name kann über 2–3 Zeilen umbrechen.
pub fn group_blocks(words: &[Word]) -> Vec<Block> {
    let n = words.len();
    let mut parent: Vec<usize> = (0..n).collect();
    fn find(p: &mut [usize], i: usize) -> usize {
        let mut r = i;
        while p[r] != r {
            r = p[r];
        }
        let mut c = i;
        while p[c] != r {
            let nx = p[c];
            p[c] = r;
            c = nx;
        }
        r
    }
    for i in 0..n {
        for j in i + 1..n {
            let (a, b) = (&words[i], &words[j]);
            let h = a.h.max(b.h).max(8.0);
            let same_line = (a.y - b.y).abs() < h * 0.6;
            let gap_x = a.x.max(b.x) - (a.x + a.w).min(b.x + b.w);
            let gap_y = a.y.max(b.y) - (a.y + a.h).min(b.y + b.h);
            let overlap_x = (a.x + a.w).min(b.x + b.w) - a.x.max(b.x);
            if (same_line && gap_x < h * 1.1) || (!same_line && gap_y < h * 0.9 && overlap_x > -h * 0.5) {
                let (ra, rb) = (find(&mut parent, i), find(&mut parent, j));
                parent[ra] = rb;
            }
        }
    }
    let mut groups: Vec<(usize, Vec<&Word>)> = Vec::new();
    for i in 0..n {
        let k = find(&mut parent, i);
        match groups.iter_mut().find(|(key, _)| *key == k) {
            Some((_, g)) => g.push(&words[i]),
            None => groups.push((k, vec![&words[i]])),
        }
    }
    groups
        .into_iter()
        .map(|(_, mut ws)| {
            ws.sort_by(|a, b| {
                if (a.y - b.y).abs() < a.h * 0.6 {
                    a.x.partial_cmp(&b.x).unwrap()
                } else {
                    a.y.partial_cmp(&b.y).unwrap()
                }
            });
            let x = ws.iter().map(|w| w.x).fold(f64::INFINITY, f64::min);
            let y = ws.iter().map(|w| w.y).fold(f64::INFINITY, f64::min);
            let r = ws.iter().map(|w| w.x + w.w).fold(f64::NEG_INFINITY, f64::max);
            let b = ws.iter().map(|w| w.y + w.h).fold(f64::NEG_INFINITY, f64::max);
            Block { text: ws.iter().map(|w| w.t.as_str()).collect::<Vec<_>>().join(" "), x, y, w: r - x, h: b - y }
        })
        .collect()
}

fn best_match<'a>(text: &str, names: &[&'a str], min: f64) -> Option<(&'a str, f64)> {
    let mut best = None;
    let mut score = min;
    for n in names {
        let s = similarity(text, n);
        if s > score {
            score = s;
            best = Some(*n);
        }
    }
    best.map(|n| (n, score))
}

fn is_caps(t: &str) -> bool {
    let letters: String = t.chars().filter(|c| c.is_ascii_alphabetic()).collect();
    letters.len() >= 6 && letters == letters.to_uppercase()
}

fn is_tooltip_word(t: &str) -> bool {
    let l = t.to_lowercase();
    l == "tradeable" || l == "untradeable" || l == "exchanged" || l.starts_with("ducats") && l.len() <= 7 || l.starts_with("component") && l.len() <= 10
}

/// Rechteck des Hover-Tooltips über einer Belohnung (Titel in GROSSBUCHSTABEN) oder None.
fn find_tooltip(words: &[Word], reward_blocks: &[&Block], reward_names: &[&str]) -> Option<Value> {
    let title = reward_blocks.iter().find(|b| is_caps(&b.text) && best_match(&b.text, reward_names, 0.7).is_some())?;
    let line_h = title.h.min(
        words.iter().filter(|w| w.y >= title.y - 2.0 && w.y <= title.y + title.h).map(|w| w.h).fold(8.0, f64::max),
    );
    let below: Vec<&Word> = words
        .iter()
        .filter(|w| is_tooltip_word(&w.t) && w.y > title.y && w.y < title.y + line_h * 14.0 && w.x >= title.x - line_h * 2.0)
        .collect();
    let bottom = if below.is_empty() {
        title.y + title.h + line_h * 6.0
    } else {
        below.iter().map(|w| w.y + w.h).fold(f64::NEG_INFINITY, f64::max) + line_h * 0.6
    };
    let mut right = title.x + title.w;
    let mut band: Vec<&Word> = words.iter().filter(|w| w.y >= title.y && w.y + w.h <= bottom + line_h && w.x >= title.x - line_h * 2.0).collect();
    band.sort_by(|a, b| a.y.partial_cmp(&b.y).unwrap());
    let mut lines: Vec<Vec<&Word>> = Vec::new();
    for w in band {
        match lines.iter_mut().find(|l| (l[0].y - w.y).abs() < line_h * 0.6) {
            Some(l) => l.push(w),
            None => lines.push(vec![w]),
        }
    }
    for mut line in lines {
        line.sort_by(|a, b| a.x.partial_cmp(&b.x).unwrap());
        if line[0].x > title.x + line_h * 3.0 {
            continue;
        }
        let mut end = line[0].x + line[0].w;
        for w in &line[1..] {
            if w.x - end > line_h * 2.5 {
                break;
            }
            end = end.max(w.x + w.w);
        }
        right = right.max(end);
    }
    let pad = line_h * 0.6;
    Some(json!({ "x": title.x - pad, "y": title.y - pad, "w": right - title.x + pad * 2.0 + line_h * 1.5, "h": bottom - title.y + pad * 2.0 }))
}

const ERAS: [&str; 5] = ["Lith", "Meso", "Neo", "Axi", "Requiem"];

/// Ära aus "MESO ERA" oben links – sonst die häufigste Ära der Kachelnamen ("Lith A2 Relic").
fn find_era(words: &[Word]) -> Option<&'static str> {
    for i in 0..words.len().saturating_sub(1) {
        let next = &words[i + 1];
        if similarity(&next.t, "era") < 0.6 || (next.y - words[i].y).abs() > words[i].h * 0.6 {
            continue;
        }
        if let Some(e) = ERAS.iter().find(|e| similarity(&words[i].t, e) >= 0.75) {
            return Some(e);
        }
    }
    let mut votes: HashMap<&str, u32> = HashMap::new();
    for i in 0..words.len().saturating_sub(2) {
        if similarity(&words[i + 2].t, "relic") < 0.6 {
            continue;
        }
        if let Some(e) = ERAS.iter().find(|e| similarity(&words[i].t, e) >= 0.75) {
            *votes.entry(e).or_insert(0) += 1;
        }
    }
    // Bei Gleichstand gewinnt (wie in JS) die zuerst gezählte Ära
    let mut best: Option<(&str, u32)> = None;
    for e in ERAS {
        if let Some(&n) = votes.get(e) {
            if best.map_or(true, |(_, b)| n > b) {
                best = Some((e, n));
            }
        }
    }
    best.filter(|(_, n)| *n >= 3).and_then(|(e, _)| ERAS.iter().find(|x| **x == e).copied())
}

// Typische OCR-Verwechslungen in Relikt-Codes ("Lith 83" = B3, "GS" = G9, "MIO" = M10, "07" = D7)
fn as_letter(c: char) -> &'static [&'static str] {
    match c {
        '8' => &["B"],
        '0' => &["D", "O"],
        '1' => &["I"],
        '5' => &["S"],
        '6' => &["G"],
        '2' => &["Z"],
        '4' => &["A"],
        _ => &[],
    }
}
fn as_digit(c: char) -> &'static [&'static str] {
    match c {
        'I' | 'L' | '|' | '!' | 'J' | 'F' => &["1"],
        'T' => &["7"],
        'O' | 'Q' | 'D' | 'U' => &["0"],
        'S' => &["5", "9"],
        'G' => &["6", "9"],
        'B' => &["8"],
        'Z' => &["2"],
        'A' => &["4"],
        _ => &[],
    }
}

/// Alle plausiblen Lesarten eines Codes: Buchstabe + Ziffern.
fn code_variants(raw: &str) -> Vec<String> {
    let s: Vec<char> = raw.to_uppercase().chars().filter(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || *c == '|' || *c == '!').collect();
    if s.len() < 2 || s.len() > 4 {
        return vec![];
    }
    let mut out: Vec<String> = if s[0].is_ascii_uppercase() { vec![s[0].to_string()] } else { as_letter(s[0]).iter().map(|x| x.to_string()).collect() };
    for &ch in &s[1..] {
        let opts: Vec<String> = if ch.is_ascii_digit() { vec![ch.to_string()] } else { as_digit(ch).iter().map(|x| x.to_string()).collect() };
        out = out.iter().flat_map(|p| opts.iter().map(move |o| format!("{p}{o}"))).collect();
        if out.len() > 64 {
            return vec![];
        }
    }
    out
}

fn letters_only(t: &str) -> String {
    t.chars().filter(|c| c.is_ascii_alphabetic()).collect()
}

/// "Relic" an den Code geklebt: "2ZRelic", "A11'Relic" -> Code-Teil davor.
fn glued_relic(t: &str) -> Option<String> {
    let chars: Vec<char> = t.chars().collect();
    if chars.len() < 6 {
        return None;
    }
    let tail: String = chars[chars.len() - 5..].iter().collect::<String>().to_lowercase();
    let t1 = tail.chars().nth(1)?;
    let t2 = tail.chars().nth(2)?;
    let t3 = tail.chars().nth(3)?;
    let t4 = tail.chars().nth(4)?;
    let ok = tail.chars().next()?.is_ascii_alphabetic() && t1 == 'e' && t2 == 'l' && (t3 == 'i' || t3 == 'l' || t3 == '1') && t4 == 'c';
    if !ok {
        return None;
    }
    let mut head: Vec<char> = chars[..chars.len() - 5].to_vec();
    if matches!(head.last(), Some('\'' | '’' | '.' | ',')) {
        head.pop();
    }
    if head.is_empty() || head.len() > 3 {
        return None;
    }
    // Ein Buchstabe direkt vor "Relic" nach einer Ziffer ist Müll ("2ZRelic" = 2)
    if head.len() >= 2 && head[head.len() - 1].is_ascii_alphabetic() && head[head.len() - 2].is_ascii_digit() {
        head.pop();
    }
    Some(head.into_iter().collect())
}

/// Code aus einem Kachel-Namen: "Neo A1 6 Relic" (A16), "Neo Bl Aelic" (B1), "Neo G8".
fn tile_code(text: &str, era: &str) -> Option<String> {
    let mut tokens: Vec<String> = text.split_whitespace().map(String::from).collect();
    if tokens.is_empty() {
        return None;
    }
    // Ära an den Code geklebt ("MesoV17")
    let first: Vec<char> = tokens[0].chars().collect();
    if first.len() > era.len() + 1 && similarity(&first[..era.len()].iter().collect::<String>(), era) >= 0.75 {
        let a: String = first[..era.len()].iter().collect();
        let b: String = first[era.len()..].iter().collect();
        tokens.splice(0..1, [a, b]);
    }
    if tokens.len() < 2 || similarity(&tokens[0], era) < 0.6 {
        return None;
    }
    let is_relic = |t: &str| t.chars().count() >= 4 && similarity(&letters_only(t), "relic") >= 0.6;
    let mut parts = String::new();
    for t in &tokens[1..] {
        if let Some(head) = glued_relic(t) {
            return Some(parts + &head);
        }
        if is_relic(t) {
            return Some(parts);
        }
        parts.push_str(t);
        if parts.chars().count() > 4 {
            return None;
        }
    }
    // Kein "Relic" gelesen: nur "<Ära> <Code>" allein im Block gilt
    (tokens.len() == 2).then(|| tokens[1].clone())
}

fn find_tiles(blocks: &[Block], relics: &[Value], era: &str, right_edge: f64, owned: Option<&HashSet<String>>, owned_only: bool) -> Vec<Value> {
    let by_code: HashMap<String, &Value> = relics
        .iter()
        .filter(|r| r["tier"] == era)
        .map(|r| (r["name"].as_str().unwrap_or("").split(' ').skip(1).collect::<Vec<_>>().join(" ").to_uppercase(), r))
        .collect();
    let lookup = |code: &str| -> Vec<&Value> {
        let mut variants = code_variants(code);
        // "L3" wird gern als "I3" gelesen (und umgekehrt)
        for v in variants.clone() {
            if v.starts_with('I') || v.starts_with('L') {
                let swapped = if v.starts_with('I') { 'L' } else { 'I' };
                variants.push(format!("{swapped}{}", &v[1..]));
            }
        }
        let mut seen = HashSet::new();
        let hits: Vec<&Value> = variants.into_iter().filter(|v| seen.insert(v.clone())).filter_map(|c| by_code.get(&c).copied()).collect();
        let Some(owned) = owned else { return hits };
        // Eigene Relikte haben Vorrang – das löst "GS" = G5 oder G9 auf
        let own: Vec<&Value> = hits.iter().copied().filter(|r| owned.contains(r["id"].as_str().unwrap_or(""))).collect();
        if !own.is_empty() || owned_only { own } else { hits }
    };
    let mut tiles = Vec::new();
    for b in blocks {
        if b.x > right_edge {
            continue;
        }
        let Some(code) = tile_code(&b.text, era) else { continue };
        let hits = lookup(&code);
        if hits.len() != 1 {
            continue;
        }
        tiles.push(json!({ "relicId": hits[0]["id"], "name": hits[0]["name"], "x": b.x, "y": b.y, "w": b.w, "h": b.h }));
    }
    tiles
}

/// Sortierung und Suchtext über dem Raster ("REFINEMENT ▼  SEARCH...").
fn grid_view(words: &[Word]) -> Value {
    const SORTS: [&str; 3] = ["name", "refinement", "owned"];
    let Some(col) = words.iter().find(|w| similarity(&w.t, "collected") >= 0.7) else {
        return json!({ "sort": null, "search": null });
    };
    let line: Vec<&Word> = words
        .iter()
        .filter(|w| w.y > col.y + col.h * 0.5 && w.y < col.y + col.h * 4.0 && (w.x - col.x).abs() < col.w * 4.0)
        .collect();
    let sort_word = line.iter().find(|w| SORTS.iter().any(|s| similarity(&w.t, s) >= 0.8));
    let sort = sort_word.and_then(|w| SORTS.iter().find(|s| similarity(&w.t, s) >= 0.8));
    let rest: Vec<&&Word> = line
        .iter()
        .filter(|w| !sort_word.is_some_and(|s| std::ptr::eq::<Word>(*s, **w)))
        .filter(|w| sort_word.map_or(true, |s| w.x > s.x + s.w))
        .filter(|w| w.t.chars().any(|c| c.is_ascii_alphanumeric()))
        .collect();
    let search = if rest.iter().any(|w| similarity(&letters_only(&w.t), "search") >= 0.7) {
        json!("")
    } else if rest.is_empty() {
        Value::Null
    } else {
        json!(rest.iter().map(|w| w.t.to_lowercase()).collect::<Vec<_>>().join(" "))
    };
    json!({ "sort": sort, "search": search })
}

fn rewards_of<'a>(relic: &'a Value, refinement: &str) -> Vec<&'a Value> {
    let r = &relic["rewards"];
    r[refinement].as_array().or_else(|| r["intact"].as_array()).map(|a| a.iter().collect()).unwrap_or_default()
}

/// Hauptauswertung. `owned`: eigene Relikt-IDs (lösen mehrdeutige Kachel-Namen auf).
pub fn analyze(words: &[Word], relics: &[Value], owned: Option<&HashSet<String>>) -> Value {
    let mut name_set = HashSet::new();
    let reward_names: Vec<&str> = relics
        .iter()
        .flat_map(|r| r["rewards"]["intact"].as_array().into_iter().flatten())
        .filter_map(|w| w["name"].as_str())
        .filter(|n| name_set.insert(*n))
        .collect();
    let blocks = group_blocks(words);
    let era = find_era(words);
    let possible = words.iter().find(|w| w.t.eq_ignore_ascii_case("possible"));
    // Raster endet links vom Titel "<Relikt> - Possible Rewards"
    let title_left = possible
        .map(|p| words.iter().filter(|w| (w.y - p.y).abs() < p.h * 0.6).map(|w| w.x).fold(f64::INFINITY, f64::min))
        .unwrap_or(f64::INFINITY);
    let view = grid_view(words);
    let owned_only = matches!(view["sort"].as_str(), Some("refinement" | "owned"));
    let tiles = era.map(|e| find_tiles(&blocks, relics, e, title_left - 10.0, owned, owned_only)).unwrap_or_default();

    // 1) Relikt-Auswahl: Zeile "<Name> Relic [<Stufe>] - Possible Rewards"
    if let Some(p) = possible {
        let mut line: Vec<&Word> = words.iter().filter(|w| (w.y - p.y).abs() < p.h * 0.6 && w.x < p.x).collect();
        line.sort_by(|a, b| a.x.partial_cmp(&b.x).unwrap());
        let texts: Vec<&str> = line.iter().map(|w| w.t.as_str()).collect();
        let relic_word = texts.iter().position(|t| t.to_lowercase().starts_with("relic"));
        let name_guess = match relic_word {
            Some(i) if i > 0 => texts[..i].join(" "),
            _ => texts.join(" "),
        };
        let refinement = texts
            .iter()
            .map(|t| norm(t).into_iter().collect::<String>())
            .find(|t| matches!(t.as_str(), "intact" | "exceptional" | "flawless" | "radiant"))
            .unwrap_or_else(|| "intact".into());

        let below: Vec<&Block> = blocks.iter().filter(|b| b.y > p.y + p.h && b.x > p.x - p.w * 6.0).collect();
        let tooltip = find_tooltip(words, &below, &reward_names);
        let reward_blocks: Vec<&Block> = below.iter().copied().filter(|b| !is_caps(&b.text)).collect();
        let shown: Vec<&str> = reward_blocks.iter().filter_map(|b| best_match(&b.text, &reward_names, 0.7).map(|m| m.0)).collect();

        // Bester Kandidat: Name ähnlich + möglichst viele passende Belohnungen
        let mut best: Option<(&Value, f64, f64, usize)> = None;
        for r in relics {
            let name_score = similarity(&name_guess, r["name"].as_str().unwrap_or(""));
            if name_score < 0.5 {
                continue;
            }
            let names: HashSet<&str> = rewards_of(r, &refinement).iter().filter_map(|w| w["name"].as_str()).collect();
            let hits = shown.iter().filter(|n| names.contains(*n)).count();
            let score = name_score + hits as f64 * 0.5;
            if best.map_or(true, |b| score > b.1) {
                best = Some((r, score, name_score, hits));
            }
        }
        if let Some((relic, _, name_score, hits)) = best {
            // Positionen nur gegen die 6 Belohnungen dieses Relikts abgleichen, jeden Namen nur einmal
            let own: Vec<&str> = rewards_of(relic, &refinement).iter().filter_map(|w| w["name"].as_str()).collect();
            let mut pairs: Vec<(usize, &str, f64)> = reward_blocks
                .iter()
                .enumerate()
                .flat_map(|(bi, b)| own.iter().map(move |n| (bi, *n, similarity(&b.text, n))))
                .filter(|p| p.2 >= 0.6)
                .collect();
            pairs.sort_by(|a, b| b.2.partial_cmp(&a.2).unwrap());
            let (mut used_b, mut used_n) = (HashSet::new(), HashSet::new());
            let mut spots = Vec::new();
            for (bi, name, _) in pairs {
                if used_b.contains(&bi) || used_n.contains(name) {
                    continue;
                }
                used_b.insert(bi);
                used_n.insert(name);
                let b = reward_blocks[bi];
                spots.push(json!({ "name": name, "x": b.x, "y": b.y, "w": b.w, "h": b.h }));
            }
            return json!({
                "mode": "selection",
                "era": era.map(String::from).unwrap_or_else(|| relic["tier"].as_str().unwrap_or("").to_string()),
                "relicId": relic["id"],
                "relicName": relic["name"],
                "refinement": refinement,
                "nameScore": name_score,
                "rewardHits": hits,
                "anchor": { "x": p.x, "y": p.y, "h": p.h },
                "titleLeft": title_left,
                "spots": spots,
                "tooltip": tooltip,
                "tiles": tiles,
                "view": view,
            });
        }
    }

    // Relikt-Auswahl ohne angeklicktes Relikt: nur die Ära (+ Kacheln)
    let no_relic = words.iter().enumerate().any(|(i, w)| w.t.eq_ignore_ascii_case("select") && words.get(i + 2).is_some_and(|n| similarity(&n.t, "relic") >= 0.6));
    if let Some(e) = era {
        return json!({ "mode": "selection", "era": e, "relicId": null, "tiles": tiles, "noRelic": no_relic, "view": view });
    }

    // 2) Belohnungs-Bildschirm: Blöcke, die nach Prime-Teilen klingen, nebeneinander
    let mut items: Vec<(&str, f64, &Block)> = blocks.iter().filter_map(|b| best_match(&b.text, &reward_names, 0.72).map(|(n, s)| (n, s, b))).collect();
    if items.is_empty() {
        return json!({ "mode": "none" });
    }
    // Nur die Reihe mit den meisten Treffern (die Belohnungen stehen auf einer Höhe)
    let mut rows: Vec<(f64, Vec<(&str, f64, &Block)>)> = Vec::new();
    for it in items.drain(..) {
        match rows.iter_mut().find(|(y, _)| (y - it.2.y).abs() < it.2.h * 1.5) {
            Some((_, r)) => r.push(it),
            None => rows.push((it.2.y, vec![it])),
        }
    }
    let mut row = rows.into_iter().max_by_key(|(_, r)| r.len()).map(|(_, r)| r).unwrap_or_default();
    row.sort_by(|a, b| a.2.x.partial_cmp(&b.2.x).unwrap());
    let items: Vec<Value> = row
        .into_iter()
        .take(4)
        .map(|(n, s, b)| json!({ "name": n, "score": s, "x": b.x, "y": b.y, "w": b.w, "h": b.h }))
        .collect();
    json!({ "mode": "rewards", "items": items })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn w(t: &str, x: f64, y: f64) -> Word {
        Word { t: t.into(), x, y, w: 10.0 * t.len() as f64, h: 20.0 }
    }

    #[test]
    fn codes_and_tiles() {
        assert!(code_variants("GS").contains(&"G5".to_string()));
        assert!(code_variants("GS").contains(&"G9".to_string()));
        assert_eq!(tile_code("Neo A1 6 Relic", "Neo").as_deref(), Some("A16"));
        assert_eq!(tile_code("Neo A1 2ZRelic", "Neo").as_deref(), Some("A12"));
        assert_eq!(tile_code("Neo G8", "Neo").as_deref(), Some("G8"));
        assert_eq!(tile_code("MesoV17 Relic", "Meso").as_deref(), Some("V17"));
        assert!(similarity("Helic", "relic") >= 0.6);
    }

    #[test]
    fn rewards_screen() {
        let relics = vec![json!({ "id": "r1", "name": "Lith A1", "tier": "Lith", "rewards": { "intact": [
            { "name": "Ash Prime Systems Blueprint", "chance": 25.33 },
            { "name": "Forma Blueprint", "chance": 25.33 }
        ] } })];
        let words = vec![w("Ash", 100.0, 500.0), w("Prime", 140.0, 500.0), w("Systems", 200.0, 500.0), w("Blueprint", 100.0, 522.0), w("Forma", 600.0, 500.0), w("Blueprint", 600.0, 522.0)];
        let r = analyze(&words, &relics, None);
        assert_eq!(r["mode"], "rewards");
        assert_eq!(r["items"].as_array().unwrap().len(), 2);
        assert_eq!(r["items"][0]["name"], "Ash Prime Systems Blueprint");
    }
}
