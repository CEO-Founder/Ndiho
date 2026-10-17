import { assertSameOrigin, handler, json } from "@/lib/http";
import { clearSessionCookie, getSessionUser, revokeSession } from "@/lib/session";

export const POST = handler(async (req) => {
  assertSameOrigin(req);
  const user = await getSessionUser(req);
  if (user) await revokeSession(user.sessionId);
  const res = json({ ok: true });
  clearSessionCookie(res);
  return res;
});
