// Capture the current UI in representative states for a design audit.
import { chromium } from "playwright";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("[err]", e.message));

await page.goto("http://localhost:5175?simple");
await page.waitForFunction(() => window.__sensen != null);
await page.click("button:has-text('2D Simple')");
await page.selectOption("select", "lv3");
await page.click("button:has-text('CPU と対戦')");
await wait(800);
await page.screenshot({ path: "/tmp/ui-audit-early.png" });

// Stack reservations: click up to 3 enabled hand cards quickly.
await page.evaluate(() => {
  const btns = [...document.querySelectorAll("button")].filter(
    (b) => !b.disabled && b.textContent.includes("閃") && b.querySelector("div"),
  );
  for (let i = 0; i < Math.min(3, btns.length); i++) btns[i].click();
});
await wait(400);
await page.screenshot({ path: "/tmp/ui-audit-reserved.png" });

// Let combat develop for a denser timeline (block/poison/labels).
await wait(6000);
await page.screenshot({ path: "/tmp/ui-audit-mid.png" });

await browser.close();
console.log("screenshots: /tmp/ui-audit-{early,reserved,mid}.png");
