use std::{env, fs, path::PathBuf};

fn main() {
    let assets = PathBuf::from(env::var_os("CARGO_MANIFEST_DIR").unwrap()).join("../../assets");
    let output = PathBuf::from(env::var_os("OUT_DIR").unwrap());
    for (name, relative) in [
        ("renderer", "inject/renderer-inject.js"),
        ("whale", "inject/upstream/whale-widget/full-widget-codex.js"),
        ("inspector", "native-browser/inspect-service.cjs"),
        ("catalog", "claude-localization/catalogs/zh-Hans.json"),
    ] {
        let source = assets.join(relative);
        println!("cargo:rerun-if-changed={}", source.display());
        let bytes = fs::read(&source).expect("read embedded asset");
        std::str::from_utf8(&bytes).expect("embedded text must be UTF-8");
        let packed = zstd::bulk::compress(&bytes, 9).expect("compress embedded asset");
        let destination = output.join(format!("{name}.zst"));
        if fs::read(&destination).ok().as_deref() != Some(&packed) {
            fs::write(destination, packed).expect("write compressed asset");
        }
    }
}
