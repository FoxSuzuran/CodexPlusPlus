#!/usr/bin/env node
// 从 CHANGELOG.md 生成官网最近版本数据。
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const outDir = join(root, "site", "data");

/* ---------------- 更新日志提取 ---------------- */

function buildReleases() {
  const raw = readFileSync(join(root, "CHANGELOG.md"), "utf8");
  const blocks = raw.split(/^## /m).slice(1);
  const releases = [];
  for (const block of blocks.slice(0, 4)) {
    const headerEnd = block.indexOf("\n");
    const header = block.slice(0, headerEnd).trim(); // 如 1.7.7 - 2026-10-13
    const m = header.match(/^([\w.+-]+)\s*-\s*(.+)$/);
    if (!m) continue;
    const items = block
      .slice(headerEnd + 1)
      .split(/^- /m)
      .slice(1)
      .map((item) => item.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .slice(0, 5)
      .map((text) => (text.length > 140 ? text.slice(0, 137) + "…" : text));
    releases.push({ version: m[1], date: m[2].trim(), items });
  }
  writeFileSync(join(outDir, "releases.json"), JSON.stringify({ generated_at: new Date().toISOString(), releases }, null, 2));
  console.log(`releases.json: ${releases.length} versions (${releases.map((r) => r.version).join(", ")})`);
}

buildReleases();
