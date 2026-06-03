// Drives the exported web build in a headless browser and saves screenshots so
// the web UI can actually be reviewed. Onboards (PIN 1234), imports a tiny
// image + a "video" (video/mp4 mime), opens a note, opens the media preview.
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE || "http://localhost:4599";
const OUT = fileURLToPath(new URL("../shots/", import.meta.url));
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

const browser = await chromium.launch();
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

  // import: image + "video", via the file chooser
  page.on("filechooser", async (fc) => {
    await fc.setFiles([
      { name: "photo.png", mimeType: "image/png", buffer: PNG },
      { name: "clip.mp4", mimeType: "video/mp4", buffer: Buffer.from([0, 0, 0, 24, 102, 116, 121, 112]) },
    ]);
  });
  await page.click('[data-testid="fab-add"]', { timeout: 8000 });
  await page.waitForTimeout(600);
  await shot(page, "03-add-menu");
  await page.getByText("Photos / videos").click();
  await page.waitForTimeout(3000);
  await shot(page, "04-review"); // pre-upload review screen
  await page.getByText("Save", { exact: true }).click();
  await page.waitForTimeout(2000);
  await shot(page, "05-after-save"); // library with the saved items

  // open the image (preview layout)
  await page.getByText("photo.png", { exact: false }).first().click();
  await page.waitForTimeout(1500);
  await shot(page, "06-preview");
  await page.mouse.click(28, 58); // close (X top-left)
  await page.waitForTimeout(800);

  // create a note, then see it in the list (title + body snippet)
  await page.click('[data-testid="fab-add"]');
  await page.waitForTimeout(400);
  await page.getByText("New note").click();
  await page.waitForTimeout(700);
  await page.getByPlaceholder("Title").fill("Shopping list");
  await page.getByPlaceholder(/Start writing/).fill("- [ ] milk\n- [x] eggs\nGet bread too");
  await page.waitForTimeout(300);
  await page.getByText("Save", { exact: true }).click();
  await page.waitForTimeout(1200);
  await shot(page, "07-note-in-list");
} catch (e) {
  console.log("ERROR:", e.message);
  await shot(page, "99-error");
} finally {
  await browser.close();
  console.log("done");
}
