use std::{env, fs, path::PathBuf};

fn main() {
    let assets = PathBuf::from(env::var_os("CARGO_MANIFEST_DIR").unwrap()).join("../../assets");
    let output = PathBuf::from(env::var_os("OUT_DIR").unwrap());
    let (dream_renderer, dream_css, cidala_renderer, cidala_css) =
        if env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
            (
                "inject/upstream/dream-skin/windows/renderer-inject.js",
                "inject/upstream/dream-skin/windows/dream-skin.css",
                "inject/upstream/cidala-tiger/windows/renderer-inject.js",
                "inject/upstream/cidala-tiger/windows/dream-skin.css",
            )
        } else {
            (
                "inject/upstream/dream-skin/macos/renderer-inject.js",
                "inject/upstream/dream-skin/macos/dream-skin.css",
                "inject/upstream/cidala-tiger/macos/renderer-inject.js",
                "inject/upstream/cidala-tiger/macos/dream-skin.css",
            )
        };
    for (name, relative) in [
        ("renderer", "inject/renderer-inject.js"),
        ("whale", "inject/upstream/whale-widget/full-widget-codex.js"),
        ("inspector", "native-browser/inspect-service.cjs"),
        ("catalog", "claude-localization/catalogs/zh-Hans.json"),
        ("dream_renderer", dream_renderer),
        ("dream_css", dream_css),
        ("cidala_renderer", cidala_renderer),
        ("cidala_css", cidala_css),
        (
            "snow_renderer",
            "inject/upstream/snow-skin/renderer-inject.js",
        ),
        ("snow_css", "inject/upstream/snow-skin/dream-skin.css"),
        (
            "glass_renderer",
            "inject/upstream/glass-vision/renderer-inject.js",
        ),
        ("glass_css", "inject/upstream/glass-vision/glass-vision.css"),
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
