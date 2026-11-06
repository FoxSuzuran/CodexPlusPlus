macro_rules! text_asset {
    ($function:ident, $name:literal) => {
        pub(crate) fn $function() -> &'static str {
            static TEXT: std::sync::LazyLock<String> = std::sync::LazyLock::new(|| {
                let bytes = zstd::stream::decode_all(
                    &include_bytes!(concat!(env!("OUT_DIR"), "/", $name, ".zst"))[..],
                )
                .expect("decode embedded asset");
                String::from_utf8(bytes).expect("embedded asset is UTF-8")
            });
            &TEXT
        }
    };
}

text_asset!(renderer, "renderer");
text_asset!(whale, "whale");
text_asset!(inspector, "inspector");
text_asset!(catalog, "catalog");
text_asset!(dream_renderer, "dream_renderer");
text_asset!(dream_css, "dream_css");
text_asset!(cidala_renderer, "cidala_renderer");
text_asset!(cidala_css, "cidala_css");
text_asset!(snow_renderer, "snow_renderer");
text_asset!(snow_css, "snow_css");
text_asset!(glass_renderer, "glass_renderer");
text_asset!(glass_css, "glass_css");

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compressed_resources_preserve_every_byte() {
        for (decoded, original) in [
            (
                renderer(),
                include_str!("../../../assets/inject/renderer-inject.js"),
            ),
            (
                whale(),
                include_str!("../../../assets/inject/upstream/whale-widget/full-widget-codex.js"),
            ),
            (
                inspector(),
                include_str!("../../../assets/native-browser/inspect-service.cjs"),
            ),
            (
                catalog(),
                include_str!("../../../assets/claude-localization/catalogs/zh-Hans.json"),
            ),
            #[cfg(windows)]
            (
                dream_renderer(),
                include_str!(
                    "../../../assets/inject/upstream/dream-skin/windows/renderer-inject.js"
                ),
            ),
            #[cfg(not(windows))]
            (
                dream_renderer(),
                include_str!("../../../assets/inject/upstream/dream-skin/macos/renderer-inject.js"),
            ),
            #[cfg(windows)]
            (
                dream_css(),
                include_str!("../../../assets/inject/upstream/dream-skin/windows/dream-skin.css"),
            ),
            #[cfg(not(windows))]
            (
                dream_css(),
                include_str!("../../../assets/inject/upstream/dream-skin/macos/dream-skin.css"),
            ),
            #[cfg(windows)]
            (
                cidala_renderer(),
                include_str!(
                    "../../../assets/inject/upstream/cidala-tiger/windows/renderer-inject.js"
                ),
            ),
            #[cfg(not(windows))]
            (
                cidala_renderer(),
                include_str!(
                    "../../../assets/inject/upstream/cidala-tiger/macos/renderer-inject.js"
                ),
            ),
            #[cfg(windows)]
            (
                cidala_css(),
                include_str!("../../../assets/inject/upstream/cidala-tiger/windows/dream-skin.css"),
            ),
            #[cfg(not(windows))]
            (
                cidala_css(),
                include_str!("../../../assets/inject/upstream/cidala-tiger/macos/dream-skin.css"),
            ),
            (
                snow_renderer(),
                include_str!("../../../assets/inject/upstream/snow-skin/renderer-inject.js"),
            ),
            (
                snow_css(),
                include_str!("../../../assets/inject/upstream/snow-skin/dream-skin.css"),
            ),
            (
                glass_renderer(),
                include_str!("../../../assets/inject/upstream/glass-vision/renderer-inject.js"),
            ),
            (
                glass_css(),
                include_str!("../../../assets/inject/upstream/glass-vision/glass-vision.css"),
            ),
        ] {
            assert_eq!(decoded.as_bytes(), original.as_bytes());
        }
    }
}
