// Minimal static server for the exported web build (dist/), with SPA fallback
// to index.html. Used by the screenshot harness. PORT env optional.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const DIST = fileURLToPath(new URL("../dist/", import.meta.url));
const PORT = Number(process.env.PORT || 4599);
const TYPES = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".ttf": "font/ttf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".map": "application/json",
};

createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p === "/") p = "/index.html";
    let file = join(DIST, normalize(p).replace(/^(\.\.[/\\])+/, ""));
    try {
      const s = await stat(file);
      if (s.isDirectory()) file = join(file, "index.html");
    } catch {
      file = join(DIST, "index.html"); // SPA fallback
    }
    const data = await readFile(file).catch(() => readFile(join(DIST, "index.html")));
    res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
}).listen(PORT, () => console.log("serving dist on http://localhost:" + PORT));
