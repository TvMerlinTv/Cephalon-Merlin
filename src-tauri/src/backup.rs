//! Sicherung der eigenen Daten in EINE Datei (zum Umziehen auf einen anderen PC):
//! Einstellungen, To-Do-Liste, Builds, Preis-Alarme, Welt-Haken, Checkliste, Statistik-Verlauf und die
//! Ansichts-Einstellungen der Oberfläche. Bewusst NICHT enthalten: Inventar (kommt aus dem Sync),
//! Caches, der Discord-Webhook und alles, was ein Geheimnis sein könnte.
use crate::settings::Settings;
use serde_json::{json, Map, Value};
use std::path::Path;

const MARKER: &str = "cephalon-merlin-backup";
const FORMAT: u64 = 1;
const STORE_KEYS: [&str; 5] = ["todo", "builds", "alerts", "worldchecks", "checklist"];
const STATS_FILE: &str = "stats.json";
pub const MAX_BYTES: u64 = 10 * 1024 * 1024;

fn read_json(path: &Path) -> Option<Value> {
    serde_json::from_str(&std::fs::read_to_string(path).ok()?).ok()
}

/// Sicherung zusammenstellen. `local` = Ansichts-Einstellungen der Oberfläche (localStorage, nur "cm.*").
pub fn build(data: &Path, settings: Value, local: Value, version: &str) -> Value {
    let mut store = Map::new();
    for key in STORE_KEYS {
        if let Some(v) = read_json(&data.join(format!("{key}.json"))) {
            store.insert(key.to_string(), v);
        }
    }
    json!({
        "app": MARKER,
        "format": FORMAT,
        "version": version,
        "createdAt": crate::logger::now_iso(),
        "settings": settings,
        "store": store,
        "stats": read_json(&data.join(STATS_FILE)),
        "local": clean_local(&local),
    })
}

/// Nur eigene Schlüssel ("cm.…") mit Text-Werten übernehmen.
fn clean_local(local: &Value) -> Value {
    let map: Map<String, Value> = local
        .as_object()
        .into_iter()
        .flatten()
        .filter(|(k, v)| k.starts_with("cm.") && k.len() <= 80 && v.as_str().is_some_and(|s| s.len() <= 20_000))
        .map(|(k, v)| (k.clone(), v.clone()))
        .collect();
    Value::Object(map)
}

/// Datei-Inhalt prüfen: muss eine Sicherung von Cephalon Merlin in einem bekannten Format sein.
pub fn parse(text: &str) -> Result<Value, String> {
    let v: Value = serde_json::from_str(text).map_err(|_| "Das ist keine gültige Sicherungs-Datei")?;
    if v["app"] != MARKER {
        return Err("Das ist keine Sicherung von Cephalon Merlin".into());
    }
    if v["format"].as_u64().is_none_or(|f| f > FORMAT) {
        return Err("Die Sicherung stammt aus einer neueren Version – bitte erst aktualisieren".into());
    }
    Ok(v)
}

/// Sicherung einspielen. Vorhandene Dateien landen vorher in backup\<zeit>\.
/// Gibt zurück, was übernommen wurde, die neuen Einstellungen und die Ansichts-Einstellungen.
pub fn restore(data: &Path, settings: &Settings, backup: &Value) -> Result<Value, String> {
    let stamp = crate::logger::now_iso().replace([':', '.'], "-");
    let keep = data.join("backup").join(format!("vor-import-{stamp}"));
    let save_old = |name: &str| -> Result<(), String> {
        let old = data.join(name);
        if old.is_file() {
            std::fs::create_dir_all(&keep).map_err(|e| e.to_string())?;
            std::fs::copy(&old, keep.join(name)).map_err(|e| format!("Sicherung von {name}: {e}"))?;
        }
        Ok(())
    };
    let mut restored = Vec::new();

    save_old("settings.json")?;
    let values = match backup["settings"].as_object() {
        Some(s) if !s.is_empty() => {
            restored.push("settings");
            settings.update(Value::Object(s.clone()))?
        }
        _ => settings.get(),
    };
    for key in STORE_KEYS {
        let v = &backup["store"][key];
        if v.is_null() {
            continue;
        }
        save_old(&format!("{key}.json"))?;
        crate::store::set(data, key, v)?;
        restored.push(key);
    }
    if backup["stats"].is_array() || backup["stats"].is_object() {
        save_old(STATS_FILE)?;
        let text = serde_json::to_string(&backup["stats"]).map_err(|e| e.to_string())?;
        crate::paths::write_atomic(&data.join(STATS_FILE), &text).map_err(|e| format!("{STATS_FILE}: {e}"))?;
        restored.push("stats");
    }
    Ok(json!({ "restored": restored, "settings": values, "local": clean_local(&backup["local"]), "createdAt": backup["createdAt"], "version": backup["version"] }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("cm-backup-test-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn roundtrip_restores_and_keeps_old_files() {
        let a = temp("a");
        std::fs::write(a.join("todo.json"), r#"["x","y"]"#).unwrap();
        std::fs::write(a.join("stats.json"), r#"[{"at":1}]"#).unwrap();
        let local = json!({ "cm.page": "\"home\"", "fremd": "nein", "cm.zahl": 5 });
        let b = build(&a, json!({ "language": "en", "theme": "arcane" }), local, "0.2.3");
        assert_eq!(b["store"]["todo"], json!(["x", "y"]));
        assert_eq!(b["local"], json!({ "cm.page": "\"home\"" }));
        assert!(b["store"].get("alerts").is_none());

        let text = serde_json::to_string(&b).unwrap();
        let parsed = parse(&text).unwrap();
        let dst = temp("b");
        std::fs::write(dst.join("todo.json"), r#"["alt"]"#).unwrap();
        let settings = Settings::load(&dst);
        let r = restore(&dst, &settings, &parsed).unwrap();
        assert_eq!(r["settings"]["language"], "en");
        assert_eq!(r["settings"]["theme"], "arcane");
        assert_eq!(std::fs::read_to_string(dst.join("todo.json")).unwrap(), r#"["x","y"]"#);
        assert!(dst.join("stats.json").is_file());
        // die bisherige To-Do-Liste liegt in backup\vor-import-…\
        let kept: Vec<_> = std::fs::read_dir(dst.join("backup")).unwrap().flatten().collect();
        assert_eq!(kept.len(), 1);
        assert_eq!(std::fs::read_to_string(kept[0].path().join("todo.json")).unwrap(), r#"["alt"]"#);
        let _ = std::fs::remove_dir_all(&a);
        let _ = std::fs::remove_dir_all(&dst);
    }

    #[test]
    fn rejects_foreign_and_newer_files() {
        assert!(parse("kein json").is_err());
        assert!(parse(r#"{"app":"etwas anderes","format":1}"#).is_err());
        assert!(parse(r#"{"app":"cephalon-merlin-backup","format":99}"#).is_err());
        assert!(parse(r#"{"app":"cephalon-merlin-backup","format":1}"#).is_ok());
    }
}
