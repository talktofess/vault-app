// Vercel Edge function: fetch a remote URL server-side and STREAM it back to the
// page. The browser's same-origin policy (CORS) blocks the web app from fetching
// most hosts directly; this proxy sits on the app's own origin (/api/grab), so
// the page can read the bytes — then it encrypts them before storing. Vercel
// only ever pipes the bytes through; nothing is stored server-side.
//
// Security: http(s) only, with an SSRF guard blocking localhost / private /
// link-local hosts. NOTE: this is otherwise an open proxy on your domain — fine
// for personal use, but if abuse is a concern, gate it behind your Supabase JWT.
export const config = { runtime: "edge" };

const BLOCKED_HOST =
  /^(localhost|0\.0\.0\.0|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?|.*\.local|.*\.internal)$/i;

export default async function handler(req) {
  const target = new URL(req.url).searchParams.get("url");
  if (!target) return new Response("missing ?url", { status: 400 });

  let u;
  try {
    u = new URL(target);
  } catch {
    return new Response("invalid url", { status: 400 });
  }
  if (!/^https?:$/.test(u.protocol)) return new Response("only http(s) allowed", { status: 400 });
  if (BLOCKED_HOST.test(u.hostname)) return new Response("blocked host", { status: 403 });

  const range = req.headers.get("range");
  let upstream;
  try {
    upstream = await fetch(u.toString(), {
      method: "GET",
      redirect: "follow",
      headers: {
        ...(range ? { range } : {}),
        // Some media hosts require a UA / Accept to serve the file.
        "user-agent": "Mozilla/5.0 (compatible; VaultGrabber/1.0)",
        accept: "*/*",
      },
    });
  } catch (e) {
    return new Response("upstream fetch failed: " + (e && e.message ? e.message : e), { status: 502 });
  }

  const headers = new Headers();
  for (const h of ["content-type", "content-length", "content-range", "accept-ranges"]) {
    const v = upstream.headers.get(h);
    if (v) headers.set(h, v);
  }
  if (!headers.has("accept-ranges")) headers.set("accept-ranges", "bytes");
  headers.set("cache-control", "no-store");
  // Stream the body straight through (no buffering of the whole file).
  return new Response(upstream.body, { status: upstream.status, headers });
}
