import "server-only";
import { createHash, randomBytes } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";
import { query, queryOne, type Queryable } from "./db";
import { ApiError } from "./http";

export const SESSION_COOKIE = "ndiho_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type Role = "therapist" | "patient";

export interface SessionUser {
  id: string;
  email: string;
  role: Role;
  fullName: string;
  sessionId: string;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(
  userId: string,
  meta: { userAgent?: string | null; ip?: string | null },
  db?: Queryable,
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await query(
    `insert into ndiho_sessions (user_id, token_hash, user_agent, ip_address, expires_at)
     values ($1, $2, $3, $4, $5)`,
    [userId, hashToken(token), meta.userAgent?.slice(0, 300) ?? null, meta.ip ?? null, expiresAt],
    db,
  );
  return { token, expiresAt };
}

export function setSessionCookie(res: NextResponse, token: string, expiresAt: Date): void {
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export function clearSessionCookie(res: NextResponse): void {
  res.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

/** Resolves a raw session token to its active user, or null. */
export async function getUserFromToken(token: string | undefined | null): Promise<SessionUser | null> {
  if (!token || token.length > 100) return null;
  const row = await queryOne<{
    session_id: string;
    id: string;
    email: string;
    role: Role;
    full_name: string;
  }>(
    `select s.id as session_id, u.id, u.email, u.role, u.full_name
       from ndiho_sessions s
       join ndiho_users u on u.id = s.user_id
      where s.token_hash = $1
        and s.revoked_at is null
        and s.expires_at > now()
        and u.account_status = 'active'`,
    [hashToken(token)],
  );
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    fullName: row.full_name,
    sessionId: row.session_id,
  };
}

export async function getSessionUser(req: NextRequest): Promise<SessionUser | null> {
  return getUserFromToken(req.cookies.get(SESSION_COOKIE)?.value);
}

export async function requireUser(req: NextRequest, role?: Role): Promise<SessionUser> {
  const user = await getSessionUser(req);
  if (!user) throw new ApiError(401, "UNAUTHENTICATED", "Please sign in to continue");
  if (role && user.role !== role) {
    throw new ApiError(403, "FORBIDDEN", `Only ${role}s can do this`);
  }
  return user;
}

export async function revokeSession(sessionId: string): Promise<void> {
  await query("update ndiho_sessions set revoked_at = now() where id = $1 and revoked_at is null", [
    sessionId,
  ]);
}
