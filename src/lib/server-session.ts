import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getUserFromToken, SESSION_COOKIE, type SessionUser } from "./session";

/** Session user for a server component / page, or null. */
export async function currentUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    return await getUserFromToken(token);
  } catch (err) {
    console.error("[ndiho] session lookup failed", err);
    return null;
  }
}

export async function requirePageUser(next: string): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(next)}`);
  return user;
}

/** Post-login redirect target: only same-site paths, never another origin. */
export function safeNext(next: string | string[] | undefined): string {
  const value = Array.isArray(next) ? next[0] : next;
  // "/x" is local; "//host" and "/\\host" are protocol-relative URLs to other sites.
  return value && /^\/(?![/\\])/.test(value) ? value : "/dashboard";
}
