//! Macht aus der rohen inventory.php-Antwort eine kompakte Zusammenfassung für die Oberfläche.
//! Gleiches Format wie electron/inventory.cjs, damit die Seiten dieselben Felder nutzen können.
use serde_json::{json, Map, Value};
use std::collections::BTreeMap;

/// Ausrüstung, die Mastery gibt (eigene Exemplare).
const GEAR_KEYS: [&str; 18] = [
    "Suits", "LongGuns", "Pistols", "Melee", "SpaceSuits", "SpaceGuns", "SpaceMelee", "Sentinels",
    "SentinelWeapons", "KubrowPets", "MoaPets", "MechSuits", "Hoverboards", "OperatorAmps",
    "CrewShipWeapons", "Horses", "DataKnives", "Motorcycles",
];

const REFINEMENTS: [(&str, &str); 4] =
    [("Bronze", "intact"), ("Silver", "exceptional"), ("Gold", "flawless"), ("Platinum", "radiant")];

pub const DUCATS: &str = "/Lotus/Types/Items/MiscItems/PrimeBucks";

fn arr<'a>(inv: &'a Value, key: &str) -> impl Iterator<Item = &'a Value> {
    inv.get(key).and_then(Value::as_array).into_iter().flatten()
}

fn num(v: Option<&Value>) -> Option<i64> {
    v.and_then(|x| x.as_i64().or_else(|| x.as_f64().map(|f| f as i64)))
}

/// Relikte liegen mit Veredelungsstufe vor (…Bronze = intakt); warframe.market kennt nur das Basis-Relikt.
fn normalize(t: &str) -> (&str, Option<&'static str>) {
    if t.contains("/Projections/") {
        for (suffix, name) in REFINEMENTS {
            if let Some(base) = t.strip_suffix(suffix) {
                return (base, Some(name));
            }
        }
        return (t, Some("intact"));
    }
    (t, None)
}

/// ".../Randomized/LotusRifleRandomModRare" -> "LotusRifle", ".../RawRifleRandomMod" -> "Rifle"
fn riven_type(item_type: &str) -> String {
    let last = item_type.rsplit('/').next().unwrap_or("");
    let s = last.strip_suffix("RandomModRare").or_else(|| last.strip_suffix("RandomMod")).unwrap_or(last);
    s.strip_prefix("Raw").unwrap_or(s).to_string()
}

/// Werte im UpgradeFingerprint: 0 … 0x3FFFFFFF -> Würfelergebnis 0 … 1 (90 % … 110 %)
const ROLL_MAX: f64 = 0x3fff_ffff as f64;

fn fingerprint(e: &Value) -> Value {
    e.get("UpgradeFingerprint")
        .and_then(Value::as_str)
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or(Value::Null)
}

fn parse_riven(e: &Value) -> Value {
    let f = fingerprint(e);
    let stats = |key: &str| -> Vec<Value> {
        f.get(key)
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .map(|b| {
                let v = b.get("Value").and_then(Value::as_f64).unwrap_or(0.0);
                json!({ "tag": b.get("Tag"), "roll": (v / ROLL_MAX).clamp(0.0, 1.0) })
            })
            .collect()
    };
    let last = |v: Option<&Value>| v.and_then(Value::as_str).map(|s| s.rsplit('/').next().unwrap_or("").to_string());
    let challenge = f.get("challenge").filter(|c| c.is_object()).map(|c| {
        json!({
            "type": last(c.get("Type")).unwrap_or_default(),
            "progress": num(c.get("Progress")).unwrap_or(0),
            "required": num(c.get("Required")).unwrap_or(1),
            "complication": last(c.get("Complication")),
        })
    });
    json!({
        "id": e.pointer("/ItemId/$oid"),
        "type": riven_type(e.get("ItemType").and_then(Value::as_str).unwrap_or("")),
        "compat": f.get("compat"),
        "rank": num(f.get("lvl")).unwrap_or(0),
        "mr": f.get("lvlReq"),
        "rerolls": num(f.get("rerolls")).unwrap_or(0),
        "polarity": f.get("pol"),
        "buffs": stats("buffs"),
        "curses": stats("curses"),
        "challenge": challenge,
    })
}

