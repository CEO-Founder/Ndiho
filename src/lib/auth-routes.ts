import "server-only";
import type { NextRequest } from "next/server";
import { clientIp, json } from "./http";
import { rateLimit } from "./rate-limit";
import { createSession, setSessionCookie } from "./session";
import { getAccount } from "./users";

/** Issues a session cookie for a freshly authenticated user. */
export async function signInResponse(req: NextRequest, userId: string, status = 200) {
  const [{ token, expiresAt }, account] = await Promise.all([
    createSession(userId, { userAgent: req.headers.get("user-agent"), ip: clientIp(req) }),
    getAccount(userId),
  ]);
  const res = json({ user: account }, status);
  setSessionCookie(res, token, expiresAt);
  return res;
}

export function limitRegistrations(req: NextRequest) {
  rateLimit(`register:${clientIp(req)}`, 10, 60 * 60 * 1000);
}
