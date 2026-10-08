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
for (const platform of ["windows", "macos"]) {
  const sourcePrefix = `vendor/codex-dream-skin/${platform}/assets`;
  const baseCss = await read(`${sourcePrefix}/dream-skin.css`);
  const baseRenderer = await read(`${sourcePrefix}/renderer-inject.js`);
  const compatibility = platform === "windows" ? await read("assets/inject/dream-skin-compat.windows.css") : "";
  const css = baseCss + (compatibility ? `\n${compatibility}` : "");
  const predicates = cssPredicateManifest(css);
  if (predicates.some(({ selector }) => /:(?:empty|blank|dir)\b/.test(selector))) {
    throw new Error(`${platform}: text-sensitive predicate added; review the mutation filter`);
  }
  const declaration = /^  const CSS_PREDICATES = .+;?$/gm;
  const mutationAnchor = '        if (record.type !== "attributes") return true;';
  if ([...baseRenderer.matchAll(declaration)].length !== 1 ||
      baseRenderer.split(mutationAnchor).length !== 2 ||
      !baseRenderer.includes("refreshPredicates();") ||
      !baseRenderer.includes("removePredicates();")) {
    throw new Error(`${platform}: upstream predicate contract changed; review the adapter`);
  }
  // Include local compatibility CSS in the upstream manifest, never parse CSS in the renderer.
  const renderer = baseRenderer
    .replace(declaration, () => `  const CSS_PREDICATES = ${JSON.stringify(predicates)}`)
    .replace(mutationAnchor, `        if (record.type === "childList" && record.addedNodes && record.removedNodes
            && ![...record.addedNodes, ...record.removedNodes].some(node => node.nodeType === 1)) return false;
${mutationAnchor}`);
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
