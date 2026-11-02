//! Proxy inheritance for the official CUA launcher, independent of browser identity patches.
use std::collections::{BTreeMap, BTreeSet};
use std::fs::{self, File, OpenOptions};
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::time::Duration;

use anyhow::{Context, Result, ensure};
use fs2::FileExt;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::native_browser::{atomic_write, pin_parents, plain_path, read_regular};

const ENTRY: &str = "bin/node_modules/@oai/cua-repl/bin/cua-repl.mjs";
const MODULE: &[u8] = include_bytes!("../../../assets/native-cua-proxy/proxy.mjs");
const MAX_ENTRY: u64 = 64 * 1024;
const KEYS: [&str; 4] = ["HTTPS_PROXY", "HTTP_PROXY", "ALL_PROXY", "NO_PROXY"];

#[derive(Clone)]
struct Paths {
    codex_home: PathBuf,
    runtime_root: PathBuf,
    state: PathBuf,
}

#[derive(Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct Control {
    enabled: bool,
    env: BTreeMap<String, String>,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Journal {
    original: String,
    patched: String,
}

fn key_valid(key: &str) -> bool {
    !key.is_empty()
        && key.len() <= 128
        && key
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

fn proxy_env(
    caller: &BTreeMap<String, String>,
    system: Option<String>,
) -> BTreeMap<String, String> {
    let mut env = BTreeMap::new();
    for key in KEYS {
        if let Some(value) = caller
            .get(key)
            .filter(|v| !v.trim().is_empty())
            .or_else(|| {
                caller
                    .get(&key.to_lowercase())
                    .filter(|v| !v.trim().is_empty())
            })
        {
            env.insert(key.to_owned(), value.clone());
        }
    }
    if !env.keys().any(|key| key != "NO_PROXY")
        && let Some(proxy) = system
    {
        env.insert("HTTPS_PROXY".into(), proxy);
    }
    env
}

fn selected_key(descriptor: &Value, root: &Path) -> Result<Option<String>> {
    let server = &descriptor["mcpServers"]["cua_repl"];
    if server.is_null() || server["enabled"] == false {
        return Ok(None);
    }
    let node = Path::new(
        server["command"]
            .as_str()
            .context("Missing CUA Node command")?,
    );
    let relative = node
        .strip_prefix(root)
        .context("CUA Node is outside the runtime cache")?;
    let key = relative
        .components()
        .next()
        .context("Missing CUA runtime key")?
        .as_os_str()
        .to_str()
        .context("Invalid CUA runtime key")?;
    ensure!(
        key_valid(key) && relative == Path::new(key).join("bin/node.exe"),
        "Unsupported CUA runtime layout"
    );
    let runtime = root.join(key);
    let env = &server["env"];
    ensure!(
        env["NODE_REPL_NODE_PATH"].as_str().map(Path::new) == Some(node),
        "Conflicting CUA Node selection"
    );
    ensure!(
        env["CUA_REPL_NODE_REPL_PATH"].as_str().map(Path::new)
            == Some(runtime.join("bin/node_repl.exe").as_path()),
        "Conflicting CUA worker"
    );
    let surfaces = env["CUA_REPL_ENABLED_SURFACES"]
        .as_str()
        .context("Missing CUA surfaces")?;
    let services: Value = serde_json::from_str(
        env["NODE_REPL_TRUSTED_SERVICES"]
            .as_str()
            .context("Missing CUA services")?,
    )?;
    ensure!(!surfaces.is_empty(), "Empty CUA surface selection");
    for surface in surfaces.split(',') {
        ensure!(
            matches!(surface, "browser" | "computer"),
            "Unsupported CUA surface"
        );
        ensure!(
            services[if surface == "browser" {
                "browser"
            } else {
                "sky"
            }] == if surface == "browser" {
                "@oai/browser-desktop/service"
            } else {
                "@oai/sky/service"
            },
            "Unexpected CUA trusted service"
        );
    }
    let args = server["args"].as_array().context("Missing CUA arguments")?;
    let entry = runtime.join(ENTRY);
    ensure!(
        args.last().and_then(Value::as_str).map(Path::new) == Some(entry.as_path()),
        "Unexpected CUA entry point"
    );
    if args.len() == 3 {
        ensure!(args[0] == "--import", "Unexpected CUA preload");
        let preload = reqwest::Url::parse(args[1].as_str().context("Missing CUA preload")?)?
            .to_file_path()
            .map_err(|_| anyhow::anyhow!("CUA preload must be a local file"))?;
        ensure!(
            preload
                .file_name()
                .is_some_and(|name| name == "require-browser-access.mjs"),
            "Unexpected CUA access preload"
        );
        plain_path(&preload)?;
    } else {
        ensure!(args.len() == 1, "Unsupported CUA arguments");
    }
    plain_path(node)?;
    Ok(Some(key.to_owned()))
}

fn discover(paths: &Paths) -> Result<BTreeSet<String>> {
    let plugins = paths
        .codex_home
        .join("plugins/cache/openai-bundled/unified-computer-use");
    plain_path(&plugins)?;
    let mut keys = BTreeSet::new();
    if !plugins.exists() {
        return Ok(keys);
    }
    let metadata = paths.codex_home.join(
        ".tmp/bundled-marketplaces/openai-bundled/plugins/unified-computer-use/.codex-plugin/plugin.json",
    );
    let active_version = if metadata.exists() {
        let plugin: Value = serde_json::from_slice(&read_regular(&metadata, 64 * 1024)?)?;
        let version = plugin["version"]
            .as_str()
            .context("Missing active CUA plugin version")?;
        ensure!(
            plugin["name"] == "unified-computer-use"
                && !version.is_empty()
                && version
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'-' | b'_'))
                && !matches!(version, "." | ".."),
            "Invalid active CUA plugin metadata"
        );
        Some(version.to_owned())
    } else {
        None
    };
    for (count, entry) in fs::read_dir(plugins)?.enumerate() {
        ensure!(count < 64, "Too many CUA plugin descriptors");
        let entry = entry?;
        if active_version
            .as_ref()
            .is_some_and(|version| entry.file_name() != version.as_str())
        {
            continue;
        }
        let descriptor = entry.path().join(".mcp.json");
        if !descriptor.exists() {
            continue;
        }
        let value = serde_json::from_slice(&read_regular(&descriptor, 1024 * 1024)?)?;
        if let Some(key) = selected_key(&value, &paths.runtime_root)? {
            keys.insert(key);
        }
    }
    ensure!(
        keys.len() <= 1,
        "Ambiguous active CUA runtime; no launcher was modified"
    );
    Ok(keys)
}

