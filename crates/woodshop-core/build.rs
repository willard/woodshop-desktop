//! Bundles every design in `resources/templates/` into the gallery, so a contributed template is
//! a JSON file and a gallery line, with no Rust to edit. The file name is the template's id.

use std::path::Path;
use std::{env, fs};

fn main() {
    let dir = Path::new(&env::var("CARGO_MANIFEST_DIR").unwrap()).join("../../resources/templates");
    // A new or removed file changes the directory, which cargo watches.
    println!("cargo:rerun-if-changed={}", dir.display());
    let mut entries: Vec<(String, String)> = fs::read_dir(&dir)
        .expect("resources/templates exists")
        .map(|e| e.expect("readable template entry").path())
        .filter(|p| p.extension().is_some_and(|x| x == "json"))
        .map(|p| {
            let id = p.file_stem().unwrap().to_string_lossy().into_owned();
            assert!(
                !id.is_empty()
                    && id
                        .bytes()
                        .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-'),
                "template file name {id:?}: use lowercase letters, digits and hyphens"
            );
            let path = fs::canonicalize(&p).unwrap().to_string_lossy().into_owned();
            println!("cargo:rerun-if-changed={path}");
            (id, path)
        })
        .collect();
    entries.sort();
    let mut out = String::from("const TEMPLATES: &[(&str, &str)] = &[\n");
    for (id, path) in entries {
        out.push_str(&format!("    ({id:?}, include_str!({path:?})),\n"));
    }
    out.push_str("];\n");
    fs::write(Path::new(&env::var("OUT_DIR").unwrap()).join("templates.rs"), out).unwrap();
}
