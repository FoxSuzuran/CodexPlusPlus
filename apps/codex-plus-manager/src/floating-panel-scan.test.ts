import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const answer = readFileSync(new URL("../../../assets/inject/floating-panel/runtime/answer-context.js", import.meta.url), "utf8");
const lifecycle = readFileSync(new URL("../../../assets/inject/floating-panel/runtime/lifecycle.js", import.meta.url), "utf8");
function functions(source: string, names: string[]) {
  return names.map((name) => {
    const match = source.match(new RegExp(`^  function ${name}\\([^]*?^  \\}`, "m"));
    assert.ok(match, name);
    return match[0];
  }).join("\n");
}

test("conversation scanning parses only the latest mounted turn and retains a newer virtualized anchor", () => {
  const parsed: string[] = [];
  const turns = Array.from({ length: 100 }, (_, index) => ({
    getAttribute: () => String(index).padStart(4, "0"),
  })).reverse();
  const context = vm.createContext({
    chatRoot: () => ({ querySelectorAll: () => turns }),
    CONVERSATION_TURN_SELECTOR: "[data-content-search-turn-key]",
    normalizeText: (value: string) => value,
    conversationTurn: (turn: typeof turns[number]) => {
      const turnKey = turn.getAttribute();
      parsed.push(turnKey);
      return { turnKey, userText: "question", assistantMessage: { text: "latest answer" } };
    },
  });
  vm.runInContext(functions(answer, ["conversationTurns", "compareConversationTurnKeys", "latestConversationTurnByKey", "nextLatestTurnAnchor"]), context);
  const latest = vm.runInContext("conversationTurns()", context);
  assert.deepEqual(parsed, ["0099"]);
  const anchor = vm.runInContext("nextLatestTurnAnchor(null, conversationTurns(), 'session')", context);
  context.previous = anchor;
  context.older = [{ turnKey: "0001", assistantMessage: { text: "old answer" } }];
  assert.equal(vm.runInContext("nextLatestTurnAnchor(previous, older, 'session')", context), anchor);
  assert.equal(latest.length, 1);
  assert.equal(vm.runInContext("nextLatestTurnAnchor(previous, older, 'other-session').turnKey", context), "0001");
});

test("floating-panel observer ignores unrelated and extension changes, pauses when hidden and resumes once", () => {
  class Element {
    conversation: boolean;
    extension: boolean;
    constructor(conversation = false, extension = false) {
      this.conversation = conversation;
      this.extension = extension;
    }
    parentElement = null;
    closest(selector: string) {
      return selector === "[data-codex-plus-ext]" ? (this.extension ? this : null) : (this.conversation ? this : null);
    }
    querySelector() { return null; }
  }
  let callback!: (mutations: any[]) => void;
  let visibility!: () => void;
  let timers = 0;
  const state = { runtimeGeneration: 1, timer: 0, observer: null, root: null };
  const document = { hidden: false, body: {},
    addEventListener: (_: string, fn: () => void) => { visibility = fn; } };
  const context = vm.createContext({ state, document, Element, CONVERSATION_TURN_SELECTOR: "[turn]",
    SCAN_DELAY_MS: 220, isCurrentRuntime: () => true, scan: () => {},
    window: { clearTimeout: () => {}, setTimeout: () => ++timers },
    MutationObserver: class { constructor(fn: typeof callback) { callback = fn; } observe() {} },
  });
  vm.runInContext(functions(lifecycle, ["scheduleScan", "installObserver"]) + "\ninstallObserver();", context);
  const mutate = (target: Element, addedNodes: Element[] = [], type = "childList", removedNodes: Element[] = []) =>
    callback([{ target, addedNodes, removedNodes, type }]);
  mutate(new Element(), [new Element()]);
  mutate(new Element(true, true), [new Element(true)]);
  assert.equal(timers, 0);
  mutate(new Element(true), [], "characterData");
  mutate(new Element(), [], "childList", [new Element(true)]);
  assert.equal(timers, 2, "conversation removals also invalidate the current view");
  document.hidden = true;
  visibility();
  mutate(new Element(true), [new Element(true)]);
  vm.runInContext("scheduleScan(0)", context);
  assert.equal(timers, 2);
  assert.equal(state.timer, 0);
  document.hidden = false;
  visibility();
  assert.equal(timers, 3);
});
