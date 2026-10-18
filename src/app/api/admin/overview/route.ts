import { overview } from "@/lib/admin";
import { handler, json } from "@/lib/http";
import { requireUser } from "@/lib/session";

export const GET = handler(async (req) => {
  await requireUser(req, "admin");
  return json({ overview: await overview() });
});
