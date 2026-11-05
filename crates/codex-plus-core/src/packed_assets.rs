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
        ] {
            assert_eq!(decoded.as_bytes(), original.as_bytes());
        }
    }
}
