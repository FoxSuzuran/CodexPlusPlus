import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

function declarations(file: string, names: string[]) {
  const url = new URL(`../../../assets/inject/renderer-inject/${file}`, import.meta.url);
  const source = ts.createSourceFile(file, readFileSync(url, "utf8"), ts.ScriptTarget.Latest, true);
  return names.map(name => {
    const node = source.statements.find(node =>
      (ts.isFunctionDeclaration(node) && node.name?.text === name)
      || (ts.isVariableStatement(node) && node.declarationList.declarations.some(d => d.name.getText(source) === name)));
    assert.ok(node, name);
    return node.getText(source);
  }).join("\n");
}

const runtime = [
  declarations("50-navigation.js", ["restorePluginMarketplaceName", "codexPluginOfficialMarketplaceName",
    "codexPluginFilterSourceCache", "codexPluginFilterCallbackSource",
    "codexPluginBuildFlavorFilterSourcePattern", "codexPluginFeaturedFilterSourcePattern",
    "isCodexPluginBuildFlavorFilter", "isCodexPluginFeaturedFilter"]),
  declarations("60-plugin-marketplace.js", ["codexPluginHiddenFilterSourcePattern",
    "isCodexPluginMarketplaceHiddenFilter", "installPluginBuildFlavorFilterPatch"]),
].join("\n");

function run(expression: string) {
  return vm.runInNewContext(`
    const window = {}, codexPluginMarketplaceUnlockVersion = "test";
    const codexPluginMarketplacePatchEnabled = () => true;
    const sendCodexPlusDiagnostic = () => {};
    ${runtime}
    installPluginBuildFlavorFilterPatch();
    ${expression}
  `);
}

test("unrelated filters never inspect marketplace fields or re-run the callback", () => {
  const result = run(`
    let reads = 0, calls = 0;
    const rows = Array.from({length:20000},(_,id)=>({
      id, get marketplaceName(){reads++;},get name(){reads++;}
    }));
    const kept = rows.filter(function(row){calls++;return row.id%2===0;}, {test:true});
    ({reads,calls,ids:kept.map(row=>row.id)});
  `);
  assert.equal(result.reads, 0);
  assert.equal(result.calls, 20000);
  assert.deepEqual(Array.from(result.ids), Array.from({length:10000},(_,i)=>i*2));
});

test("official and featured plugin compatibility remains gated by data and callback shape", () => {
  const result = run(`
    const supported = () => true, selected = "external";
    const plugins = [{marketplaceName:"openai-bundled"},{marketplaceName:"external"}];
    const bypass = plugins.filter(e=>!supported(e.marketplaceName)||e.marketplaceName===selected);
    const ordinary = plugins.filter(e=>e.marketplaceName===selected);
    const external = [{marketplaceName:"third-party"}].filter(e=>!supported(e.marketplaceName)||e.marketplaceName===selected);
    const getMarket = () => "openai-bundled";
    const featured = ["official:id","external:id"].filter(e=>{let t=getMarket(e);return t==null||!supported(t)||t===selected;});
    const objects = [{}].filter(e=>{let t=getMarket(e);return t==null||!supported(t)||t===selected;});
    [bypass.length,ordinary.length,external.length,featured.length,objects.length];
  `);
  assert.deepEqual(Array.from(result), [2,1,0,2,0]);
});
