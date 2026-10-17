import { handler, json } from "@/lib/http";
import { getSessionUser } from "@/lib/session";
import { getAccount } from "@/lib/users";

export const GET = handler(async (req) => {
  const session = await getSessionUser(req);
  if (!session) return json({ user: null });
  return json({ user: await getAccount(session.id) });
});