fn transform(source: &str, module: &Path) -> Result<String> {
    // Match the small public launcher, never minified symbols or a runtime fingerprint.
    let compact: String = source.chars().filter(|c| !c.is_whitespace()).collect();
    let alias = compact
        .strip_prefix("#!/usr/bin/envnode")
        .unwrap_or(&compact)
        .strip_prefix("import*as")
        .context("Unrecognized CUA launcher")?
        .split_once("from")
        .context("Unrecognized CUA import")?
        .0;
    ensure!(
        !alias.is_empty()
            && alias
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'_'),
        "Unrecognized CUA import alias"
    );
    ensure!(
        compact.contains(&format!(
            "from\"@oai/cua-repl\";try{{await{alias}.launch();}}catch("
        )) || compact.contains(&format!(
            "from'@oai/cua-repl';try{{await{alias}.launch();}}catch("
        )),
        "Unrecognized CUA launch structure"
    );
    let call = format!("await {alias}.launch()");
    ensure!(
        source.matches(&call).count() == 1 && !source.contains("/* codex-plus-cua-proxy */"),
        "Ambiguous or already modified CUA launcher"
    );
    let module = reqwest::Url::from_file_path(module)
        .map_err(|_| anyhow::anyhow!("CUA proxy module must be an absolute path"))?;
    Ok(source.replacen(
        &call,
        &format!(
            "/* codex-plus-cua-proxy */ await import({});\n  {call}",
            serde_json::to_string(module.as_str())?
        ),
        1,
    ))
}

