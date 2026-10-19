const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const source = fs.readFileSync(path.join(__dirname, "profile-renderer.cjs"), "utf8");

async function record(mode, failure = false, occupied = false) {
  const calls = [], files = new Map(), marks = new Map();
  let finish, clock = 0;
  const closed = new Promise(resolve => { finish = resolve; });
  const window = occupied ? { __codexPlusProfileProbe: { existing: true } } : {};
  window.__CODEX_DREAM_SKIN_STATE__ = { themeId: "fixture", version: "fixture-v1" };
  window.__codexPlusUserScripts = { scripts: { fixture: { key: "fixture", status: "loaded" } } };
  const renderer = vm.createContext({
    window, document: { visibilityState: "visible", getElementsByTagName: () => [] },
    performance: {
      timeOrigin: 123, now: () => ++clock,
      mark: name => { marks.set(name, clock); calls.push(name.endsWith(":start") ? "window:start" : "window:end"); },
      clearMarks: name => marks.delete(name),
    },
    PerformanceObserver: { supportedEntryTypes: [] },
    requestAnimationFrame: () => 1, cancelAnimationFrame: () => {},
  });
  class Socket extends EventTarget {
    constructor() { super(); queueMicrotask(() => this.dispatchEvent(new Event("open"))); }
    receive(message) {
      const event = new MessageEvent("message", { data: JSON.stringify(message) });
      this.onmessage?.(event);
      this.dispatchEvent(event);
    }
    send(text) {
      const { id, method, params } = JSON.parse(text);
      calls.push(method);
      let result = {};
      if (method === "Runtime.evaluate") {
        try { result = { result: { value: vm.runInContext(params.expression, renderer) } }; }
        catch (error) { result = { exceptionDetails: { text: error.message } }; }
      }
      if (method === "Performance.getMetrics") result = { metrics: [{ name: "Timestamp", value: ++clock }] };
      if (method === "Profiler.stop") result = { profile: {
        nodes: [{ id: 1, callFrame: { functionName: "(root)" } }], samples: [1], timeDeltas: [1000],
      } };
      if (method === "IO.read") result = { data: '{"traceEvents":[]}', eof: true };
      queueMicrotask(() => {
        this.receive({ id, result });
        if (method === "Tracing.end") this.receive({ method: "Tracing.tracingComplete", params: { stream: "trace" } });
      });
    }
    close() { finish(); }
  }
  const process = { argv: ["node", "profile-renderer.cjs", mode, "3"], exitCode: 0 };
  vm.runInNewContext(source, {
    require: name => name === "node:fs" ? {
      mkdirSync() {},
      writeFileSync(name, text) {
        if (failure) throw Error("output failed");
        files.set(name, text);
      },
      openSync: name => { files.set(name, ""); return name; },
      writeSync: (name, text) => files.set(name, files.get(name) + text),
      closeSync() {}, statSync: name => ({ size: files.get(name).length }),
    } : require(name),
    __dirname, process, console: { log() {}, error() {} }, WebSocket: Socket, AbortSignal,
    fetch: async () => ({ json: async () => [{ type: "page", url: "app://-/index.html", webSocketDebuggerUrl: "ws://fixture" }] }),
    setTimeout: (fn, ms) => setTimeout(fn, ms === 3000 ? 0 : ms), clearTimeout,
  });
  let timeout;
  try {
    await Promise.race([closed, new Promise((_, reject) => {
      timeout = setTimeout(() => reject(Error(`Recording hung: ${calls.join(", ")}`)), 5000);
    })]);
  } finally { clearTimeout(timeout); }
  await new Promise(resolve => setImmediate(resolve));
  return { calls, files, marks, window, exitCode: process.exitCode };
}

for (const mode of ["baseline", "cpu", "trace"]) {
  test(`${mode} captures the expected files and releases its instrumentation`, async () => {
    const result = await record(mode);
    assert.equal(result.exitCode, 0);
    assert.equal(Object.hasOwn(result.window, "__codexPlusProfileProbe"), false);
    assert.equal(result.marks.size, 0);
    const names = [...result.files.keys()];
    const report = JSON.parse(result.files.get(names.find(name => name.endsWith(".json") && !name.endsWith(".trace.json"))));
    assert.equal(report.probe.timeOrigin, 123);
    assert.equal(report.probe.marks.length, 2);
    assert.equal(report.probe.surfaceAtStart.skinActive, true);
    assert.equal(report.probe.surfaceAtStart.skinTheme, "fixture");
    assert.deepEqual(report.probe.surfaceAtStart, report.probe.surfaceAtEnd);
    assert.deepEqual(report.probe.surfaceAtEnd.scripts, [{ key: "fixture", status: "loaded" }]);
    assert.equal(names.some(name => name.endsWith(".cpuprofile")), mode !== "baseline");
    assert.equal(names.some(name => name.endsWith(".trace.json")), mode === "trace");
    if (mode !== "baseline") {
      assert.ok(result.calls.indexOf("Profiler.start") < result.calls.indexOf("window:start"));
      assert.ok(result.calls.indexOf("window:end") < result.calls.indexOf("Profiler.stop"));
      assert.ok(result.calls.includes("Profiler.disable"));
    }
    if (mode === "trace") {
      assert.ok(result.calls.indexOf("Tracing.start") < result.calls.indexOf("window:start"));
      assert.ok(result.calls.indexOf("window:end") < result.calls.indexOf("Tracing.end"));
    }
  });
}

test("trace output failure still stops both profilers and removes the probe", async () => {
  const result = await record("trace", true);
  assert.equal(result.exitCode, 1);
  assert.ok(result.calls.includes("Tracing.end"));
  assert.ok(result.calls.includes("Profiler.disable"));
  assert.equal(Object.hasOwn(result.window, "__codexPlusProfileProbe"), false);
  assert.equal(result.marks.size, 0);
});

test("an existing recording is left untouched", async () => {
  const result = await record("trace", false, true);
  assert.equal(result.exitCode, 1);
  assert.equal(result.window.__codexPlusProfileProbe.existing, true);
  assert.equal(result.calls.includes("Profiler.start"), false);
});
