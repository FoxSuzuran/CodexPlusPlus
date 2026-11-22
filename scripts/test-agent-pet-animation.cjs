const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { chromium } = require("playwright");

const root = resolve(__dirname, "..");
const read = (file) => readFileSync(resolve(root, file), "utf8");
const whaleDir = "assets/inject/upstream/whale-widget";
const petDir = "assets/extensions/agent-pet";
const image = "data:image/png;base64," + readFileSync(resolve(root, whaleDir, "DSniang1.png")).toString("base64");
const engineArgs = "window,document,fetch,localStorage,setTimeout,clearTimeout,setInterval,clearInterval,requestAnimationFrame,cancelAnimationFrame,MutationObserver,ResizeObserver,AudioContext,webkitAudioContext,Image,Audio";

async function verify() {
  const browser = await chromium.launch({ channel: process.env.CODEX_TEST_BROWSER || "msedge", headless: true });
  const page = await browser.newPage({ viewport: { width: 1000, height: 720 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => route.request().url() === "https://fixture.invalid/"
    ? route.fulfill({ contentType: "text/html", body: '<div id="root"><textarea></textarea></div>' })
    : route.abort());
  try {
    await page.goto("https://fixture.invalid/");
    await page.addScriptTag({ content: `
      (() => {
        ${read(petDir + "/pet.js")}
        ${read(petDir + "/whale-compat.js")}
        function codexPlusWhaleEngine(${engineArgs}) {
          ${read(whaleDir + "/full-widget-codex.js")}
        }
        const image = ${JSON.stringify(image)};
        const simplePet = createCodexPlusAgentPet({
          config: { kind: "image", enabled: true, size: 90, soundEnabled: false },
          call: async () => ({ status: "ok", image }),
          asset: () => "",
        });
        codexPlusWhaleMedia.assets["DSniang1.png"] = image;
        const whale = createCodexPlusWhaleFullRuntime({
          call: async (_path, request) => ({
            status: 200,
            body: request?.path === "/dsh-whale/size.json"
              ? { scale: 1, sound: false, bubbleOn: false, codexStatsOn: false, hasSavedConfig: true }
              : { ok: true, config: {}, models: [], roles: [], group: [], fragments: [] },
          }),
          session: () => ({}),
          on: () => () => {},
        });
        window.petFixture = {
          simplePet,
          whale,
          startWhale: async () => {
            await whale.initialize();
            codexPlusWhaleEngine(...whale.environment);
            if (!whale.state.controls) throw new Error(whale.state.initializationError || "Whale failed to mount");
          },
        };
        simplePet.sync();
      })();
    ` });

    const exercise = async (bodySelector, inputSelector) => {
      const target = page.locator(inputSelector);
      await target.waitFor({ state: "visible" });
      for (const gap of [20, 35, 50, 80]) {
        const pressed = await target.evaluate((node, bodySelector) => {
          const body = document.querySelector(bodySelector);
          const { x, y, width, height } = node.getBoundingClientRect();
          const send = (type, buttons) => node.dispatchEvent(new PointerEvent(type, {
            bubbles: true, cancelable: true, pointerId: 1, pointerType: "mouse",
            clientX: x + width / 2, clientY: y + height / 2, buttons,
          }));
          send("pointerdown", 1);
          const wasSquashed = body.style.transform.includes("0.88");
          send("pointerup", 0);
          // Force a sample so a same-task down/up has to expose a rebound to the compositor.
          const scale = new DOMMatrix(getComputedStyle(body).transform).d;
          return { wasSquashed, scale, running: body.getAnimations().length > 0 };
        }, bodySelector);
        assert.equal(pressed.wasSquashed, true, inputSelector);
        assert.ok(pressed.running && pressed.scale < 1, JSON.stringify(pressed));
        await page.waitForTimeout(gap);
      }
      await page.waitForFunction((selector) => {
        const body = document.querySelector(selector);
        return body.getAnimations().length === 0 && Math.abs(new DOMMatrix(getComputedStyle(body).transform).d - 1) < 0.001;
      }, bodySelector);
    };

    await exercise('[role="img"][data-codex-plus-ext="agent-pet"] > div', '[role="img"][data-codex-plus-ext="agent-pet"]');
    await page.evaluate(() => { window.petFixture.simplePet.dispose(); return window.petFixture.startWhale(); });
    await exercise(".dshwv-body", ".dshwv-img");
    const version = await page.evaluate(async () => {
      const whale = window.petFixture.whale;
      const about = await (await whale.fetch("/dsh-whale/about.json")).json();
      whale.dispose();
      return about.plugin.version;
    });
    assert.equal(version, "0.4.2");
    assert.equal(await page.locator(".dshwv-root").count(), 0);
    assert.deepEqual(errors, []);
    console.log("图片桌宠和大肥鱼各验证了 4 种快速连点间隔，松手回弹并恢复原比例。");
  } finally {
    await browser.close();
  }
}

verify().catch((error) => { console.error(error); process.exitCode = 1; });
