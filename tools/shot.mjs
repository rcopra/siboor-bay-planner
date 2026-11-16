// Screenshot the running planner with the system Chrome and print console errors.
// node tools/shot.mjs <url> <out.png> [js to run before the shot]
import { chromium } from "playwright-core";
const [url, out, script] = process.argv.slice(2);
const browser = await chromium.launch({ channel: "chrome", args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
page.on("console", m => { if (m.type() === "error" || m.type() === "warning") console.log(`[${m.type()}]`, m.text()); });
page.on("pageerror", e => console.log("[pageerror]", e.message));
await page.goto(url);
await page.waitForTimeout(1500);
if (script) { console.log("result:", JSON.stringify(await page.evaluate(script))); await page.waitForTimeout(2500); }
await page.screenshot({ path: out });
await browser.close();
