import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../../../assets/inject/renderer-inject/zz-paste-fix.js", import.meta.url), "utf8");

function fixture(enabled = true) {
  const handlers: ((event: unknown) => void)[] = [];
  const writes: unknown[][] = [];
  const context = vm.createContext({
    window: { __CODEX_PLUS_PASTE_FIX__: { enabled } },
    document: {
      addEventListener(type: string, handler: (event: unknown) => void) {
        assert.equal(type, "paste");
        handlers.push(handler);
      },
      execCommand(...args: unknown[]) { writes.push(args); return true; },
    },
    console: { log() {}, warn() {} },
  });
  vm.runInContext(source, context);
  vm.runInContext(source, context);
  return {
    handlers, writes,
    paste(clipboardData: unknown) {
      let prevented = false, stopped = false;
      handlers[0]?.({
        clipboardData,
        preventDefault() { prevented = true; },
        stopImmediatePropagation() { stopped = true; },
      });
      return { prevented, stopped };
    },
  };
}

test("Word text remains plain text and repeated injection installs one paste handler", () => {
  const f = fixture();
  assert.equal(f.handlers.length, 1);
  const result = f.paste({ items: [{ kind: "string", type: "text/html" }], getData: () => "Word text" });
  assert.deepEqual(result, { prevented: true, stopped: true });
  assert.deepEqual(f.writes, [["insertText", false, "Word text"]]);
});

for (const [name, data] of [
  ["image item with a filename", { items: [{ kind: "file", type: "image/png" }] }],
  ["file item before its File object is available", { items: [{ kind: "file", type: "application/pdf" }], files: [] }],
  ["file list without clipboard items", { files: [{}] }],
] as const) {
  test(`${name} retains native paste even with plain text`, () => {
    const f = fixture();
    const result = f.paste({ ...data, getData: () => "image.png" });
    assert.deepEqual(result, { prevented: false, stopped: false });
    assert.deepEqual(f.writes, []);
  });
}

test("empty and long text retain native paste", () => {
  const f = fixture();
  for (const text of ["", "x".repeat(20001)]) {
    assert.deepEqual(f.paste({ getData: () => text }), { prevented: false, stopped: false });
  }
  assert.deepEqual(f.writes, []);
});

test("disabled paste fix installs no handler", () => {
  assert.equal(fixture(false).handlers.length, 0);
});
