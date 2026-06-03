// Drives the exported web build in a headless browser and saves screenshots so
// the web UI can actually be reviewed. Onboards (PIN 1234), imports a tiny
// image + a "video" (video/mp4 mime), opens a note, opens the media preview.
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { mkdirSync, readFileSync } from "node:fs";

const BASE = process.env.BASE || "http://localhost:4599";
const OUT = fileURLToPath(new URL("../shots/", import.meta.url));
const SAMPLE_MP4 = readFileSync(fileURLToPath(new URL("./fixtures/sample.mp4", import.meta.url)));
mkdirSync(OUT, { recursive: true });

// a 2x2 red PNG
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGP8z8Dwn4EIwDiqEAARWAIBzNpqsQAAAABJRU5ErkJggg==",
  "base64"
);

const shot = async (page, name) => {
  await page.screenshot({ path: OUT + name + ".png" });
  console.log("shot:", name);
};

async function pin(page, p) {
  for (const d of p) {
    await page.click(`[data-testid="pinkey-${d}"]`, { timeout: 12000 });
    await page.waitForTimeout(150);
  }
}

// Full chromium (new headless), not chromium_headless_shell: the stripped shell
// can't complete ffmpeg.wasm's wasm-in-worker init, which the trim step needs.
const browser = await chromium.launch({ channel: "chromium" });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 860 } })).newPage();
page.on("console", (m) => console.log("PAGE:", m.type(), m.text().slice(0, 200)));
page.on("pageerror", (e) => console.log("PAGEERR:", e.message));

try {
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(3000);
  await shot(page, "01-boot");

  // onboarding: set + confirm PIN
  await page.waitForSelector('[data-testid="pinkey-1"]', { timeout: 12000 });
  await pin(page, "1234");
  await page.waitForTimeout(500);
  await pin(page, "1234");
  await page.waitForTimeout(2000);
  await shot(page, "02-library-empty");

  // import: image + a real (tiny) video, via the file chooser
  page.on("filechooser", async (fc) => {
    await fc.setFiles([
      { name: "photo.png", mimeType: "image/png", buffer: PNG },
      { name: "sample.mp4", mimeType: "video/mp4", buffer: SAMPLE_MP4 }, // real 3s mp4 so the trimmer can decode/cut it
    ]);
  });
  await page.click('[data-testid="fab-add"]', { timeout: 8000 });
  await page.waitForTimeout(600);
  await shot(page, "03-add-menu");
  await page.getByText("Photos / videos").click();
  await page.waitForTimeout(3000);
  await shot(page, "04-review"); // pre-upload review screen

  // --- trim the video before saving ---
  try {
    await page.getByText("Trim", { exact: true }).first().click({ timeout: 8000 });
    await page.waitForTimeout(2500); // let the clip load + report its duration
    // move the playhead to ~1.6s and mark it as the end, cutting the 3s clip down
    await page.evaluate(() => {
      const v = document.querySelector("video");
      if (v) v.currentTime = 1.6;
    });
    await page.waitForTimeout(900);
    await page.getByText("Set end", { exact: true }).click();
    await page.waitForTimeout(400);
    await shot(page, "04b-trim"); // trimmer UI with a selected range
    await page.getByText("Done", { exact: true }).click();
    // ffmpeg.wasm core is fetched from the CDN on first use — wait for the
    // trimmer to close (its "Set end" control is unique to that modal).
    await page.getByText("Set end", { exact: true }).waitFor({ state: "detached", timeout: 90000 });
    await page.waitForTimeout(500);
    await shot(page, "04c-trimmed"); // back on review, video size now reflects the cut
  } catch (e) {
    console.log("TRIM-STEP:", e.message);
    await shot(page, "04z-trim-failed");
    // make sure we're back on the review screen before saving
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(500);
  }

  await page.getByText("Save", { exact: true }).click();
  await page.waitForTimeout(2000);
  await shot(page, "05-home-tiles"); // home: category tiles

  // open the Videos category (focused fullscreen view)
  await page.getByText("Videos", { exact: false }).first().click();
  await page.waitForTimeout(1000);
  await shot(page, "06-videos-section");
  // back to home
  await page.click('[data-testid="nav-back"]', { timeout: 8000 });
  await page.waitForTimeout(700);

  // open All -> open the image preview
  await page.getByText("All", { exact: true }).first().click();
  await page.waitForTimeout(800);
  await page.getByText("photo.png", { exact: false }).first().click();
  await page.waitForTimeout(1500);
  await shot(page, "07-preview");
  await page.mouse.click(28, 58); // close the media preview overlay

  // back to home, then make a note and view it via the Notes tile
  await page.click('[data-testid="nav-back"]', { timeout: 8000 });
  await page.waitForTimeout(500);
  await page.click('[data-testid="fab-add"]');
  await page.waitForTimeout(400);
  await page.getByText("New note").click();
  await page.waitForTimeout(700);
  await page.getByPlaceholder("Title").fill("Shopping list");
  await page.getByPlaceholder(/Start writing/).fill("- [ ] milk\n- [x] eggs\nGet bread too");
  await page.getByText("Save", { exact: true }).click();
  await page.waitForTimeout(1200);
  await page.getByText("Notes", { exact: false }).first().click();
  await page.waitForTimeout(800);
  await shot(page, "08-notes-section");
} catch (e) {
  console.log("ERROR:", e.message);
  await shot(page, "99-error");
} finally {
  await browser.close();
  console.log("done");
}
