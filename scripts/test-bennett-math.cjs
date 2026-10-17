const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const {createRequire} = require("node:module");
const {test} = require("node:test");
const ts = createRequire(path.resolve(__dirname, "../apps/codex-plus-manager/package.json"))("typescript");
const input = process.env.BENNETT_SCRIPT ||
  path.join(process.env.APPDATA, "Codex++/user_scripts/market-bennett-ui-improvements.js");
const source = ts.createSourceFile(input, fs.readFileSync(input,"utf8"), ts.ScriptTarget.Latest, true);
const names = ["currentMainModuleUrl","discoverKatexUrl","loadNativeKatex","scanEditors"];
const found = new Map();
function visit(node) {
  if (ts.isFunctionDeclaration(node) && names.includes(node.name?.text)) found.set(node.name.text,node.getText(source));
  ts.forEachChild(node,visit);
}
visit(source);
const code = names.map(name => {assert.ok(found.has(name),name);return found.get(name);}).join("\n");
function harness() {
  const context = vm.createContext({});
  return vm.runInContext(`
    let scanFrame=0,disposed=false,scanning=false,scanRequested=false;
    let katexPromise=null,katexRetryAt=0,lastError=null,mainModuleUrl="app://-/assets/app-initial-fixture.js";
    let fetches=0,warnings=0,installs=0,now=0,editors=[],removed=0;
    const states=new Map(),window={},performance={getEntriesByType:()=>[]},Date={now:()=>now};
    const api={log:{warn:()=>warnings++}};
    const findPreviewEditors=()=>editors;
    const removeState=state=>{removed++;states.delete(state.id);};
    const installForEditor=async()=>installs++,scheduleScan=()=>{};
    const fetch=async()=>{fetches++;return {ok:true,text:async()=>"/* missing native katex import */"};};
    ${code}
    ({
      scan:scanEditors,load:loadNativeKatex,
      addStale:()=>states.set("old",{id:"old",editor:{isConnected:false},view:{destroyed:false}}),
      setEditors:value=>editors=value,setTime:value=>now=value,
      provideKatex:()=>window.katex={renderToString:()=>""},
      stats:()=>({fetches,warnings,installs,removed,lastError,states:states.size})
    });
  `,context);
}

test("empty preview scans clean stale state without discovering or loading KaTeX", async()=>{
  const h=harness();h.addStale();
  for(let i=0;i<100;i++)await h.scan();
  const s=h.stats();
  assert.equal(s.fetches,0);assert.equal(s.warnings,0);assert.equal(s.removed,1);assert.equal(s.states,0);
});
test("failed discovery is cached for 30 seconds and can recover after the cooldown", async()=>{
  const h=harness();h.setEditors([{}]);
  for(let i=0;i<20;i++)await h.scan();
  assert.equal(h.stats().fetches,1);assert.equal(h.stats().warnings,1);
  h.setTime(29999);await h.scan();assert.equal(h.stats().fetches,1);
  h.setTime(30000);await h.scan();assert.equal(h.stats().fetches,2);
  h.provideKatex();h.setTime(60000);await h.scan();
  assert.equal(h.stats().installs,1);assert.equal(h.stats().lastError,null);
  await h.scan();assert.equal(h.stats().fetches,2);assert.equal(h.stats().installs,2);
});
test("an available native KaTeX renderer still installs the preview enhancement",async()=>{
  const h=harness();h.provideKatex();h.setEditors([{},{}]);await h.scan();
  assert.equal(h.stats().installs,2);assert.equal(h.stats().fetches,0);
});
