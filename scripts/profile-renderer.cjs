const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { once } = require("node:events");

const mode = process.argv[2] || "baseline";
const seconds = Number(process.argv[3] || 15);
assert.ok(["baseline", "cpu", "trace"].includes(mode), "Use baseline, cpu or trace");
assert.ok(Number.isInteger(seconds) && seconds >= 3 && seconds <= 60, "Duration must be 3–60 seconds");
const folder = path.resolve(__dirname, "../target/temp");
fs.mkdirSync(folder, { recursive: true });
const output = path.join(folder, `renderer-${mode}-${Date.now()}`);
const markPrefix = path.basename(output);
const sampled = mode !== "baseline";
const pending = new Map();
let socket, serial = 0, profiling = false, tracing = false;

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++serial;
    const timer = setTimeout(() => { pending.delete(id); reject(Error(`${method} timed out`)); }, 30000);
    pending.set(id, message => {
      clearTimeout(timer);
      message.error ? reject(Error(message.error.message)) : resolve(message.result);
    });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await send("Runtime.evaluate", { expression, returnByValue: true });
  assert.ok(!result.exceptionDetails, result.exceptionDetails?.text);
  return result.result.value;
}
async function main() {
  const targets = await (await fetch("http://127.0.0.1:9229/json/list",
    { signal: AbortSignal.timeout(10000) })).json();
  const pages = targets.filter(t => t.type === "page" && /^app:\/\/-\/index\.html(?:[?#]|$)/.test(t.url));
  assert.equal(pages.length, 1, "Expected exactly one native renderer on port 9229");
  socket = new WebSocket(pages[0].webSocketDebuggerUrl);
  socket.onmessage = event => {
    const message = JSON.parse(event.data), receive = pending.get(message.id);
    if (receive) { pending.delete(message.id); receive(message); }
  };
  await once(socket, "open");
  assert.equal(await evaluate("Object.hasOwn(window,'__codexPlusProfileProbe')"), false,
    "A renderer recording is already active");
  try {
    await send("Performance.enable");
    if (sampled) {
      await send("Profiler.enable");
      await send("Profiler.setSamplingInterval", { interval: 2000 });
      // Profiler startup can pause V8; keep it outside the measured observer window.
      await send("Profiler.start"); profiling = true;
    }
    let completed;
    if (mode === "trace") {
      completed = new Promise(resolve => {
        const listener = event => {
          const message = JSON.parse(event.data);
          if (message.method !== "Tracing.tracingComplete") return;
          socket.removeEventListener("message", listener); resolve(message.params);
        };
        socket.addEventListener("message", listener);
      });
      await send("Tracing.start", {
        categories: "toplevel,devtools.timeline,blink.user_timing,v8,disabled-by-default-devtools.timeline",
        transferMode: "ReturnAsStream",
      }); tracing = true;
    }
    await evaluate(`(() => {
      const p={started:performance.now(),timeOrigin:performance.timeOrigin,tasks:[],events:[],frames:[],
        marks:[${JSON.stringify(`${markPrefix}:start`)},${JSON.stringify(`${markPrefix}:end`)}]}, observers=[];
      p.surface=()=>{
        const skin=window.__CODEX_DREAM_SKIN_STATE__||window.__CODEX_GLASS_VISION_SKIN_STATE__;
        return {skinActive:!!skin,skinTheme:skin?.themeId||null,skinVersion:skin?.version||null,
          scripts:Object.values(window.__codexPlusUserScripts?.scripts||{}).map(({key,status})=>({key,status}))};
      };
      p.surfaceAtStart=p.surface();
      performance.mark(p.marks[0]);
      function observe(type,receive,extra={}) {
        if(!PerformanceObserver.supportedEntryTypes.includes(type))return;
        const o=new PerformanceObserver(list=>list.getEntries().forEach(receive));
        o.observe({type,...extra});observers.push(o);
      }
      observe("longtask",e=>{if(p.tasks.length<1000)p.tasks.push({at:e.startTime,ms:e.duration})});
      observe("event",e=>{if(e.interactionId&&p.events.length<1000)p.events.push({
        name:e.name,at:e.startTime,ms:e.duration,delay:e.processingStart-e.startTime,
        processing:e.processingEnd-e.processingStart,interactionId:e.interactionId
      })},{durationThreshold:16});
      let frame,last=performance.now();
      function tick(now){if(now-last>50&&p.frames.length<1000)p.frames.push({at:now,gap:now-last});
        last=now;frame=requestAnimationFrame(tick)}
      frame=requestAnimationFrame(tick);
      p.cleanup=()=>{
        observers.forEach(o=>o.disconnect());cancelAnimationFrame(frame);
        performance.mark(p.marks[1]);p.marks.forEach(name=>performance.clearMarks(name));
      };
      window.__codexPlusProfileProbe=p;
    })()`);
    const before = await send("Performance.getMetrics");
    console.log(`Recording ${mode} for ${seconds}s. Use the app normally; no automated input.`);
    await new Promise(resolve => setTimeout(resolve, seconds * 1000));
    const after = await send("Performance.getMetrics");
    const probe = await evaluate(`(() => {
      const p=window.__codexPlusProfileProbe;p.cleanup();delete window.__codexPlusProfileProbe;
      return {started:p.started,ended:performance.now(),timeOrigin:p.timeOrigin,marks:p.marks,
        tasks:p.tasks,events:p.events,frames:p.frames,surfaceAtStart:p.surfaceAtStart,surfaceAtEnd:p.surface(),
        visible:document.visibilityState,nodes:document.getElementsByTagName("*").length};
    })()`);
    assert.ok(probe.ended > probe.started);
    if (profiling) {
      const { profile } = await send("Profiler.stop"); profiling = false;
      assert.ok(profile.nodes.length && profile.samples.length);
      fs.writeFileSync(`${output}.cpuprofile`, JSON.stringify(profile));
    }
    if (tracing) {
      await send("Tracing.end"); tracing = false;
      const result = await Promise.race([completed,
        new Promise((_, reject) => { const timer = setTimeout(() => reject(Error("Trace completion timed out")), 30000); timer.unref(); })]);
      const file = fs.openSync(`${output}.trace.json`, "w");
      try {
        for (;;) {
          const chunk = await send("IO.read", { handle: result.stream });
          fs.writeSync(file, chunk.base64Encoded ? Buffer.from(chunk.data, "base64") : chunk.data);
          if (chunk.eof) break;
        }
      } finally { fs.closeSync(file); await send("IO.close", { handle: result.stream }); }
      assert.ok(fs.statSync(`${output}.trace.json`).size > 0);
    }
    const previous = new Map(before.metrics.map(row => [row.name, row.value]));
    const metrics = Object.fromEntries(after.metrics.map(row =>
      [row.name, { value: row.value, delta: row.value - previous.get(row.name) }]));
    fs.writeFileSync(`${output}.json`, JSON.stringify({ mode, seconds, probe, metrics }, null, 2) + "\n");
    console.log(`Saved ${output}`);
  } finally {
    await evaluate(`(()=>{window.__codexPlusProfileProbe?.cleanup();delete window.__codexPlusProfileProbe})()`).catch(() => {});
    if (profiling) await send("Profiler.stop").catch(() => {});
    if (tracing) await send("Tracing.end").catch(() => {});
    if (sampled) await send("Profiler.disable").catch(() => {});
    await send("Performance.disable").catch(() => {});
    assert.equal(await evaluate("Object.hasOwn(window,'__codexPlusProfileProbe')"), false);
    socket.close();
  }
}
main().catch(error => { console.error(error.message); socket?.close(); process.exitCode = 1; });
