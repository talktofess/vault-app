// Applies every supabase/migrations/*.sql to the database in DB_URL, in order.
// Used because the CLI is logged into a different account than the target
// project; a direct connection string authenticates to Postgres regardless.
// Run:  DB_URL="postgresql://...?sslmode=require" node tools/apply-migration.mjs
import { readFileSync, readdirSync } from "node:fs";
import { Client } from "pg";

// Either a full DB_URL, or discrete PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE
// env vars (avoids URL-encoding passwords with special characters like '#').
const url = process.env.DB_URL;
const dir = new URL("../supabase/migrations/", import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

const client = new Client(
  url
    ? { connectionString: url, ssl: { rejectUnauthorized: false } }
    : { ssl: { rejectUnauthorized: false } } // pg reads PG* env vars
);

try {
  await client.connect();
  for (const f of files) {
    const sql = readFileSync(new URL(f, dir), "utf8");
    process.stdout.write(`Applying ${f} … `);
    await client.query(sql);
    console.log("ok");
  }

  const t = await client.query(
    "select table_name from information_schema.tables where table_schema='public' and table_name in ('items','vault_keys') order by table_name"
  );
  const b = await client.query("select id from storage.buckets where id='vault'");
  const p = await client.query(
    "select policyname from pg_policies where schemaname in ('public','storage') and policyname in ('own keys','own items','vault own objects')"
  );
  console.log("\nVerify:");
  console.log("  public tables :", t.rows.map((r) => r.table_name).join(", ") || "(none)");
  console.log("  storage bucket:", b.rows.length ? "vault present" : "MISSING");
  console.log("  RLS policies  :", p.rows.map((r) => r.policyname).join(", ") || "(none)");
} catch (e) {
  console.error("\nMigration failed:", e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
