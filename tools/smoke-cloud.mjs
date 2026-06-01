// Live smoke test of the cloud backend using the anon key — the same operations
// the app performs, but via raw REST/auth/storage HTTP (no supabase-js, which
// needs a WebSocket in Node). Signs up a throwaway user, exercises RLS table
// writes + Storage upload/download/Range, then cleans up the data. Reads .env.
//   node tools/smoke-cloud.mjs
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env", import.meta.url), "utf8")
    .split(/\r?\n/)
    .map((l) => /^([A-Z0-9_]+)=(.*)$/.exec(l.trim()))
    .filter(Boolean)
    .map((m) => [m[1], m[2]])
);
const URL_ = env.EXPO_PUBLIC_SUPABASE_URL;
const KEY = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
console.log("URL:", URL_);

const step = (n) => console.log("•", n);
async function must(label, res) {
  if (!res.ok) throw new Error(`${label} -> ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res;
}

const email = `vault-smoke-${Date.now()}@example.com`;
const password = "Smoke-test-12345!";
const authHdr = { apikey: KEY, "Content-Type": "application/json" };

// 1) AUTH — sign up, fall back to sign in.
let token, uid;
{
  const r = await fetch(`${URL_}/auth/v1/signup`, {
    method: "POST",
    headers: authHdr,
    body: JSON.stringify({ email, password }),
  });
  const j = await r.json();
  token = j.access_token;
  uid = j.user?.id ?? j.id;
  if (!token) {
    const r2 = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: authHdr,
      body: JSON.stringify({ email, password }),
    });
    const j2 = await r2.json();
    token = j2.access_token;
    uid = j2.user?.id;
    if (!token) {
      console.log("\nAUTH BLOCKED:", j2.error_description || j2.msg || j.msg || JSON.stringify(j2));
      console.log(
        "Fix in Dashboard -> Authentication -> Providers -> Email:\n" +
          "  - if 'signups disabled'   -> enable the Email provider\n" +
          "  - if 'Email not confirmed'-> turn OFF 'Confirm email' for testing"
      );
      process.exit(2);
    }
  }
}
step(`auth ok (uid ${uid.slice(0, 8)}…)`);

const bearer = { apikey: KEY, Authorization: `Bearer ${token}` };
const jsonBearer = { ...bearer, "Content-Type": "application/json" };
const path = `${uid}/${crypto.randomUUID()}.enc`;
const itemId = crypto.randomUUID();

try {
  // 2) vault_keys upsert + read
  await must(
    "vault_keys upsert",
    await fetch(`${URL_}/rest/v1/vault_keys`, {
      method: "POST",
      headers: { ...jsonBearer, Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify({ user_id: uid, kdf: { alg: "argon2id", m: 1, t: 1, p: 1, salt: "AA==" }, wrapped_dek: "smoke", dek_version: 1 }),
    })
  );
  const sel = await (await must("vault_keys read", await fetch(`${URL_}/rest/v1/vault_keys?select=wrapped_dek`, { headers: bearer }))).json();
  if (sel[0]?.wrapped_dek !== "smoke") throw new Error("vault_keys read-back mismatch");
  step("vault_keys upsert + read");

  // 3) items upsert
  await must(
    "items upsert",
    await fetch(`${URL_}/rest/v1/items`, {
      method: "POST",
      headers: { ...jsonBearer, Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify({ id: itemId, user_id: uid, enc_meta: "m", wrapped_fk: "f", byte_size: 8, storage_path: path }),
    })
  );
  step("items upsert");

  // 4) Storage upload / download / Range
  const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
  await must(
    "upload",
    await fetch(`${URL_}/storage/v1/object/vault/${path}`, {
      method: "POST",
      headers: { ...bearer, "Content-Type": "application/octet-stream", "x-upsert": "true" },
      body: bytes,
    })
  );
  const dl = await (await must("download", await fetch(`${URL_}/storage/v1/object/vault/${path}`, { headers: bearer }))).arrayBuffer();
  const got = new Uint8Array(dl);
  if (got.length !== 8 || got[0] !== 1 || got[7] !== 8) throw new Error("download mismatch");
  step("storage upload + download");

  const sign = await (
    await must("sign", await fetch(`${URL_}/storage/v1/object/sign/vault/${path}`, { method: "POST", headers: jsonBearer, body: JSON.stringify({ expiresIn: 60 }) }))
  ).json();
  const rr = await fetch(`${URL_}/storage/v1${sign.signedURL}`, { headers: { Range: "bytes=2-4" } });
  const rb = new Uint8Array(await rr.arrayBuffer());
  if (!(rr.status === 206 && rb.length === 3 && rb[0] === 3 && rb[2] === 5))
    throw new Error(`range read failed (status ${rr.status}, bytes ${[...rb]})`);
  step("storage Range read (206)");

  // cleanup
  await fetch(`${URL_}/storage/v1/object/vault/${path}`, { method: "DELETE", headers: bearer });
  await fetch(`${URL_}/rest/v1/items?id=eq.${itemId}`, { method: "DELETE", headers: bearer });
  await fetch(`${URL_}/rest/v1/vault_keys?user_id=eq.${uid}`, { method: "DELETE", headers: bearer });
  step("cleanup");

  console.log("\nRESULT: PASS — auth, RLS tables, Storage, and Range reads all work live.");
  console.log(`(Throwaway user ${email} remains; delete it in Authentication -> Users if you like.)`);
} catch (e) {
  console.log("\nRESULT: FAIL —", e.message);
  process.exitCode = 1;
}