/// Blaupause -> [Ergebnis, Name, Bild] (data/recipeData.json, aus warframe-public-export-plus + WFCD erzeugt).
fn recipes() -> &'static serde_json::Map<String, Value> {
    static R: std::sync::OnceLock<serde_json::Map<String, Value>> = std::sync::OnceLock::new();
    R.get_or_init(|| serde_json::from_str(include_str!("../../data/recipeData.json")).unwrap_or_default())
}
const FOUNDRY_IMG: &str = "https://cdn.warframestat.us/img/";

/// Laufende Foundry-Bauaufträge; unbekannte (neue) Blaupausen bekommen einen Namen aus dem Pfad.
fn parse_foundry(inv: &Value) -> Vec<Value> {
    let mut out: Vec<Value> = arr(inv, "PendingRecipes")
        .filter_map(|e| {
            let t = e.get("ItemType")?.as_str()?;
            let d = e.pointer("/CompletionDate/$date");
            let ms = d
                .and_then(|d| d.get("$numberLong").and_then(Value::as_str).and_then(|s| s.parse::<i64>().ok()).or_else(|| num(Some(d))))
                .filter(|&ms| ms > 0);
            let r = recipes().get(t);
            let field = |i: usize| r.and_then(|r| r.get(i)).cloned().filter(|v| !v.is_null());
            let name = field(1).unwrap_or_else(|| json!(split_camel(t.rsplit('/').next().unwrap_or(t).trim_end_matches("Blueprint"))));
            let image = field(2).and_then(|v| v.as_str().map(|i| json!(format!("{FOUNDRY_IMG}{i}"))));
            Some(json!({ "recipe": t, "item": field(0), "name": name, "image": image, "completesAt": ms }))
        })
        .collect();
    out.sort_by_key(|v| v["completesAt"].as_i64().unwrap_or(i64::MAX));
    out
}

fn split_camel(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 4);
    let mut prev_lower = false;
    for c in s.chars() {
        if c.is_ascii_uppercase() && prev_lower {
            out.push(' ');
        }
        prev_lower = c.is_ascii_lowercase();
        out.push(c);
    }
    out
}