fn write_changed(path: &Path, bytes: &[u8]) -> Result<()> {
    if path.exists() && read_regular(path, 1024 * 1024)? == bytes {
        return Ok(());
    }
    atomic_write(path, bytes)
}

struct Adapter {
    paths: Paths,
    caller: BTreeMap<String, String>,
    _owner: File,
}

impl Adapter {
    fn acquire(paths: Paths, caller: BTreeMap<String, String>) -> Result<Self> {
        plain_path(&paths.state)?;
        ensure!(
            !paths.state.starts_with(&paths.runtime_root),
            "CUA backups must be outside cache"
        );
        fs::create_dir_all(&paths.state)?;
        let lock = paths.state.join("monitor.lock");
        let _guards = pin_parents(&lock)?;
        let mut options = OpenOptions::new();
        options.read(true).write(true).create(true).truncate(false);
        #[cfg(windows)]
        {
            use std::os::windows::fs::OpenOptionsExt;
            options.share_mode(0x1 | 0x2).custom_flags(0x00200000);
            plain_path(&lock)?;
        }
        let owner = options.open(&lock)?;
        ensure!(owner.metadata()?.is_file(), "Invalid CUA monitor lock");
        #[cfg(windows)]
        {
            use std::os::windows::fs::MetadataExt;
            ensure!(
                owner.metadata()?.file_attributes() & 0x400 == 0,
                "CUA lock is a reparse point"
            );
        }
        owner
            .try_lock_exclusive()
            .context("Another CUA proxy monitor is active")?;
        let adapter = Self {
            paths,
            caller,
            _owner: owner,
        };
        adapter.restore()?;
        Ok(adapter)
    }

    fn control(&self, enabled: bool, system: Option<String>) -> Result<()> {
        let env = if enabled {
            proxy_env(&self.caller, system)
        } else {
            BTreeMap::new()
        };
        write_changed(
            &self.paths.state.join("control.json"),
            &serde_json::to_vec(&Control { enabled, env })?,
        )?;
        Ok(())
    }

    fn journal(&self, key: &str) -> PathBuf {
        self.paths.state.join(key).join("journal.json")
    }

    fn restore(&self) -> Result<()> {
        self.control(false, None)?;
        let mut conflict = false;
        for entry in fs::read_dir(&self.paths.state)? {
            let entry = entry?;
            let key = entry.file_name().to_string_lossy().into_owned();
            if !key_valid(&key) || !self.journal(&key).exists() {
                continue;
            }
            let journal: Journal =
                serde_json::from_slice(&read_regular(&self.journal(&key), MAX_ENTRY * 3)?)?;
            let target = self.paths.runtime_root.join(&key).join(ENTRY);
            if !target.exists() {
                continue;
            }
            let current = read_regular(&target, MAX_ENTRY)?;
            if current == journal.patched.as_bytes() {
                atomic_write(&target, journal.original.as_bytes())?;
            } else if current != journal.original.as_bytes() {
                conflict = true;
            }
        }
        ensure!(
            !conflict,
            "CUA launcher changed externally; backup and current file retained"
        );
        Ok(())
    }

    fn refresh(&self, system: Option<String>) -> Result<()> {
        // Tool-provided proxies are only visible inside the official launcher.
        // With no proxy from any source, the initializer leaves its environment untouched.
        self.control(true, system)?;
        write_changed(&self.paths.state.join("proxy.mjs"), MODULE)?;
        for key in discover(&self.paths)? {
            let target = self.paths.runtime_root.join(&key).join(ENTRY);
            let _guards = pin_parents(&target)?;
            let current = String::from_utf8(read_regular(&target, MAX_ENTRY)?)?;
            let receipt = self.journal(&key);
            if receipt.exists() {
                let journal: Journal =
                    serde_json::from_slice(&read_regular(&receipt, MAX_ENTRY * 3)?)?;
                if current == journal.patched {
                    continue;
                }
                ensure!(
                    current == journal.original,
                    "CUA launcher changed externally; refusing overwrite"
                );
            }
            let patched = transform(&current, &self.paths.state.join("proxy.mjs"))?;
            plain_path(&receipt)?;
            fs::create_dir_all(receipt.parent().context("Missing CUA backup directory")?)?;
            atomic_write(
                &receipt,
                &serde_json::to_vec(&Journal {
                    original: current,
                    patched: patched.clone(),
                })?,
            )?;
            atomic_write(&target, patched.as_bytes())?;
        }
        Ok(())
    }
}

