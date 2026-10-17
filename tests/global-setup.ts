import { execFileSync } from "node:child_process";
import pg from "pg";

// Integration tests run against a real Postgres database given by
// NDIHO_TEST_DATABASE_URL. Every ndiho_ table is dropped and re-migrated.
export default async function setup() {
  const url = process.env.NDIHO_TEST_DATABASE_URL;
  if (!url) {
    throw new Error("Set NDIHO_TEST_DATABASE_URL to a disposable Postgres database to run tests");
  }
  process.env.NDIHO_DATABASE_URL = url;
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  await client.query(`
    drop table if exists ndiho_calls, ndiho_sessions, ndiho_patient_profiles,
      ndiho_therapist_profiles, ndiho_users, ndiho_schema_migrations cascade`);
  await client.end();
  execFileSync("node", ["scripts/migrate.mjs"], {
    env: { ...process.env, NDIHO_DATABASE_URL: url },
    stdio: "inherit",
  });
}
