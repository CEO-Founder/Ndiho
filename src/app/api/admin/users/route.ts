import { searchUsers } from "@/lib/admin";
import { handler, json } from "@/lib/http";
import { requireUser } from "@/lib/session";

export const GET = handler(async (req) => {
  await requireUser(req, "admin");
  return json({ users: await searchUsers(req.nextUrl.searchParams.get("q")?.slice(0, 100) ?? undefined) });
});
