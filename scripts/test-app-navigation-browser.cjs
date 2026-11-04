const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const root = path.resolve(__dirname, "..");
const preview = path.join(root, "site/manager-preview");
const version = require("../apps/codex-plus-manager/package.json").version;
const contentTypes = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".woff2": "font/woff2" };

async function main() {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const cases = [], pageErrors = [];
  try {
    let page;
    for (const value of [null, "0", "garbage", "1"]) {
      if (page) await page.close();
      page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      page.on("pageerror", error => pageErrors.push(error.message));
      await page.route("**/*", route => {
        const url = new URL(route.request().url());
        if (url.origin !== "https://fixture.invalid") return route.abort();
        const file = path.resolve(preview, `.${url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname)}`);
        assert.ok(file.startsWith(preview + path.sep));
        return route.fulfill({ contentType: contentTypes[path.extname(file)] || "application/octet-stream", body: fs.readFileSync(file) });
      });
      await page.addInitScript(value => {
        localStorage.clear();
        localStorage.setItem("codex-plus-lang", "zh");
        if (value !== null) localStorage.setItem("codex-plus-plus.onboarding", value);
      }, value);
      await page.goto("https://fixture.invalid/");
      await page.locator(".shell .workspace").waitFor();
      await page.locator(".side .cx-side-version").filter({ hasText: version }).waitFor();
      assert.equal(await page.locator(".tour-root, .onboarding-setup, .sponsor-block, .home-sponsors").count(), 0);
      cases.push(`startup onboarding=${JSON.stringify(value)} stays closed`);
    }
    for (const key of ["home", "extensions", "customize", "sessions", "hub", "providers", "gateway", "routing", "usage"]) {
      const entry = page.locator(`.side [data-nav="${key}"]`);
      await entry.click();
      await page.waitForFunction(key => document.querySelector(`.side [data-nav="${key}"]`)?.getAttribute("aria-current") === "page", key);
      cases.push(`navigation ${key}`);
    }
    await page.locator(".side").getByRole("button", { name: "设置", exact: true }).click();
    await page.getByRole("button", { name: "重新打开引导", exact: true }).click();
    await page.locator(".tour-root").waitFor();
    await page.keyboard.press("Escape");
    await page.locator(".tour-root").waitFor({ state: "detached" });
    cases.push("manual settings entry opens the tour; Escape closes it");
    await page.getByRole("button", { name: "重新打开引导", exact: true }).click();
    await page.locator(".tour-root").waitFor();
    await page.reload();
    await page.locator(".shell .workspace").waitFor();
    assert.equal(await page.locator(".tour-root, .onboarding-setup").count(), 0);
    cases.push("window reload after manual tour starts closed");
    assert.deepEqual(pageErrors, []);
    const result = { fixtureOnly: true, backend: "web-preview shims", browser: browser.version(), cases, pageErrors };
    fs.writeFileSync(path.join(root, "target/temp/v220-app-navigation-browser-result.json"), JSON.stringify(result, null, 2) + "\n");
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
