#!/usr/bin/env node
// Therapist verification from the command line, until an admin UI exists.
//   node scripts/admin.mjs pending
//   node scripts/admin.mjs verify  <email>
//   node scripts/admin.mjs reject  <email> "<reason>"
//   node scripts/admin.mjs suspend <email>
//   node scripts/admin.mjs activate <email>
import pg from "pg";
// .env support for local use; the production image passes real env vars instead.
try {
  await import("dotenv/config");
} catch {
  // dotenv not installed
}

const [command, email, ...rest] = process.argv.slice(2);
const url = process.env.NDIHO_DATABASE_URL;
if (!url) {
  console.error("NDIHO_DATABASE_URL is not set");
  process.exit(1);
}
const ca = process.env.NDIHO_DATABASE_CA?.replace(/\\n/g, "\n");
const client = new pg.Client({ connectionString: url, ...(ca ? { ssl: { ca, rejectUnauthorized: true } } : {}) });

const SQL = {
  verify: `update ndiho_therapist_profiles t
              set verification_status = 'verified', verified_at = now(), verification_notes = null, updated_at = now()
             from ndiho_users u where u.id = t.user_id and u.email = $1 returning u.email`,
  reject: `update ndiho_therapist_profiles t
              set verification_status = 'rejected', verified_at = null, verification_notes = $2, updated_at = now()
             from ndiho_users u where u.id = t.user_id and u.email = $1 returning u.email`,
  suspend: `update ndiho_users set account_status = 'suspended', updated_at = now() where email = $1 returning email`,
  activate: `update ndiho_users set account_status = 'active', updated_at = now() where email = $1 returning email`,
};

await client.connect();
try {
  if (command === "pending") {
    const { rows } = await client.query(
      `select u.email, u.full_name, t.professional_title, t.licensing_body, t.license_country,
              t.license_number, t.created_at
         from ndiho_therapist_profiles t join ndiho_users u on u.id = t.user_id
        where t.verification_status = 'pending' order by t.created_at`,
    );
    console.table(rows);
  } else if (SQL[command] && email) {
    const params = command === "reject" ? [email.toLowerCase(), rest.join(" ") || null] : [email.toLowerCase()];
    const { rowCount } = await client.query(SQL[command], params);
    if (!rowCount) {
      console.error(`No matching ${command === "verify" || command === "reject" ? "therapist" : "user"}: ${email}`);
      process.exitCode = 1;
    } else {
      if (command === "suspend") {
        await client.query(
          "update ndiho_sessions set revoked_at = now() where revoked_at is null and user_id = (select id from ndiho_users where email = $1)",
          [email.toLowerCase()],
        );
      }
      console.log(`${command}: ${email}`);
    }
  } else {
    console.error("Usage: ndiho-admin.mjs pending | verify <email> | reject <email> <reason> | suspend <email> | activate <email>");
    process.exitCode = 1;
  }
} finally {
  await client.end();
}
