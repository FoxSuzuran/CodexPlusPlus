const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {chromium} = require("playwright");
const source = fs.readFileSync(process.env.DAILY_SCRIPT ||
  path.join(process.env.APPDATA,"Codex++/user_scripts/market-codex-daily-token-usage.js"),"utf8");
const baseline = process.env.DAILY_EXPECT_BASELINE === "1";
const variants = {
  current: '<div class="codex-dialog" role="dialog" data-state="open"><div data-image-preview-toolbar></div></div>',
  legacy: '<div role="dialog"><div data-testid="image-preview-dismiss-area"></div><div data-controls></div></div>',
  backdrop: '<div class="codex-dialog-overlay _imageOverlay_fixture_2"><div data-controls></div></div>',
};
async function main() {
  const browser = await chromium.launch({channel:"msedge",headless:true});
  const results = [];
  try {
    for (const [width,height] of [[1920,1152],[1180,820]]) for (const zoom of [0.8,1,1.25]) {
      const page = await browser.newPage({viewport:{width,height}});
      const errors = [];
      page.on("pageerror",error=>errors.push(error.message));
      await page.route("**/*",route=>route.fulfill({contentType:"text/html",body:`<style>
        html,body{margin:0;width:100%;height:100%;font:14px Arial;background:#eefbef}
        body{zoom:${zoom}}
        header{position:fixed;top:0;left:0;right:0;height:40px}
        .codex-dialog,.codex-dialog-overlay,[role=dialog]{position:fixed;inset:0;z-index:50;background:#eefbef}
        [data-image-preview-toolbar],[data-controls]{position:absolute;top:0;right:132px;display:flex;height:40px}
        [data-image-preview-toolbar] button,[data-controls] button{width:62px;height:34px}
        [data-testid=image-preview-dismiss-area]{position:absolute;inset:40px 0}
      </style><header class="draggable"></header><main><img width="300" height="100" alt="inline attachment"></main>`}));
      await page.goto("https://fixture.invalid/");
      await page.addScriptTag({content:source});
      const root = page.locator("#codex-daily-token-usage");
      await root.waitFor({state:"visible"});
      const hit = id=>page.evaluate(id=>{
        const node=document.getElementById(id),r=node.getBoundingClientRect();
        return node.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));
      },id);
      for (const [name,html] of Object.entries(variants)) {
        await page.evaluate(html=>{
          const wrap=document.createElement("div");wrap.id="fixture-viewer";wrap.innerHTML=html;
          const controls=wrap.querySelector("[data-image-preview-toolbar],[data-controls]");
          controls.innerHTML='<button id="zoom">76%</button><button id="close">Close</button>';
          controls.querySelector("#close").onclick=()=>wrap.remove();
          document.body.append(wrap);
        },html);
        if (baseline) {
          await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
          const blocked=!(await hit("zoom")) || !(await hit("close"));
          results.push({width,height,zoom,variant:name,blocked,hidden:await root.evaluate(n=>n.hidden)});
          await page.evaluate(()=>document.getElementById("fixture-viewer").remove());
          continue;
        }
        await page.waitForFunction(()=>document.getElementById("codex-daily-token-usage").hidden);
        assert.equal(await root.isVisible(),false);
        assert.equal(await hit("zoom"),true);
        assert.equal(await hit("close"),true);
        const capture = await page.evaluate(name=>{
          const api=window.__codexDailyTokenUsage;
          api.__test.installStandaloneCapture();
          const before=api.getSnapshot().total;
          const payload={
            id:"preview-"+name,model:"fixture-model",conversation_id:"fixture",
            usage:{input_tokens:20,output_tokens:10,total_tokens:30},
          };
          window.dispatchEvent(new MessageEvent("message",{data:payload}));
          api.refresh();
          return {before,after:api.getSnapshot().total};
        },name);
        assert.equal(capture.after-capture.before,30,"preview must not stop usage capture");
        assert.equal(await root.isVisible(),false,"statistics refresh must not reveal Daily");
        await page.locator("#close").click();
        await root.waitFor({state:"visible"});
        assert.equal(await root.evaluate(n=>n.hidden),false);
        results.push({width,height,zoom,variant:name,nativeControlsClickable:true,dailyRestored:true});
      }
      if (!baseline) {
        await page.evaluate(()=>{
          const cached=document.createElement("div");cached.id="cached";
          cached.innerHTML='<div class="codex-dialog" role="dialog" data-state="closed"><div data-image-preview-toolbar></div></div>';
          document.body.append(cached);
        });
        await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
        assert.equal(await root.isVisible(),true,"closed cached dialogs cannot hide Daily");
        for (const attribute of ["hidden","inert","aria-hidden"]) {
          await page.evaluate(attribute=>{
            const cached=document.getElementById("cached");
            cached.setAttribute(attribute,attribute==="aria-hidden"?"true":"");
            cached.firstElementChild.setAttribute("data-state","open");
          },attribute);
          await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
          assert.equal(await root.isVisible(),true,attribute);
          await page.evaluate(attribute=>document.getElementById("cached").removeAttribute(attribute),attribute);
          await root.waitFor({state:"hidden"});
          await page.evaluate(attribute=>document.getElementById("cached").setAttribute(attribute,
            attribute==="aria-hidden"?"true":""),attribute);
          await root.waitFor({state:"visible"});
          await page.evaluate(attribute=>{
            const cached=document.getElementById("cached");
            cached.firstElementChild.setAttribute("data-state","closed");
            cached.removeAttribute(attribute);
          },attribute);
        }
        await page.evaluate(()=>document.getElementById("cached").remove());
        await root.locator("button").focus();
        await root.locator("button").press("Enter");
        await page.locator("#codex-daily-token-usage-panel").waitFor({state:"visible"});
        await page.evaluate(()=>{
          const viewer=document.createElement("div");viewer.id="preview-open-panel";viewer.className="codex-dialog";
          viewer.innerHTML="<div data-image-preview-toolbar></div>";document.body.append(viewer);
        });
        await root.waitFor({state:"hidden"});
        assert.equal(await page.locator("#codex-daily-token-usage-panel").evaluate(n=>n.classList.contains("is-visible")),false);
        await page.evaluate(()=>{
          document.getElementById("preview-open-panel").remove();
          window.__codexDailyTokenUsage.destroy();
        });
        assert.equal(await root.count(),0);
      }
      assert.deepEqual(errors,[]);
      await page.close();
    }
    if (baseline) assert.ok(results.some(r=>r.blocked),"baseline must reproduce a native-control collision");
    const file=path.join(__dirname,"../target/temp/daily-image-preview-"+(baseline?"baseline":"fixed")+".json");
    fs.writeFileSync(file,JSON.stringify({results,pageErrors:0},null,2)+"\n");
    console.log(JSON.stringify({cases:results.length,blocked:results.filter(r=>r.blocked).length,baseline,result:file}));
  } finally {await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
