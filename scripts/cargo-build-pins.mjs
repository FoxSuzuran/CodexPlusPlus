import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export function staleIncrementalDirectories(targetDir) {
  const target = fs.realpathSync(targetDir);
  const cutoff = Date.now() - 3 * 24 * 60 * 60 * 1000;
  const newestMtime = file => {
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink() || (stat.isDirectory() && file.endsWith("-working"))) return Infinity;
    let newest = stat.mtimeMs;
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(file)) newest = Math.max(newest, newestMtime(path.join(file, name)));
    }
    return newest;
  };
  const stale = [];
  for (const profile of ["debug", "release"]) {
    const folder = path.join(target, profile, "incremental");
    if (!fs.existsSync(folder)) continue;
    assert.equal(fs.lstatSync(folder).isSymbolicLink(), false, "linked incremental directory");
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || !/^[A-Za-z_][A-Za-z_\d]*-[a-z\d]+$/.test(entry.name)) continue;
      const directory = path.join(folder, entry.name);
      if (newestMtime(directory) < cutoff) stale.push(directory);
    }
  }
  return stale.sort();
}

export function buildPins(logs, targetDir) {
  const target = fs.realpathSync(targetDir);
  assert.equal(target.toLowerCase(), path.resolve(targetDir).toLowerCase(), "target must stay in the workspace");
  const hashes = new Set();
  const artifactFiles = new Set();
  const profiles = new Set();
  const recordPath = (file, directory = false) => {
    const relative = path.relative(target, file);
    assert.ok(relative && !relative.startsWith("..") && !path.isAbsolute(relative), "artifact outside target");
    const profile = relative.split(path.sep)[0];
    assert.ok(["debug", "release"].includes(profile), "unexpected build profile");
    profiles.add(profile);
    assert.equal(fs.statSync(file).isDirectory(), directory, `missing artifact: ${file}`);
    if (!directory) artifactFiles.add(file);
    for (const match of file.matchAll(/-([a-f\d]{16})(?=[./\\]|$)/g)) hashes.add(match[1]);
  };
  for (const log of logs) {
    // cargo test emits test-harness output after its JSON build messages.
    const records = fs.readFileSync(log, "utf8").replace(/^\uFEFF/, "").trim().split(/\r?\n/)
      .filter(line => line.trimStart().startsWith("{")).map(JSON.parse).filter(record => record.reason);
    assert.equal(records.at(-1)?.reason, "build-finished", "incomplete Cargo build log");
    assert.equal(records.at(-1)?.success, true, "Cargo build did not succeed");
    let artifacts = 0;
    for (const record of records) {
      if (record.reason === "compiler-artifact") {
        artifacts++;
        for (const file of record.filenames) recordPath(file);
        if (record.executable) recordPath(record.executable);
      } else if (record.reason === "build-script-executed") {
        recordPath(record.out_dir, true);
      }
    }
    assert.ok(artifacts > 0, "Cargo artifact log is empty");
  }
  assert.deepEqual([...profiles].sort(), ["debug", "release"], "both dev/test and release must be built");
  const fingerprintFiles = [];
  for (const profile of profiles) {
    const folder = path.join(target, profile);
    for (const name of ["", ".fingerprint", "deps", "build"]) {
      assert.equal(fs.lstatSync(path.join(folder, name)).isSymbolicLink(), false, "linked build directory");
    }
    const fingerprints = path.join(folder, ".fingerprint");
    for (const entry of fs.readdirSync(fingerprints, { withFileTypes: true })) {
      assert.ok(entry.isDirectory() && !entry.isSymbolicLink(), "unexpected fingerprint entry");
      const folder = path.join(fingerprints, entry.name);
      const names = fs.readdirSync(folder);
      // Cargo reports normal binaries without a hash; keep their fingerprints conservatively.
      if (!hashes.has(entry.name.slice(-16)) && !names.some(name => name.startsWith("bin-"))) continue;
      for (const name of names) {
        const file = path.join(folder, name);
        assert.equal(fs.lstatSync(file).isFile(), true, "unexpected fingerprint file");
        fingerprintFiles.push(file);
      }
    }
  }
  assert.ok(fingerprintFiles.length > 0, "no live fingerprints found");
  return {
    fingerprintFiles: fingerprintFiles.sort(), artifactFiles: [...artifactFiles].sort(),
    staleIncrementalDirectories: staleIncrementalDirectories(target),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  assert.equal(process.argv.length, 4, "pass the dev/test and release Cargo JSON logs");
  console.log(JSON.stringify(buildPins(process.argv.slice(2), path.join(root, "target"))));
}
