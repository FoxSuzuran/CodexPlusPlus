import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cssPredicateManifest } from "../vendor/codex-dream-skin/tools/css-predicate-cache.mjs";

const root = path.resolve(import.meta.dirname, "..");
const upstream = path.join(root, "vendor/codex-dream-skin");
const target = "assets/inject/upstream/dream-skin";
const check = process.argv.includes("--check");
if (process.argv.slice(2).some(arg => arg !== "--check")) throw new Error("Unknown argument");
const sha256 = text => createHash("sha256").update(text).digest("hex");
const read = async file => (await readFile(path.join(root, file), "utf8")).replace(/\r\n/g, "\n");
const commit = execFileSync("git", ["-C", upstream, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
if (execFileSync("git", ["-C", upstream, "status", "--porcelain"], { encoding: "utf8" }).trim()) {
  throw new Error("Dream Skin submodule must remain unmodified");
}
// Review upstream changes before advancing the gitlink. This check only reads.
execFileSync(process.execPath, [path.join(upstream, "tools/sync-runtime-assets.mjs"), "--check"], { stdio: "inherit" });
const outputs = [];
const manifest = { repository: "Fei-Away/Codex-Dream-Skin", commit, files: [] };
const runtimeCompatibility = await read("assets/inject/dream-skin-native-shell-compat.css")
  + "\n" + await read("assets/inject/dream-skin-community-compat.css");
for (const platform of ["windows", "macos"]) {
  const sourcePrefix = `vendor/codex-dream-skin/${platform}/assets`;
  const baseCss = await read(`${sourcePrefix}/dream-skin.css`);
  const baseRenderer = await read(`${sourcePrefix}/renderer-inject.js`);
  const compatibility = platform === "windows" ? await read("assets/inject/dream-skin-compat.windows.css") : "";
  // Native sidebar sizing writes root.style; alpha already has its own stable marker.
  const css = baseCss.replaceAll('[style*="--ds-upload-panel-alpha:"]', '[data-dream-upload-alpha="true"]')
    + (compatibility ? `\n${compatibility}` : "");
  if (css.split(":has(*)").length !== 2 ||
      !css.includes("[data-app-shell-main-content-top-fade]:not(:has(*))")) {
    throw new Error(`${platform}: top-fade predicate changed; review the adapter`);
  }
  // The rare top-fade owner can use native :has(*) without marking the entire DOM.
  // Rust appends community compatibility after the generated base stylesheet.
  const predicates = cssPredicateManifest(`${css}\n${runtimeCompatibility}`)
    .filter(({ selector }) => selector !== ":has(*)");
  if (predicates.some(({ selector }) => /:(?:empty|blank|dir)\b/.test(selector))) {
    throw new Error(`${platform}: text-sensitive predicate added; review the mutation filter`);
  }
  const declaration = /^  const CSS_PREDICATES = .+;?$/gm;
  const mutationAnchor = '        if (record.type !== "attributes") return true;';
  const ancestorAnchor = "            for (let ancestor = leaf.parentElement; ancestor; ancestor = ancestor.parentElement) candidates.add(ancestor);";
  const branchAnchor = "      for (const branch of branches) {";
  const schedulerAnchor = "    scheduler.timeout = null;\n    const pending = ";
  const timeoutAnchor = "    if (scheduler.timeout) return;";
  const observerAnchor = '  if (typeof MutationObserver === "function") {';
  const cleanupAnchor = "    if (state?.timer) clearInterval(state.timer);";
  const safetyAnchor = "    metrics.safetyPasses += 1;\n    ensure({ root: true });";
  const classAnchor = "const predicateClass = /main-surface|";
  if ([...baseRenderer.matchAll(declaration)].length !== 1 ||
      baseRenderer.split(mutationAnchor).length !== 2 ||
      baseRenderer.split(ancestorAnchor).length !== 2 ||
      baseRenderer.split(branchAnchor).length !== 2 ||
      [schedulerAnchor, timeoutAnchor, observerAnchor, cleanupAnchor, safetyAnchor, classAnchor]
        .some(anchor => baseRenderer.split(anchor).length !== 2) ||
      !baseRenderer.includes("refreshPredicates();") ||
      !baseRenderer.includes("removePredicates();")) {
    throw new Error(`${platform}: upstream predicate contract changed; review the adapter`);
  }
  // Include local compatibility CSS in the upstream manifest, never parse CSS in the renderer.
  const renderer = baseRenderer
    .replace(declaration, () => `  const CSS_PREDICATES = ${JSON.stringify(predicates)}`)
    .replace(classAnchor, "const predicateClass = /composer-surface-chrome|_ComposerLayoutRoot_|main-surface|")
    .replace(branchAnchor, `      const visitedAncestors = new Set();\n${branchAnchor}`)
    .replace(ancestorAnchor, `            for (let ancestor = leaf.parentElement; ancestor; ancestor = ancestor.parentElement) {
              if (visitedAncestors.has(ancestor)) break;
              visitedAncestors.add(ancestor);
              candidates.add(ancestor);
            }`)
    .replace(mutationAnchor, `        if (record.type === "childList" && record.addedNodes && record.removedNodes
            && ![...record.addedNodes, ...record.removedNodes].some(node => node.nodeType === 1)) return false;
${mutationAnchor}`)
    .replace(schedulerAnchor, `    scheduler.timeout = null;
    if (document.hidden) return;
    const pending = `)
    .replace(timeoutAnchor, "    if (document.hidden || scheduler.timeout) return;")
    .replace(observerAnchor, `  const visibilityHandler = () => {
    if (!document.hidden && (scheduler.root || scheduler.scope || scheduler.parts)) flushScheduledEnsure();
  };
  document.addEventListener?.("visibilitychange", visibilityHandler);
${observerAnchor}`)
    .replace(cleanupAnchor, `    document.removeEventListener?.("visibilitychange", visibilityHandler);
${cleanupAnchor}`)
    .replace(safetyAnchor, "    metrics.safetyPasses += 1;\n    scheduleEnsure({ root: true }, 0);");
  new Function(renderer);
  for (const [name, source, content] of [
    ["dream-skin.css", baseCss, css],
    ["renderer-inject.js", baseRenderer, renderer],
  ]) {
    const file = `${target}/${platform}/${name}`;
    outputs.push({ file, content });
    manifest.files.push({ file, upstreamSha256: sha256(source), sha256: sha256(content) });
  }
}
outputs.push({ file: `${target}/source.json`, content: JSON.stringify(manifest, null, 2) + "\n" });
// Finish all validation before overwriting any generated file.
let mismatches = 0;
for (const { file, content } of outputs) {
  if (check) {
    const current = await read(file).catch(() => null);
    if (current !== content) { console.error(`out-of-date=${file}`); mismatches++; }
  } else {
    await writeFile(path.join(root, file), content, "utf8");
  }
}
if (mismatches) throw new Error("Dream Skin assets drifted; run node scripts/sync-dream-skin.mjs");
console.log(`Dream Skin ${commit.slice(0, 12)}: ${check ? "checked" : "synchronized"}`);