impl Drop for Adapter {
    fn drop(&mut self) {
        if let Err(error) = self.restore() {
            log_error("native_cua_proxy.restore_failed", &error);
        }
    }
}

fn log_error(event: &str, error: &anyhow::Error) {
    // Never include control contents, process environments or proxy addresses in diagnostics.
    let _ =
        crate::diagnostic_log::append_diagnostic_log(event, json!({"detail": error.to_string()}));
}

pub struct ProxyMonitor {
    shutdown: mpsc::Sender<()>,
    task: tokio::task::JoinHandle<()>,
}

impl ProxyMonitor {
    pub async fn stop(self) {
        let _ = self.shutdown.send(());
        if let Err(error) = self.task.await {
            log_error("native_cua_proxy.shutdown_failed", &error.into());
        }
    }
}

pub async fn start_monitor(
    enabled: bool,
    codex_home: PathBuf,
    state: PathBuf,
) -> Option<ProxyMonitor> {
    if !cfg!(windows) || (!enabled && !state.exists()) {
        return None;
    }
    let paths = Paths {
        codex_home,
        runtime_root: PathBuf::from(std::env::var_os("LOCALAPPDATA")?)
            .join("OpenAI/Codex/runtimes/cua_node"),
        state,
    };
    let caller = std::env::vars()
        .filter(|(key, _)| KEYS.iter().any(|k| key.eq_ignore_ascii_case(k)))
        .collect();
    let adapter = match tokio::task::spawn_blocking(move || Adapter::acquire(paths, caller)).await {
        Ok(Ok(adapter)) => adapter,
        Ok(Err(error)) => {
            log_error("native_cua_proxy.prepare_failed", &error);
            return None;
        }
        Err(error) => {
            log_error("native_cua_proxy.prepare_failed", &error.into());
            return None;
        }
    };
    if !enabled {
        drop(adapter);
        return None;
    }
    // Complete the first transaction before desktop activation can start a tool.
    let adapter = tokio::task::spawn_blocking(move || {
        if let Err(error) = adapter.refresh(crate::proxy::detect_system_proxy()) {
            log_error("native_cua_proxy.prepare_failed", &error);
        } else {
            let _ = crate::diagnostic_log::append_diagnostic_log(
                "native_cua_proxy.ready",
                json!({"detail": "Official CUA launcher prepared"}),
            );
        }
        adapter
    })
    .await
    .ok()?;
    let (shutdown, receiver) = mpsc::channel();
    let task = tokio::task::spawn_blocking(move || {
        let mut previous = None;
        while let Err(mpsc::RecvTimeoutError::Timeout) =
            receiver.recv_timeout(Duration::from_secs(2))
        {
            let enabled = crate::settings::SettingsStore::default()
                .load()
                .map(|settings| settings.enhancements_enabled)
                .unwrap_or(enabled);
            let outcome = if enabled {
                adapter.refresh(crate::proxy::detect_system_proxy())
            } else {
                adapter.restore()
            };
            let error = outcome.err().map(|e| e.to_string());
            if error != previous {
                if let Some(error) = &error {
                    log_error(
                        "native_cua_proxy.refresh_failed",
                        &anyhow::anyhow!("{error}"),
                    );
                } else {
                    let _ = crate::diagnostic_log::append_diagnostic_log(
                        "native_cua_proxy.ready",
                        json!({"detail": "CUA proxy configuration refreshed"}),
                    );
                }
                previous = error;
            }
        }
        drop(adapter);
    });
    Some(ProxyMonitor { shutdown, task })
}

