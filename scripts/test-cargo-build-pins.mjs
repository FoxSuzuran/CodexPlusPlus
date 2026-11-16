import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { buildPins, staleIncrementalDirectories } from "./cargo-build-pins.mjs";

function fixture(t) {
  const temporary = fs.realpathSync(process.env.TEMP || os.tmpdir());
  const root = fs.mkdtempSync(path.join(temporary, "cargo-pins-"));
  t.after(() => {
    assert.equal(path.dirname(fs.realpathSync(root)), temporary);
    fs.rmSync(root, { recursive: true, force: true });
  });
  const logs = [];
  for (const profile of ["debug", "release"]) {
    for (const name of [".fingerprint", "deps", "build"]) fs.mkdirSync(path.join(root, profile, name), { recursive: true });
    const artifact = path.join(root, profile, "deps/libfixture-0123456789abcdef.rlib");
    fs.writeFileSync(artifact, "current");
    for (const [hash, name] of [["0123456789abcdef", "lib-fixture"], ["1111111111111111", "lib-fixture"], ["2222222222222222", "bin-fixture"]]) {
      const folder = path.join(root, profile, ".fingerprint", `fixture-${hash}`);
      fs.mkdirSync(folder);
      fs.writeFileSync(path.join(folder, `${name}.json`), "{}");
    }
    const log = path.join(root, `${profile}.jsonl`);
    fs.writeFileSync(log, [
      { reason: "compiler-artifact", filenames: [artifact], executable: null },
      { reason: "build-finished", success: true },
    ].map(JSON.stringify).join("\n"));
    logs.push(log);
  }
  return { root, logs };
}

test("pins both live graphs and unhashed binary fingerprints, leaving old libraries unpinned", t => {
  const { root, logs } = fixture(t);
  const result = buildPins(logs, root);
  assert.equal(result.artifactFiles.length, 2);
  assert.equal(result.fingerprintFiles.length, 4);
  assert.ok(result.fingerprintFiles.every(file => !file.includes("1111111111111111")));
});

test("rejects incomplete or failed build logs", t => {
  const { root, logs } = fixture(t);
  fs.writeFileSync(logs[1], JSON.stringify({ reason: "build-finished", success: false }));
  assert.throws(() => buildPins(logs, root), /did not succeed/);
  fs.writeFileSync(logs[1], JSON.stringify({ reason: "compiler-artifact", filenames: [] }));
  assert.throws(() => buildPins(logs, root), /incomplete/);
});

test("rejects artifacts outside target and missing artifacts", t => {
  const { root, logs } = fixture(t);
  const records = fs.readFileSync(logs[0], "utf8").split("\n").map(JSON.parse);
  records[0].filenames = [path.join(root, "../outside.rlib")];
  fs.writeFileSync(logs[0], records.map(JSON.stringify).join("\n"));
  assert.throws(() => buildPins(logs, root), /outside target/);
  records[0].filenames = [path.join(root, "debug/deps/missing.rlib")];
  fs.writeFileSync(logs[0], records.map(JSON.stringify).join("\n"));
  assert.throws(() => buildPins(logs, root), /ENOENT/);
});

test("accepts relevant cargo test logs without requiring another test compilation", t => {
  const { root, logs } = fixture(t);
  fs.appendFileSync(logs[0], "\nrunning 1 test\ntest relevant ... ok\ntest result: ok. 1 passed\n");
  assert.equal(buildPins(logs, root).artifactFiles.length, 2);
  fs.appendFileSync(logs[0], '{"reason":"compiler-artifact"');
  assert.throws(() => buildPins(logs, root), SyntaxError);
});

test("incremental cleanup plans only caches older than three days and retains active or recently written sessions", t => {
  const { root } = fixture(t);
  const base = path.join(root, "debug/incremental");
  const old = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000);
  const make = (name, session) => {
    const directory = path.join(base, name);
    const child = path.join(directory, session);
    fs.mkdirSync(child, { recursive: true });
    const data = path.join(child, "query-cache.bin");
    fs.writeFileSync(data, "cache");
    for (const file of [data, child, directory]) fs.utimesSync(file, old, old);
    return { directory, data };
  };
  const stale = make("fixture-old1", "s-finalized");
  const fresh = make("fixture-fresh1", "s-finalized");
  fs.utimesSync(fresh.data, new Date(), new Date());
  make("fixture-active1", "s-session-working");
  make("unknown-directory-name", "s-finalized");
  assert.deepEqual(staleIncrementalDirectories(root), [stale.directory]);
  assert.ok(fs.existsSync(stale.directory), "planning must not delete files");
});
