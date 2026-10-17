#!/usr/bin/env node
// Applies db/migrations/*.sql in order, once each, inside a transaction.
// Usage: NDIHO_DATABASE_URL=postgres://... node scripts/migrate.mjs
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
// .env support for local use; the production image passes real env vars instead.
try {
  await import("dotenv/config");
} catch {
  // dotenv not installed
}

const url = process.env.NDIHO_DATABASE_URL;
if (!url) {
  console.error("NDIHO_DATABASE_URL is not set");
  process.exit(1);
}

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "db", "migrations");
// TLS follows the connection string's `sslmode`. Set NDIHO_DATABASE_CA to a PEM
// certificate (e.g. Supabase's CA) to verify the server certificate.
const ca = process.env.NDIHO_DATABASE_CA?.replace(/\\n/g, "\n");
const client = new pg.Client({
  connectionString: url,
  ...(ca ? { ssl: { ca, rejectUnauthorized: true } } : {}),
});

await client.connect();
try {
  await client.query(`create table if not exists ndiho_schema_migrations (
    name text primary key,
    applied_at timestamptz not null default now()
  )`);
  await client.query("alter table ndiho_schema_migrations enable row level security");

  const applied = new Set(
    (await client.query("select name from ndiho_schema_migrations")).rows.map((r) => r.name),
  );
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(path.join(dir, file), "utf8");
    await client.query("begin");
    try {
      await client.query(sql);
      await client.query("insert into ndiho_schema_migrations (name) values ($1)", [file]);
      await client.query("commit");
      console.log(`applied ${file}`);
    } catch (err) {
      await client.query("rollback");
      throw new Error(`${file}: ${err.message}`);
    }
  }
  console.log("ndiho migrations up to date");
} finally {
  await client.end();
}
