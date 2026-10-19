use codex_plus_core::{assets, settings::BackendSettings};
use std::{fs, process::Command};

#[test]
fn skin_startup_defers_theme_variables_until_the_document_exists() {
    for fast in [false, true] {
        let mut settings = BackendSettings {
            enhancements_enabled: true,
            codex_app_native_fast_unlock: fast,
            codex_app_dream_skin_enabled: true,
            ..Default::default()
        };
        settings.codex_app_dream_skin_theme_config.colors = Some(Default::default());
        let full = assets::injection_script_with_settings(57321, &settings);
        let skin = assets::dream_skin_live_update_script(&settings, false);
        let start = full.rfind("(()=>{const start=()=>{").unwrap();
        let startup = &full[start..];
        assert!(startup.starts_with(&format!("(()=>{{const start=()=>{{{skin}")));

        let bootstrap_end = skin.find("const result =").unwrap();
        let bootstrap = format!("{}return true;\n}})()", &skin[..bootstrap_end]);
        let fixture = tempfile::NamedTempFile::new().unwrap();
        fs::write(fixture.path(), startup.replace(&skin, &bootstrap)).unwrap();
        let output = Command::new("node")
            .arg("-e")
            .arg(
                r#"
const assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm");
const source = fs.readFileSync(process.argv[1], "utf8");
for (const ready of [false, true]) {
  const callbacks = [], writes = [];
  const root = { style: { setProperty: (...args) => writes.push(args) } };
  const document = {
    body: ready ? {} : null, documentElement: ready ? root : null,
    querySelectorAll: () => [],
    addEventListener(type, callback, options) {
      assert.equal(type, "DOMContentLoaded");
      assert.equal(options.once, true);
      callbacks.push(callback);
    },
  };
  vm.runInNewContext(source, {
    window: {}, document,
    MutationObserver: class { observe() {} disconnect() {} },
  });
  assert.equal(callbacks.length, ready ? 0 : 1);
  if (!ready) {
    assert.equal(writes.length, 0);
    document.documentElement = root;
    document.body = {};
    callbacks[0]();
  }
  assert.ok(writes.some(([name]) => name === "--ds-theme-color-background"));
}
"#,
            )
            .arg(fixture.path())
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
}