#[cfg(test)]
mod tests {
    use super::*;

    const SOURCE: &str = "#!/usr/bin/env node\nimport * as cua_repl from \"@oai/cua-repl\";\n\ntry {\n  await cua_repl.launch();\n} catch (error) {\n  const error_message = error instanceof Error ? error.message : String(error);\n  console.error(`cua_repl could not start: ${error_message}`);\n  process.exitCode = 1;\n}\n";

    fn paths(temp: &tempfile::TempDir) -> Paths {
        let canonical = temp.path().canonicalize().unwrap();
        let text = canonical.to_string_lossy();
        let root = PathBuf::from(text.strip_prefix(r"\\?\").unwrap_or(&text));
        Paths {
            codex_home: root.join("home"),
            runtime_root: root.join("cache"),
            state: root.join("state"),
        }
    }

    fn fixture(paths: &Paths, key: &str) -> (PathBuf, Value) {
        let runtime = paths.runtime_root.join(key);
        let entry = runtime.join(ENTRY);
        fs::create_dir_all(entry.parent().unwrap()).unwrap();
        fs::write(&entry, SOURCE).unwrap();
        let preload = paths.codex_home.join(
            "plugins/cache/openai-bundled/unified-computer-use/v1/require-browser-access.mjs",
        );
        fs::create_dir_all(preload.parent().unwrap()).unwrap();
        fs::write(&preload, "process.env.ACCESS_PRELOAD = 'preserved';").unwrap();
        let descriptor = json!({"mcpServers": {"cua_repl": {
            "command": runtime.join("bin/node.exe"),
            "args": ["--import", reqwest::Url::from_file_path(&preload).unwrap().as_str(), entry],
            "env": {
                "NODE_REPL_NODE_PATH": runtime.join("bin/node.exe"),
                "CUA_REPL_NODE_REPL_PATH": runtime.join("bin/node_repl.exe"),
                "CUA_REPL_ENABLED_SURFACES": "browser,computer",
                "NODE_REPL_TRUSTED_SERVICES": "{\"browser\":\"@oai/browser-desktop/service\",\"sky\":\"@oai/sky/service\"}"
            }
        }}});
        fs::write(
            preload.parent().unwrap().join(".mcp.json"),
            serde_json::to_vec(&descriptor).unwrap(),
        )
        .unwrap();
        (entry, descriptor)
    }

    #[test]
    fn caller_proxy_precedes_system_and_accepts_lowercase() {
        let caller = BTreeMap::from([
            ("HTTPS_PROXY".into(), "".into()),
            ("https_proxy".into(), "http://caller:1".into()),
            ("no_proxy".into(), "internal.example".into()),
        ]);
        let env = proxy_env(&caller, Some("http://system:2".into()));
        assert_eq!(env["HTTPS_PROXY"], "http://caller:1");
        assert_eq!(env["NO_PROXY"], "internal.example");
        assert!(!env.contains_key("NODE_USE_ENV_PROXY"));
        assert_eq!(
            proxy_env(&BTreeMap::new(), Some("http://system:2".into()))["HTTPS_PROXY"],
            "http://system:2"
        );
        assert!(proxy_env(&BTreeMap::new(), None).is_empty());
    }

    #[test]
    fn descriptor_keeps_access_preload_and_supports_both_surfaces() {
        let temp = tempfile::tempdir().unwrap();
        let paths = paths(&temp);
        let (_, mut descriptor) = fixture(&paths, "runtime1");
        let before = descriptor.clone();
        assert_eq!(
            selected_key(&descriptor, &paths.runtime_root).unwrap(),
            Some("runtime1".into())
        );
        assert_eq!(before, descriptor);
        descriptor["mcpServers"]["cua_repl"]["env"]["CUA_REPL_ENABLED_SURFACES"] =
            json!("computer");
        assert!(selected_key(&descriptor, &paths.runtime_root).is_ok());
        descriptor["mcpServers"]["cua_repl"]["env"]["CUA_REPL_ENABLED_SURFACES"] =
            json!("terminal");
        assert!(selected_key(&descriptor, &paths.runtime_root).is_err());
        descriptor["mcpServers"]["cua_repl"]["command"] =
            json!(paths.runtime_root.join("../outside/bin/node.exe"));
        assert!(selected_key(&descriptor, &paths.runtime_root).is_err());
    }

    #[test]
    fn discovery_prefers_active_plugin_and_refuses_ambiguous_selection() {
        let temp = tempfile::tempdir().unwrap();
        let paths = paths(&temp);
        fixture(&paths, "runtime1");
        let old_plugin = paths
            .codex_home
            .join("plugins/cache/openai-bundled/unified-computer-use");
        fs::rename(old_plugin.join("v1"), old_plugin.join("old")).unwrap();
        fixture(&paths, "runtime2");
        assert!(discover(&paths).is_err());
        let metadata = paths.codex_home.join(".tmp/bundled-marketplaces/openai-bundled/plugins/unified-computer-use/.codex-plugin/plugin.json");
        fs::create_dir_all(metadata.parent().unwrap()).unwrap();
        fs::write(
            &metadata,
            r#"{"name":"unified-computer-use","version":"v1"}"#,
        )
        .unwrap();
        assert_eq!(
            discover(&paths).unwrap(),
            BTreeSet::from(["runtime2".into()])
        );
        fs::write(
            metadata,
            r#"{"name":"unified-computer-use","version":".."}"#,
        )
        .unwrap();
        assert!(discover(&paths).is_err());
    }

    #[test]
    fn install_is_idempotent_updates_proxy_and_restores_original() {
        let temp = tempfile::tempdir().unwrap();
        let paths = paths(&temp);
        let (entry, _) = fixture(&paths, "runtime1");
        let adapter = Adapter::acquire(paths.clone(), BTreeMap::new()).unwrap();
        assert!(Adapter::acquire(paths.clone(), BTreeMap::new()).is_err());
        assert_eq!(fs::read_to_string(&entry).unwrap(), SOURCE);
        adapter.refresh(None).unwrap();
        assert!(
            fs::read_to_string(&entry)
                .unwrap()
                .contains("codex-plus-cua-proxy")
        );
        adapter
            .refresh(Some("http://127.0.0.1:1234".into()))
            .unwrap();
        let patched = fs::read_to_string(&entry).unwrap();
        assert_eq!(patched.matches("codex-plus-cua-proxy").count(), 1);
        adapter
            .refresh(Some("http://127.0.0.1:2345".into()))
            .unwrap();
        assert_eq!(fs::read_to_string(&entry).unwrap(), patched);
        let config: Control =
            serde_json::from_slice(&fs::read(paths.state.join("control.json")).unwrap()).unwrap();
        assert_eq!(config.env["HTTPS_PROXY"], "http://127.0.0.1:2345");
        drop(adapter);
        assert_eq!(fs::read_to_string(&entry).unwrap(), SOURCE);
        assert!(
            !serde_json::from_slice::<Control>(
                &fs::read(paths.state.join("control.json")).unwrap()
            )
            .unwrap()
            .enabled
        );
    }

    #[test]
    fn recovers_abnormal_exit_and_tracks_a_new_runtime() {
        let temp = tempfile::tempdir().unwrap();
        let paths = paths(&temp);
        let (old, _) = fixture(&paths, "runtime1");
        let adapter = Adapter::acquire(paths.clone(), BTreeMap::new()).unwrap();
        adapter
            .refresh(Some("http://127.0.0.1:1234".into()))
            .unwrap();
        let candidate = fs::read(&old).unwrap();
        drop(adapter);
        // A terminated process leaves this exact candidate and its durable journal.
        fs::write(&old, candidate).unwrap();
        let adapter = Adapter::acquire(paths.clone(), BTreeMap::new()).unwrap();
        assert_eq!(fs::read_to_string(&old).unwrap(), SOURCE);
        adapter
            .refresh(Some("http://127.0.0.1:1234".into()))
            .unwrap();
        let (new, _) = fixture(&paths, "runtime2");
        adapter
            .refresh(Some("http://127.0.0.1:1234".into()))
            .unwrap();
        assert!(
            fs::read_to_string(&new)
                .unwrap()
                .contains("codex-plus-cua-proxy")
        );
        drop(adapter);
        assert_eq!(fs::read_to_string(old).unwrap(), SOURCE);
        assert_eq!(fs::read_to_string(new).unwrap(), SOURCE);
    }

    #[test]
    fn preserves_external_edits_and_refuses_unknown_launcher() {
        let temp = tempfile::tempdir().unwrap();
        let paths = paths(&temp);
        let (entry, _) = fixture(&paths, "runtime1");
        let adapter = Adapter::acquire(paths.clone(), BTreeMap::new()).unwrap();
        adapter
            .refresh(Some("http://127.0.0.1:1234".into()))
            .unwrap();
        fs::write(&entry, "external change").unwrap();
        assert!(
            adapter
                .refresh(Some("http://127.0.0.1:1234".into()))
                .is_err()
        );
        assert!(adapter.restore().is_err());
        assert_eq!(fs::read_to_string(&entry).unwrap(), "external change");
        assert!(paths.state.join("runtime1/journal.json").is_file());
        fs::write(&entry, SOURCE).unwrap();
        drop(adapter);
        assert!(transform("await other.launch();", &paths.state.join("proxy.mjs")).is_err());
        let patched = transform(SOURCE, &paths.state.join("proxy.mjs")).unwrap();
        assert!(transform(&patched, &paths.state.join("proxy.mjs")).is_err());
    }

    #[test]
    fn initializer_respects_tool_proxy_case_bypass_and_no_proxy_mode() {
        let temp = tempfile::tempdir().unwrap();
        fs::write(temp.path().join("proxy.mjs"), MODULE).unwrap();
        fs::write(
            temp.path().join("control.json"),
            r#"{"enabled":false,"env":{}}"#,
        )
        .unwrap();
        let module = reqwest::Url::from_file_path(temp.path().join("proxy.mjs")).unwrap();
        let code = format!(
            r#"
            import assert from 'node:assert/strict';
            const {{applyProxy, initialize}} = await import({});
            const inherited = {{HTTPS_PROXY:'http://caller:1', NO_PROXY:'caller.local'}};
            const tool = {{https_proxy:'http://tool:2', no_proxy:'existing.local'}};
            assert.equal(applyProxy(tool, inherited), 'http://tool:2');
            assert.equal(tool.https_proxy, 'http://tool:2');
            assert.equal(tool.HTTPS_PROXY, undefined);
            assert.equal(tool.NO_PROXY, 'existing.local,caller.local,localhost,127.0.0.1,::1');
            assert.equal(tool.no_proxy, tool.NO_PROXY);
            const empty = {{}};
            assert.equal(applyProxy(empty, {{}}), null);
            assert.deepEqual(empty, {{}});
            const http = {{HTTP_PROXY:'http://tool:3'}};
            applyProxy(http, inherited);
            assert.equal(http.HTTPS_PROXY, 'http://tool:3');
            assert.equal(http.NODE_USE_ENV_PROXY, undefined);
            const absent = {{}};
            applyProxy(absent, inherited);
            assert.equal(absent.HTTPS_PROXY, 'http://caller:1');
            const unavailable = {{HTTPS_PROXY:'http://dummy:secret@127.0.0.1:9'}};
            await initialize(unavailable, {{enabled:true, env:{{}}}});
            assert.equal(unavailable.HTTPS_PROXY, 'http://dummy:secret@127.0.0.1:9');
        "#,
            serde_json::to_string(module.as_str()).unwrap()
        );
        let output = std::process::Command::new("node")
            .args(["--input-type=module", "--eval", &code])
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        let warning = String::from_utf8_lossy(&output.stderr);
        assert!(warning.contains("configured proxy retained"));
        assert!(!warning.contains("secret") && !warning.contains("dummy"));
    }

    #[test]
    fn real_node_launcher_preserves_preload_child_environment_and_exit_codes() {
        let temp = tempfile::tempdir().unwrap();
        let paths = paths(&temp);
        let (entry, descriptor) = fixture(&paths, "runtime1");
        let package = entry.parent().unwrap().parent().unwrap();
        fs::write(
            package.join("package.json"),
            r#"{"type":"module","exports":"./index.mjs"}"#,
        )
        .unwrap();
        fs::write(package.join("index.mjs"), r#"
            import {spawnSync} from 'node:child_process';
            export async function launch() {
                if (process.env.FAIL_LAUNCH) throw new Error('expected launch failure');
                const result = spawnSync(process.execPath, ['-e', 'console.log(JSON.stringify({preload:process.env.ACCESS_PRELOAD,proxy:process.env.HTTPS_PROXY,bypass:process.env.NO_PROXY}));process.exit(23)'], {stdio:'inherit',env:{...process.env}});
                process.exitCode = result.status;
            }
        "#).unwrap();
        let listener = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let proxy = format!("http://{}", listener.local_addr().unwrap());
        let adapter = Adapter::acquire(paths.clone(), BTreeMap::new()).unwrap();
        adapter.refresh(Some(proxy.clone())).unwrap();
        let args: Vec<_> = descriptor["mcpServers"]["cua_repl"]["args"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_str().unwrap())
            .collect();
        let mut command = std::process::Command::new("node");
        command.args(&args);
        for key in KEYS {
            command.env_remove(key).env_remove(key.to_lowercase());
        }
        let output = command.output().unwrap();
        assert_eq!(
            output.status.code(),
            Some(23),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        let value: Value = serde_json::from_slice(&output.stdout).unwrap();
        assert_eq!(value["proxy"], proxy);
        assert_eq!(value["preload"], "preserved");
        assert_eq!(value["bypass"], "localhost,127.0.0.1,::1");
        let failure = command.env("FAIL_LAUNCH", "1").output().unwrap();
        assert_eq!(failure.status.code(), Some(1));
        assert!(
            String::from_utf8_lossy(&failure.stderr)
                .contains("cua_repl could not start: expected launch failure")
        );
        assert_eq!(
            descriptor["mcpServers"]["cua_repl"]["args"]
                .as_array()
                .unwrap()
                .len(),
            3
        );
        drop(adapter);
        assert_eq!(fs::read_to_string(entry).unwrap(), SOURCE);
    }

    /// Explicit opt-in probe for a live desktop session; never part of the isolated suite.
    #[cfg(windows)]
    #[tokio::test]
    #[ignore = "temporarily patches the installed official CUA runtime; press Enter to restore"]
    async fn manual_official_runtime_proxy_monitor() {
        use std::io::Write;
        let state = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../target/temp/cua-proxy-live")
            .canonicalize()
            .expect("create target/temp/cua-proxy-live before this explicit probe");
        let monitor = start_monitor(
            true,
            crate::codex_home::default_codex_home_dir(),
            state.clone(),
        )
        .await
        .expect("live CUA monitor must acquire ownership");
        let control: Control =
            serde_json::from_slice(&fs::read(state.join("control.json")).unwrap()).unwrap();
        assert!(control.enabled, "live proxy must be configured");
        println!("CUA_PROXY_LIVE_READY; press Enter to restore");
        std::io::stdout().flush().unwrap();
        tokio::task::spawn_blocking(|| {
            let mut line = String::new();
            std::io::stdin().read_line(&mut line).unwrap();
        })
        .await
        .unwrap();
        monitor.stop().await;
        let control: Control =
            serde_json::from_slice(&fs::read(state.join("control.json")).unwrap()).unwrap();
        assert!(!control.enabled);
        println!("CUA_PROXY_LIVE_RESTORED");
    }
}
