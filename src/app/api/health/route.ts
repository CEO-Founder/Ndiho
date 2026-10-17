import { getPool } from "@/lib/db";
import { json } from "@/lib/http";

export const dynamic = "force-dynamic";

// Liveness + database check for the deployment's health checks.
export async function GET() {
  try {
    await getPool().query("select 1");
    return json({ ok: true, db: "up" });
  } catch (err) {
    console.error("[ndiho] health check: database unreachable", err);
    return json({ ok: false, db: "down" }, 503);
  }
}
