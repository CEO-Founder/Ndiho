import "server-only";
import { Pool, type PoolClient, type QueryResultRow } from "pg";

// One pool per process. Next.js dev bundles each route separately, so the pool
// lives on globalThis to avoid opening a new pool per route module.
const globalForDb = globalThis as unknown as { __ndihoPool?: Pool };

export function getPool(): Pool {
  if (!globalForDb.__ndihoPool) {
    const connectionString = process.env.NDIHO_DATABASE_URL;
    if (!connectionString) {
      throw new Error("NDIHO_DATABASE_URL is not set");
    }
    // TLS follows the connection string's `sslmode`. NDIHO_DATABASE_CA (PEM)
    // enables verified TLS, e.g. with Supabase's CA certificate.
    const ca = process.env.NDIHO_DATABASE_CA?.replace(/\\n/g, "\n");
    globalForDb.__ndihoPool = new Pool({
      connectionString,
      max: Number(process.env.NDIHO_DATABASE_POOL_SIZE ?? 10),
      ...(ca ? { ssl: { ca, rejectUnauthorized: true } } : {}),
    });
  }
  return globalForDb.__ndihoPool;
}

export type Queryable = Pick<PoolClient, "query">;

export async function query<T extends QueryResultRow>(
  text: string,
  params: unknown[] = [],
  db: Queryable = getPool(),
): Promise<T[]> {
  const result = await db.query<T>(text, params);
  return result.rows;
}

export async function queryOne<T extends QueryResultRow>(
  text: string,
  params: unknown[] = [],
  db: Queryable = getPool(),
): Promise<T | null> {
  const rows = await query<T>(text, params, db);
  return rows[0] ?? null;
}

export async function transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}

/** Postgres unique_violation, optionally for a specific constraint/index. */
export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  const e = err as { code?: string; constraint?: string };
  return e?.code === "23505" && (!constraint || e.constraint === constraint);
}
