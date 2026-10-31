const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { createRequire } = require("node:module");
const { chromium } = require("playwright");

const root = path.resolve(__dirname, "..");
const app = path.join(root, "apps/codex-plus-manager");
const requireApp = createRequire(path.join(app, "package.json"));
const { buildSync } = requireApp("esbuild");
const { parse } = requireApp("@babel/parser");
const source = fs.readFileSync(path.join(app, "src/App.tsx"), "utf8");
const ast = parse(source, { sourceType: "module", plugins: ["typescript", "jsx"] });
const functions = ["useModalFocus", "SessionIndexCleanupDialog", "McpJsonImporter", "Toolbar", "Field", "isSuccessStatus"].map(name => {
  const node = ast.program.body.find(node => node.type === "FunctionDeclaration" && node.id.name === name);
  assert.ok(node, name);
  return source.slice(node.start, node.end);
}).join("\n");
const js = buildSync({
  stdin: { contents: `
    import React, {useEffect,useRef,useState} from "react";
    import {createRoot} from "react-dom/client";
    import {Download,Trash2} from "lucide-react";
    import {Button} from "./src/components/ui/button";
    import {Label} from "./src/components/ui/label";
    import {Textarea} from "./src/components/ui/textarea";
    import {McpPage} from "./src/ManagementPages";
    import {SkillsPage} from "./src/ManagementExtra";
    const t=x=>x,tf=(text,args)=>text.replace(/\\{(\\d+)\\}/g,(_,i)=>args[i]);
    ${functions}
    function Harness() {
      const [mode,setMode]=useState(""),[dialog,setDialog]=useState(false);
      window.testSetMode=setMode;
      const entries=Array.from({length:20},(_,i)=>({kind:"mcp",id:"server-"+i,title:"Server "+i,tomlBody:'command = "test"',enabled:true}));
      const onImport=async json=>{window.testImported=json;return false};
      return <><div data-topbar-actions/><button id="modal-opener" onClick={()=>setDialog(true)}>Open cleanup</button><button id="outside">Outside</button>
        {mode==="mcp"&&<div className="screen management-screen" style={{height:"100vh"}}><McpPage entries={entries} onSave={async()=>false} onDelete={async()=>false} onRefresh={async()=>{}} onImport={onImport} notify={async()=>{}}/></div>}
        {mode==="legacy-import"&&<McpJsonImporter actions={{previewMcpServersJson:json=>window.__TAURI_INTERNALS__.invoke("preview_mcp_servers_json",{json})}} onCancel={()=>setMode("")} onImport={onImport}/>}
        {mode==="skills"&&<div className="screen management-screen" style={{height:"100vh"}}><SkillsPage notify={async(...args)=>{window.testNotice=args}}/></div>}
        {dialog&&<SessionIndexCleanupDialog request={{candidates:[{id:"fixture-thread",threadName:"Fixture",updatedAt:"2026-10-17"}]}} onConfirm={ids=>{window.testCleaned=ids;setDialog(false)}} onCancel={()=>setDialog(false)}/>}
      </>;
    }
    createRoot(document.getElementById("root")).render(<Harness/>);
  `, resolveDir: app, loader: "tsx" },
  bundle: true, write: false, format: "iife", jsx: "automatic",
  alias: { "@": path.join(app, "src") }, loader: { ".css": "empty", ".svg": "dataurl" },
  define: { "process.env.NODE_ENV": '"production"', "import.meta.url": '"https://fixture.invalid/manager.js"' },
}).outputFiles[0].text;
const cssName = fs.readdirSync(path.join(app, "dist/assets")).find(name => /^index-.*\.css$/.test(name));
const css = fs.readFileSync(path.join(app, "dist/assets", cssName), "utf8")
  + fs.readFileSync(path.join(app, "src/ManagementPages.css"), "utf8");

