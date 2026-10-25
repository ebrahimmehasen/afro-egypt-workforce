// Logs in as the admin and visits pages of the running app (http://localhost:3100 by default), printing each
// page's HTTP status and <h1>, plus any console / page errors, and saving a screenshot of each.
// Usage: node .claude/skills/run-app/drive.cjs [/path ...]    (env: BASE_URL, OUT_DIR, EMAIL, PASSWORD)
const { chromium } = require("playwright");
const fs = require("node:fs");

const BASE = process.env.BASE_URL || "http://localhost:3100";
const OUT = process.env.OUT_DIR || "/tmp/run-app-shots";
const EMAIL = process.env.EMAIL || "admin@404legends.demo";
const PASSWORD = process.env.PASSWORD || "demo123";
const DEFAULT_PAGES = ["/dashboard", "/employees", "/attendance", "/overtime", "/deductions", "/payroll", "/departments", "/reports", "/settings"];
const pages = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_PAGES;

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1366, height: 860 } })).newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

  await page.goto(`${BASE}/login`);
  await page.fill("input[type=email], input[name=email]", EMAIL);
  await page.fill("input[type=password]", PASSWORD);
  await Promise.all([page.waitForURL("**/dashboard"), page.click("button[type=submit]")]);

  let n = 1;
  let failed = false;
  for (const path of pages) {
    const res = await page.goto(BASE + path);
    // not "networkidle": the SSE stream at /api/events never closes
    await page.waitForSelector("h1", { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(2500); // charts animate in
    const h1 = await page.locator("h1").first().innerText().catch(() => "(no h1)");
    const status = res ? res.status() : 0;
    if (status !== 200) failed = true;
    console.log(`${String(n).padStart(2, "0")} ${path.padEnd(22)} HTTP ${status} | h1: ${h1.trim()}`);
    // Not `fullPage: true`: that resizes the page for the shot, and Recharts re-animates its lines from empty.
    // Grow the viewport to the page's height, let the charts finish, then take a normal screenshot.
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    await page.setViewportSize({ width: 1366, height: Math.min(height, 8000) });
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${OUT}/${String(n).padStart(2, "0")}-${path.replace(/\W+/g, "_")}.png` });
    await page.setViewportSize({ width: 1366, height: 860 });
    n++;
  }
  console.log("errors:", JSON.stringify(errors));
  console.log("screenshots:", OUT);
  await browser.close();
  process.exit(failed || errors.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
