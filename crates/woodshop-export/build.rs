//! Embed the standalone viewer bundle (built by `npm run build:viewer` into `viewer/dist`). When it
//! has not been built — a plain `cargo test`, say — a stub stands in, so Rust builds never depend
//! on a JavaScript toolchain; release builds run the viewer build first.

use std::path::Path;

fn main() {
    let out = std::env::var("OUT_DIR").expect("cargo sets OUT_DIR");
    let dist = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../viewer/dist");
    for (name, stub) in [
        (
            "viewer.js",
            "document.getElementById('viewer').textContent='This build of Woodshop was made without the 3D viewer.';",
        ),
        ("viewer.css", ""),
    ] {
        let src = dist.join(name);
        println!("cargo:rerun-if-changed={}", src.display());
        let contents = std::fs::read_to_string(&src).unwrap_or_else(|_| {
            if std::env::var("PROFILE").as_deref() == Ok("release") {
                println!("cargo:warning=viewer/dist/{name} is missing: this release build exports a viewer stub. Run `npm run build:viewer` first.");
            }
            stub.to_owned()
        });
        std::fs::write(Path::new(&out).join(name), contents).expect("OUT_DIR is writable");
    }
}
