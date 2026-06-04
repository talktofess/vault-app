import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";
const BASE = process.env.BASE || "http://localhost:4599";
const OUT = fileURLToPath(new URL("../shots/", import.meta.url));
mkdirSync(OUT, { recursive: true });
const shot = async (p, n) => { await p.screenshot({ path: OUT + n + ".png" }); console.log("shot:", n); };
async function pin(p, s) { for (const d of s) { await p.click(`[data-testid="pinkey-${d}"]`, { timeout: 12000 }); await p.waitForTimeout(120); } }
async function mv(p, from, to) {
  await p.click(`[data-testid="sq-${from}"]`); await p.waitForTimeout(150);
  await p.click(`[data-testid="sq-${to}"]`); await p.waitForTimeout(200);
}
const SEQ = [["e2","e4"],["e7","e5"],["g1","f3"]]; // 3-move secret
const b = await chromium.launch({ channel: "chromium" });
const p = await (await b.newContext({ viewport: { width: 1280, height: 860 } })).newPage();
p.on("pageerror", (e) => console.log("PAGEERR:", e.message));
try {
  await p.goto(BASE, { waitUntil: "load" }); await p.waitForTimeout(3000);
  await p.waitForSelector('[data-testid="pinkey-1"]', { timeout: 12000 });
  await pin(p, "1234"); await p.waitForTimeout(500); await pin(p, "1234"); await p.waitForTimeout(2500);
  // Settings -> Set up chess unlock
  await p.getByText("Settings", { exact: true }).first().click(); await p.waitForTimeout(800);
  await p.getByText("Set up chess unlock").click(); await p.waitForTimeout(800);
  await shot(p, "c1-setup-pin");
  await pin(p, "1234"); await p.waitForTimeout(800); // -> record step
  await shot(p, "c2-record");
  for (const [f, t] of SEQ) await mv(p, f, t);
  await shot(p, "c3-recorded");
  await p.getByText(/Use these/).click(); await p.waitForTimeout(600); // -> confirm
  for (const [f, t] of SEQ) await mv(p, f, t); // auto-finishes
  await p.waitForTimeout(1200);
  await shot(p, "c4-set-alert");
  await p.getByText("OK", { exact: true }).click().catch(() => {}); await p.waitForTimeout(800);
  // lock: reload -> disguise
  await p.goto(BASE, { waitUntil: "load" }); await p.waitForTimeout(2500);
  await shot(p, "c5-disguise");
  // play the secret moves to unlock
  for (const [f, t] of SEQ) await mv(p, f, t);
  await p.waitForTimeout(2500);
  await shot(p, "c6-after-unlock");
} catch (e) { console.log("ERROR:", e.message); await shot(p, "c9-error"); }
finally { await b.close(); console.log("done"); }
