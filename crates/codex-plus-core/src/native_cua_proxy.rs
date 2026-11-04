//! Proxy inheritance for the official CUA launcher, independent of browser identity patches.
use std::collections::BTreeMap;
use std::fs::{self, File, OpenOptions};
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::time::Duration;

use anyhow::{Context, Result, ensure};
use fs2::FileExt;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

use crate::native_browser::{atomic_write, pin_parents, plain_path, read_regular};

const ENTRY: &str = "bin/node_modules/@oai/cua-repl/bin/cua-repl.mjs";
const MODULE: &[u8] = include_bytes!("../../../assets/native-cua-proxy/proxy.mjs");
const MAX_ENTRY: u64 = 64 * 1024;
const MAX_DESCRIPTOR: u64 = 1024 * 1024;
const KEYS: [&str; 4] = ["HTTPS_PROXY", "HTTP_PROXY", "ALL_PROXY", "NO_PROXY"];

#[derive(Clone)]
struct Paths {
    codex_home: PathBuf,
    // Only needed to restore launcher patches written by older versions.
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

#[derive(Serialize, Deserialize)]
struct DescriptorJournal {
    path: PathBuf,
    original: Option<String>,
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

fn discover(paths: &Paths) -> Result<Vec<PathBuf>> {
    let plugins = paths
        .codex_home
        .join("plugins/cache/openai-bundled/unified-computer-use");
    plain_path(&plugins)?;
    let mut descriptors = Vec::new();
    if !plugins.exists() {
        return Ok(descriptors);
    }
    let metadata = paths.codex_home.join(
        ".tmp/bundled-marketplaces/openai-bundled/plugins/unified-computer-use/.codex-plugin/plugin.json",
    );
    let active_version = if metadata.exists() {
        let plugin: Value = serde_json::from_slice(&read_regular(&metadata, 64 * 1024)?)?;
        let version = plugin["version"]
            .as_str()
            .context("Missing active CUA plugin version")?;
        Some(version.to_owned())
    } else {
        None
    };
    for entry in fs::read_dir(plugins)? {
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
        let value: Value = serde_json::from_slice(&read_regular(&descriptor, MAX_DESCRIPTOR)?)?;
        let server = &value["mcpServers"]["cua_repl"];
        if !server.is_null() && server["enabled"] != false {
            descriptors.push(descriptor);
        }
    }
    Ok(descriptors)
}

fn proxy_import(state: &Path) -> Result<String> {
    let module = reqwest::Url::from_file_path(state.join("proxy.mjs"))
        .map_err(|_| anyhow::anyhow!("CUA proxy module must be an absolute path"))?;
    Ok(format!(
        "--import={}",
        serde_json::to_string(module.as_str())?
    ))
}

fn descriptor_env(descriptor: &mut Value) -> Result<&mut serde_json::Map<String, Value>> {
    descriptor["mcpServers"]["cua_repl"]
        .as_object_mut()
        .context("Invalid CUA server configuration")?
        .entry("env")
        .or_insert_with(|| json!({}))
        .as_object_mut()
        .context("Invalid CUA environment")
}

fn node_options(env: &serde_json::Map<String, Value>) -> Result<Option<&str>> {
    env.get("NODE_OPTIONS")
        .map(|value| value.as_str().context("CUA NODE_OPTIONS must be a string"))
        .transpose()
}

fn without_proxy_import(options: Option<&str>, import: &str) -> Option<String> {
    options.and_then(|options| {
        if options.contains(import) {
            let remaining = options.replace(import, "");
            let remaining = remaining.trim();
            (!remaining.is_empty()).then(|| remaining.to_owned())
        } else {
            Some(options.to_owned())
        }
    })
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
        let receipts = self.paths.state.join("descriptors");
        if receipts.exists() {
            let import = proxy_import(&self.paths.state)?;
            for entry in fs::read_dir(receipts)? {
                let journal: DescriptorJournal =
                    serde_json::from_slice(&read_regular(&entry?.path(), MAX_DESCRIPTOR * 3)?)?;
                if !journal.path.exists() {
                    continue;
                }
                let mut descriptor: Value =
                    serde_json::from_slice(&read_regular(&journal.path, MAX_DESCRIPTOR)?)?;
                if descriptor["mcpServers"]["cua_repl"].is_null() {
                    continue;
                }
                let env = descriptor_env(&mut descriptor)?;
                let current = node_options(env)?;
                let original = if current == Some(journal.patched.as_str()) {
                    journal.original
                } else if current.is_some_and(|value| value.contains(&import)) {
                    without_proxy_import(current, &import)
                } else {
                    continue;
                };
                if let Some(original) = original {
                    env.insert("NODE_OPTIONS".into(), json!(original));
                } else {
                    env.remove("NODE_OPTIONS");
                }
                atomic_write(&journal.path, &serde_json::to_vec_pretty(&descriptor)?)?;
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
        let import = proxy_import(&self.paths.state)?;
        for target in discover(&self.paths)? {
            let _guards = pin_parents(&target)?;
            let mut descriptor: Value =
                serde_json::from_slice(&read_regular(&target, MAX_DESCRIPTOR)?)?;
            let env = descriptor_env(&mut descriptor)?;
            let current = node_options(env)?;
            let receipt = self.paths.state.join("descriptors").join(format!(
                "{:x}.json",
                Sha256::digest(target.as_os_str().as_encoded_bytes())
            ));
            if receipt.exists() {
                let journal: DescriptorJournal =
                    serde_json::from_slice(&read_regular(&receipt, MAX_DESCRIPTOR * 3)?)?;
                if current == Some(journal.patched.as_str()) {
                    continue;
                }
            }
            let original = without_proxy_import(current, &import);
            let patched = match &original {
                Some(options) if !options.is_empty() => format!("{options} {import}"),
                _ => import.clone(),
            };
            plain_path(&receipt)?;
            fs::create_dir_all(receipt.parent().context("Missing CUA backup directory")?)?;
            atomic_write(
                &receipt,
                &serde_json::to_vec(&DescriptorJournal {
                    path: target.clone(),
                    original,
                    patched: patched.clone(),
                })?,
            )?;
            env.insert("NODE_OPTIONS".into(), json!(patched));
            atomic_write(&target, &serde_json::to_vec_pretty(&descriptor)?)?;
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
                json!({"detail": "Official CUA proxy environment prepared"}),
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

    fn descriptor_path(paths: &Paths) -> PathBuf {
        paths
            .codex_home
            .join("plugins/cache/openai-bundled/unified-computer-use/v1/.mcp.json")
    }

    fn read_descriptor(paths: &Paths) -> Value {
        serde_json::from_slice(&fs::read(descriptor_path(paths)).unwrap()).unwrap()
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
    fn supports_runtime_outside_cache_without_modifying_launch_arguments() {
        let temp = tempfile::tempdir().unwrap();
        let paths = paths(&temp);
        let (entry, mut descriptor) = fixture(&paths, "runtime1");
        descriptor["mcpServers"]["cua_repl"]["command"] = json!(
            paths
                .codex_home
                .join("Program Files/WindowsApps/Codex/resources/cua_node/bin/node.exe")
        );
        fs::write(
            descriptor_path(&paths),
            serde_json::to_vec(&descriptor).unwrap(),
        )
        .unwrap();
        let adapter = Adapter::acquire(paths.clone(), BTreeMap::new()).unwrap();
        adapter.refresh(None).unwrap();
        let mut patched = read_descriptor(&paths);
        let options = descriptor_env(&mut patched)
            .unwrap()
            .remove("NODE_OPTIONS")
            .unwrap();
        assert!(options.as_str().unwrap().contains("--import="));
        assert_eq!(patched, descriptor);
        assert_eq!(fs::read_to_string(entry).unwrap(), SOURCE);
        drop(adapter);
        assert_eq!(read_descriptor(&paths), descriptor);
    }

    #[test]
    fn discovery_prefers_active_plugin_and_supports_multiple_cached_descriptors() {
        let temp = tempfile::tempdir().unwrap();
        let paths = paths(&temp);
        fixture(&paths, "runtime1");
        let old_plugin = paths
            .codex_home
            .join("plugins/cache/openai-bundled/unified-computer-use");
        fs::rename(old_plugin.join("v1"), old_plugin.join("old")).unwrap();
        fixture(&paths, "runtime2");
        assert_eq!(discover(&paths).unwrap().len(), 2);
        let metadata = paths.codex_home.join(".tmp/bundled-marketplaces/openai-bundled/plugins/unified-computer-use/.codex-plugin/plugin.json");
        fs::create_dir_all(metadata.parent().unwrap()).unwrap();
        fs::write(
            &metadata,
            r#"{"name":"unified-computer-use","version":"v1"}"#,
        )
        .unwrap();
        assert_eq!(discover(&paths).unwrap(), vec![descriptor_path(&paths)]);
        let mut disabled = read_descriptor(&paths);
        disabled["mcpServers"]["cua_repl"]["enabled"] = json!(false);
        fs::write(
            descriptor_path(&paths),
            serde_json::to_vec(&disabled).unwrap(),
        )
        .unwrap();
        assert!(discover(&paths).unwrap().is_empty());
    }

    #[test]
    fn install_is_idempotent_updates_proxy_and_restores_original() {
        let temp = tempfile::tempdir().unwrap();
        let paths = paths(&temp);
        let (entry, descriptor) = fixture(&paths, "runtime1");
        let adapter = Adapter::acquire(paths.clone(), BTreeMap::new()).unwrap();
        assert!(Adapter::acquire(paths.clone(), BTreeMap::new()).is_err());
        assert_eq!(fs::read_to_string(&entry).unwrap(), SOURCE);
        adapter.refresh(None).unwrap();
        assert!(
            read_descriptor(&paths)["mcpServers"]["cua_repl"]["env"]["NODE_OPTIONS"].is_string()
        );
        adapter
            .refresh(Some("http://127.0.0.1:1234".into()))
            .unwrap();
        let patched = fs::read(descriptor_path(&paths)).unwrap();
        adapter
            .refresh(Some("http://127.0.0.1:2345".into()))
            .unwrap();
        assert_eq!(fs::read(descriptor_path(&paths)).unwrap(), patched);
        let config: Control =
            serde_json::from_slice(&fs::read(paths.state.join("control.json")).unwrap()).unwrap();
        assert_eq!(config.env["HTTPS_PROXY"], "http://127.0.0.1:2345");
        drop(adapter);
        assert_eq!(fs::read_to_string(&entry).unwrap(), SOURCE);
        assert_eq!(read_descriptor(&paths), descriptor);
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
        let (old, original) = fixture(&paths, "runtime1");
        let adapter = Adapter::acquire(paths.clone(), BTreeMap::new()).unwrap();
        adapter
            .refresh(Some("http://127.0.0.1:1234".into()))
            .unwrap();
        let candidate = fs::read(descriptor_path(&paths)).unwrap();
        drop(adapter);
        // A terminated process leaves this exact candidate and its durable journal.
        fs::write(descriptor_path(&paths), candidate).unwrap();
        let adapter = Adapter::acquire(paths.clone(), BTreeMap::new()).unwrap();
        assert_eq!(read_descriptor(&paths), original);
        adapter
            .refresh(Some("http://127.0.0.1:1234".into()))
            .unwrap();
        let (new, updated) = fixture(&paths, "runtime2");
        adapter
            .refresh(Some("http://127.0.0.1:1234".into()))
            .unwrap();
        assert!(
            read_descriptor(&paths)["mcpServers"]["cua_repl"]["env"]["NODE_OPTIONS"].is_string()
        );
        drop(adapter);
        assert_eq!(read_descriptor(&paths), updated);
        assert_eq!(fs::read_to_string(old).unwrap(), SOURCE);
        assert_eq!(fs::read_to_string(new).unwrap(), SOURCE);
    }

    #[test]
    fn preserves_existing_options_and_external_edits_during_refresh_and_restore() {
        let temp = tempfile::tempdir().unwrap();
        let paths = paths(&temp);
        let (_, mut original) = fixture(&paths, "runtime1");
        original["mcpServers"]["cua_repl"]["env"]["NODE_OPTIONS"] = json!("--no-warnings");
        fs::write(
            descriptor_path(&paths),
            serde_json::to_vec(&original).unwrap(),
        )
        .unwrap();
        let adapter = Adapter::acquire(paths.clone(), BTreeMap::new()).unwrap();
        adapter.refresh(None).unwrap();
        let mut changed = read_descriptor(&paths);
        let env = descriptor_env(&mut changed).unwrap();
        let options = format!("{} --trace-warnings", node_options(env).unwrap().unwrap());
        env.insert("NODE_OPTIONS".into(), json!(options));
        env.insert("EXTERNAL_EDIT".into(), json!("preserved"));
        fs::write(
            descriptor_path(&paths),
            serde_json::to_vec(&changed).unwrap(),
        )
        .unwrap();
        adapter.refresh(None).unwrap();
        let refreshed = read_descriptor(&paths);
        let options = refreshed["mcpServers"]["cua_repl"]["env"]["NODE_OPTIONS"]
            .as_str()
            .unwrap();
        assert_eq!(options.matches("--import=").count(), 1);
        assert!(options.contains("--no-warnings") && options.contains("--trace-warnings"));
        drop(adapter);
        let restored = read_descriptor(&paths);
        assert_eq!(
            restored["mcpServers"]["cua_repl"]["env"]["NODE_OPTIONS"]
                .as_str()
                .unwrap()
                .split_whitespace()
                .collect::<Vec<_>>(),
            vec!["--no-warnings", "--trace-warnings"]
        );
        assert_eq!(
            restored["mcpServers"]["cua_repl"]["env"]["EXTERNAL_EDIT"],
            "preserved"
        );
    }

    #[test]
    fn restores_only_our_import_after_options_change_and_rejects_invalid_environment() {
        let temp = tempfile::tempdir().unwrap();
        let paths = paths(&temp);
        fixture(&paths, "runtime1");
        let adapter = Adapter::acquire(paths.clone(), BTreeMap::new()).unwrap();
        adapter.refresh(None).unwrap();
        let mut changed = read_descriptor(&paths);
        let env = descriptor_env(&mut changed).unwrap();
        let options = format!("{} --no-warnings", node_options(env).unwrap().unwrap());
        env.insert("NODE_OPTIONS".into(), json!(options));
        fs::write(
            descriptor_path(&paths),
            serde_json::to_vec(&changed).unwrap(),
        )
        .unwrap();
        drop(adapter);
        assert_eq!(
            read_descriptor(&paths)["mcpServers"]["cua_repl"]["env"]["NODE_OPTIONS"],
            "--no-warnings"
        );
        changed["mcpServers"]["cua_repl"]["env"]["NODE_OPTIONS"] = json!(42);
        fs::write(
            descriptor_path(&paths),
            serde_json::to_vec(&changed).unwrap(),
        )
        .unwrap();
        let error = Adapter::acquire(paths.clone(), BTreeMap::new())
            .err()
            .unwrap();
        assert!(error.to_string().contains("NODE_OPTIONS must be a string"));
    }

    #[test]
    fn restores_legacy_runtime_patch_before_configuring_descriptor() {
        let temp = tempfile::tempdir().unwrap();
        let paths = paths(&temp);
        let (entry, _) = fixture(&paths, "runtime1");
        let patched = format!("{SOURCE}// legacy proxy patch");
        let receipt = paths.state.join("runtime1/journal.json");
        fs::create_dir_all(receipt.parent().unwrap()).unwrap();
        fs::write(
            &receipt,
            serde_json::to_vec(&Journal {
                original: SOURCE.into(),
                patched: patched.clone(),
            })
            .unwrap(),
        )
        .unwrap();
        fs::write(&entry, patched).unwrap();
        let adapter = Adapter::acquire(paths.clone(), BTreeMap::new()).unwrap();
        assert_eq!(fs::read_to_string(&entry).unwrap(), SOURCE);
        adapter.refresh(None).unwrap();
        assert_eq!(fs::read_to_string(&entry).unwrap(), SOURCE);
        assert!(
            read_descriptor(&paths)["mcpServers"]["cua_repl"]["env"]["NODE_OPTIONS"].is_string()
        );
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
        let mut paths = paths(&temp);
        paths.state = paths.state.join("proxy state 中文");
        let (entry, mut original) = fixture(&paths, "runtime1");
        original["mcpServers"]["cua_repl"]["env"]["NODE_OPTIONS"] = json!("--no-warnings");
        fs::write(
            descriptor_path(&paths),
            serde_json::to_vec(&original).unwrap(),
        )
        .unwrap();
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
        let descriptor = read_descriptor(&paths);
        let args: Vec<_> = descriptor["mcpServers"]["cua_repl"]["args"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_str().unwrap())
            .collect();
        let mut command = std::process::Command::new("node");
        command.args(&args);
        command.envs(
            descriptor["mcpServers"]["cua_repl"]["env"]
                .as_object()
                .unwrap()
                .iter()
                .map(|(key, value)| (key, value.as_str().unwrap())),
        );
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
    #[ignore = "temporarily patches the official CUA startup environment; press Enter to restore"]
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