pub fn summarize(inv: &Value, synced_at: i64, source: &str) -> Value {
    let mut counts: BTreeMap<String, i64> = BTreeMap::new();
    let mut relics: BTreeMap<String, Map<String, Value>> = BTreeMap::new();
    let mut add = |t: &str, n: i64| {
        let (base, refinement) = normalize(t);
        *counts.entry(base.to_string()).or_insert(0) += n;
        if let Some(r) = refinement {
            let e = relics.entry(base.to_string()).or_default();
            let cur = e.get(r).and_then(Value::as_i64).unwrap_or(0);
            e.insert(r.to_string(), json!(cur + n));
        }
    };

    for key in ["MiscItems", "Recipes", "RawUpgrades"] {
        for e in arr(inv, key) {
            if let Some(t) = e.get("ItemType").and_then(Value::as_str) {
                add(t, num(e.get("ItemCount")).unwrap_or(1));
            }
        }
    }
    // Gerankte Mods/Arcanes sind einzelne Einträge; Rivens gehören auf die Riven-Seite.
    let mut riven_list = Vec::new();
    let mut mod_ranks: BTreeMap<String, i64> = BTreeMap::new();
    for e in arr(inv, "Upgrades") {
        let Some(t) = e.get("ItemType").and_then(Value::as_str) else { continue };
        if t.contains("/Randomized/") {
            riven_list.push(parse_riven(e));
        } else {
            add(t, 1);
            let lvl = num(fingerprint(e).get("lvl")).unwrap_or(0);
            let r = mod_ranks.entry(t.to_string()).or_insert(0);
            *r = (*r).max(lvl);
        }
    }
    // Noch nicht geöffnete Rivens liegen als Stückzahl unter RawUpgrades
    let mut riven_raw = Map::new();
    for e in arr(inv, "RawUpgrades") {
        if let Some(t) = e.get("ItemType").and_then(Value::as_str).filter(|t| t.contains("/Randomized/")) {
            riven_raw.insert(riven_type(t), json!(num(e.get("ItemCount")).unwrap_or(1)));
        }
    }

    let mut xp: BTreeMap<String, i64> = BTreeMap::new();
    for e in arr(inv, "XPInfo") {
        if let Some(t) = e.get("ItemType").and_then(Value::as_str) {
            xp.insert(t.to_string(), num(e.get("XP")).unwrap_or(0));
        }
    }
    let mut owned: BTreeMap<String, i64> = BTreeMap::new();
    for key in GEAR_KEYS {
        for e in arr(inv, key) {
            let Some(t) = e.get("ItemType").and_then(Value::as_str) else { continue };
            *owned.entry(t.to_string()).or_insert(0) += 1;
            if let Some(x) = num(e.get("XP")).filter(|&x| x > 0) {
                let cur = xp.entry(t.to_string()).or_insert(0);
                *cur = (*cur).max(x);
            }
        }
    }

    let ducats = counts.get(DUCATS).copied().unwrap_or(0);
    let slots = num(inv.pointer("/RandomModBin/Slots")).unwrap_or(0) + num(inv.pointer("/RandomModBin/Extra")).unwrap_or(0);
    json!({
        "syncedAt": synced_at,
        "source": source,
        "player": {
            "mr": inv.get("PlayerLevel"),
            "platinum": inv.get("PremiumCredits"),
            "credits": inv.get("RegularCredits"),
            "endo": inv.get("FusionPoints"),
            "ducats": ducats,
            "rivens": riven_list.len(),
        },
        "counts": counts,
        "modRanks": mod_ranks,
        "relics": relics,
        "xp": xp,
        "owned": owned,
        "rivens": { "list": riven_list, "raw": riven_raw, "slots": slots },
        "foundry": parse_foundry(inv),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counts_relics_and_mods() {
        let inv = json!({
            "PlayerLevel": 32,
            "MiscItems": [
                { "ItemType": "/Lotus/Types/Game/Projections/T4VoidProjectionEBronze", "ItemCount": 3 },
                { "ItemType": "/Lotus/Types/Game/Projections/T4VoidProjectionEPlatinum", "ItemCount": 1 },
                { "ItemType": DUCATS, "ItemCount": 500 }
            ],
            "Upgrades": [
                { "ItemType": "/Lotus/Upgrades/Mods/Rifle/Serration", "UpgradeFingerprint": "{\"lvl\":10}" },
                { "ItemType": "/Lotus/Upgrades/Mods/Randomized/LotusRifleRandomModRare", "UpgradeFingerprint": "{\"lvl\":8,\"buffs\":[{\"Tag\":\"WeaponCritChanceMod\",\"Value\":536870911}]}" }
            ],
            "Suits": [{ "ItemType": "/Lotus/Powersuits/Ash/Ash", "XP": 900000 }]
        });
        let s = summarize(&inv, 1, "test");
        assert_eq!(s["counts"]["/Lotus/Types/Game/Projections/T4VoidProjectionE"], 4);
        assert_eq!(s["relics"]["/Lotus/Types/Game/Projections/T4VoidProjectionE"]["radiant"], 1);
        assert_eq!(s["modRanks"]["/Lotus/Upgrades/Mods/Rifle/Serration"], 10);
        assert_eq!(s["player"]["ducats"], 500);
        assert_eq!(s["rivens"]["list"][0]["type"], "LotusRifle");
        assert_eq!(s["xp"]["/Lotus/Powersuits/Ash/Ash"], 900000);
    }
}

/// Vergleich mit der Electron-Version: CMRS_INV=<inventory.json> CMRS_OUT=<ziel> cargo test parity -- --ignored
#[cfg(test)]
#[test]
#[ignore]
fn parity_dump() {
    let inv: Value = serde_json::from_str(&std::fs::read_to_string(std::env::var("CMRS_INV").unwrap()).unwrap()).unwrap();
    std::fs::write(std::env::var("CMRS_OUT").unwrap(), summarize(&inv, 1, "game").to_string()).unwrap();
}