async function main() {
  const browser = await chromium.launch({ channel: process.env.CODEX_TEST_BROWSER || "msedge",
    executablePath: process.env.CODEX_TEST_BROWSER_PATH, headless: true });
  const results = [];
  const record = (name, data) => { results.push({ name, ...data }); console.log(`PASS ${name}: ${JSON.stringify(data)}`); };
  try {
    const page = await browser.newPage({ viewport: { width: 1180, height: 820 } });
    await page.route("https://fixture.invalid/**", route => route.fulfill({ contentType: "text/html", body: "<div></div>" }));
    await page.goto("https://fixture.invalid/");
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    const load = async mode => {
      await page.setContent(`<style>${css}</style><style>
        html,body,#root{height:100%;margin:0}
        #modal-opener,#outside{position:fixed;left:0;top:0;z-index:2}#outside{left:150px}
      </style><div id="root"></div>`);
      await page.evaluate(() => {
        window.testPreviewRequests = [];
        window.testNotice = null;
        window.testImported = null;
        window.testSaveMode = "failed";
        window.__TAURI_INTERNALS__ = { invoke: async (command, args) => {
          if (command === "preview_mcp_servers_json") return await new Promise((resolve, reject) => {
            window.testPreviewRequests.push({ json: args.json, resolve, reject });
          });
          const payload = { status: "ok", message: "", skills: [], repoErrors: [], repos: [], repositorySkills: [], repoCounts: {} };
          if (command === "list_installed_skills" || command === "refresh_skill_catalog") return payload;
          if (command === "upsert_skill_repo") {
            if (window.testSaveMode === "reject") throw new Error("write failed");
            return { ...payload, status: window.testSaveMode, message: "fixture save" };
          }
          throw new Error(`Unexpected stub command ${command}`);
        } };
      });
      await page.addScriptTag({ content: js });
      await page.waitForFunction(() => typeof window.testSetMode === "function");
      if (mode) await page.evaluate(mode => window.testSetMode(mode), mode);
    };

    for (const mode of ["mcp", "legacy-import"]) {
      await load(mode);
      if (mode === "mcp") {
        await page.locator("[data-topbar-actions]").getByRole("button", { name: "更多操作", exact: true }).click();
        await page.getByRole("menuitem", { name: "导入 JSON", exact: true }).click();
      }
      const textarea = page.getByRole("textbox", { name: "MCP 配置 JSON", exact: true });
      const confirm = page.getByRole("button", { name: "确认导入", exact: true });
      await textarea.fill('{"mcpServers":{"preview-A":{"command":"A"}}}');
      await page.getByRole("button", { name: "预览", exact: true }).click();
      await page.waitForFunction(() => window.testPreviewRequests.length === 1);
      await textarea.fill('{"mcpServers":{"preview-B":{"command":"B"}}}');
      await page.getByRole("button", { name: "预览", exact: true }).click();
      await page.waitForFunction(() => window.testPreviewRequests.length === 2);
      await page.evaluate(() => window.testPreviewRequests[0].resolve({ status: "ok", entries: [{ id: "preview-A" }], warnings: [] }));
      assert.equal(await confirm.isDisabled(), true);
      assert.equal(await page.getByText("将导入：preview-A", { exact: true }).count(), 0);
      await page.evaluate(() => window.testPreviewRequests[1].resolve({ status: "ok", entries: [{ id: "preview-B" }], warnings: [] }));
      await page.waitForFunction(() => [...document.querySelectorAll("button")].some(button => button.textContent === "确认导入" && !button.disabled));
      await confirm.click();
      assert.match(await page.evaluate(() => window.testImported), /preview-B/);
      await textarea.fill('{"mcpServers":{"preview-C":{"command":"C"}}}');
      assert.equal(await confirm.isDisabled(), true);
      await page.getByRole("button", { name: "预览", exact: true }).click();
      await page.waitForFunction(() => window.testPreviewRequests.length === 3);
      await textarea.fill('{"mcpServers":{"preview-D":{"command":"D"}}}');
      await page.evaluate(() => window.testPreviewRequests[2].resolve({ status: "failed", message: "stale failure", entries: [], warnings: [] }));
      assert.equal(await confirm.isDisabled(), true);
      assert.equal(await page.getByText("stale failure", { exact: true }).count(), 0);
      record(`${mode} preview version`, { oldResponseIgnored: true, importedCurrentInput: true, editingInvalidatesPreview: true });
    }

    await load("skills");
    await page.getByRole("button", { name: "管理仓库", exact: true }).click();
    const repository = page.getByRole("dialog", { name: "管理 Skills 仓库", exact: true });
    await repository.getByRole("button", { name: "添加仓库", exact: true }).click();
    const editor = repository.getByRole("region", { name: "添加仓库", exact: true });
    const owner = editor.getByRole("textbox", { name: "所有者", exact: true });
    await owner.fill("fixture-owner");
    await editor.getByRole("textbox", { name: "仓库名", exact: true }).fill("fixture-repo");
    for (const mode of ["failed", "reject"]) {
      await page.evaluate(mode => { window.testSaveMode = mode; window.testNotice = null; }, mode);
      await editor.getByRole("button", { name: "添加仓库", exact: true }).click();
      await page.waitForFunction(() => window.testNotice?.[2] === "failed");
      assert.equal(await editor.count(), 1);
      assert.equal(await owner.inputValue(), "fixture-owner");
    }
    await page.evaluate(() => { window.testSaveMode = "ok"; });
    await editor.getByRole("button", { name: "添加仓库", exact: true }).click();
    await editor.waitFor({ state: "detached" });
    record("repository draft", { businessFailureRetained: true, rejectedWriteRetained: true, successClosesEditor: true });

    await load("mcp");
    const trigger = page.getByRole("button", { name: "更多操作", exact: true }).last();
    await trigger.scrollIntoViewIfNeeded();
    await trigger.click();
    const menu = page.getByRole("menu");
    const geometry = await menu.evaluate(menu => {
      const bounds = menu.getBoundingClientRect(), item = menu.querySelectorAll("button")[1], button = item.getBoundingClientRect();
      return { portaled: menu.parentElement === document.body, visible: bounds.top >= 0 && bounds.bottom <= innerHeight,
        deleteHit: item.contains(document.elementFromPoint(button.x + button.width / 2, button.y + button.height / 2)) };
    });
    assert.deepEqual(geometry, { portaled: true, visible: true, deleteHit: true });
    await page.waitForFunction(() => document.activeElement.textContent === "复制配置");
    await page.keyboard.press("Tab");
    assert.equal(await page.evaluate(() => document.activeElement.textContent), "删除");
    await page.keyboard.press("Escape");
    await menu.waitFor({ state: "detached" });
    assert.equal(await trigger.evaluate(node => node === document.activeElement), true);
    await trigger.click();
    await page.locator(".mg-matrix").evaluate(node => { node.scrollTop = 0; });
    await page.waitForFunction(() => {
      const menu = document.querySelector(".mg-menu");
      if (!menu) return true;
      const row = document.querySelector(".mg-matrix-row:last-child"), trigger = row.querySelector(".mg-menu-wrap").getBoundingClientRect();
      const bounds = menu.getBoundingClientRect();
      return Math.abs(bounds.top - trigger.top) > 100;
    });
    await page.locator("#outside").click();
    await menu.waitFor({ state: "detached" });
    record("MCP row menu", { ...geometry, keyboardItemsReachable: true, escapeRestoresFocus: true, scrollHandled: true, outsideCloses: true });

    await load("");
    await page.locator("#modal-opener").click();
    const dialog = page.getByRole("dialog", { name: "清理幽灵任务索引", exact: true });
    await dialog.waitFor();
    assert.equal(await page.evaluate(() => document.activeElement.textContent), "取消");
    await page.keyboard.press("Tab");
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute("aria-label")), "关闭窗口");
    await page.keyboard.press("Shift+Tab");
    assert.equal(await page.evaluate(() => document.activeElement.textContent), "取消");
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "detached" });
    assert.equal(await page.evaluate(() => document.activeElement.id), "modal-opener");
    await page.locator("#modal-opener").click();
    await dialog.getByRole("checkbox", { name: "选择全部候选记录", exact: true }).check();
    await dialog.getByRole("button", { name: "确认清理 1 条", exact: true }).click();
    assert.deepEqual(await page.evaluate(() => window.testCleaned), ["fixture-thread"]);
    record("session index cleanup modal", { cancelFocused: true, tabTrapped: true, escapeRestoresOpener: true, selectedActionPreserved: true });
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(root, "target/temp/management-ui-browser-results.json"),
      JSON.stringify({ browser: "msedge headless", viewport: { width: 1180, height: 820 }, results, pageErrors: errors }, null, 2) + "\n");
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
