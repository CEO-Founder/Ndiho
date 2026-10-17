import { z } from "zod";
import { getCall } from "@/lib/calls";
import { ApiError, handler, json } from "@/lib/http";
import { requireUser } from "@/lib/session";

export const GET = handler(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser(req);
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) throw new ApiError(404, "CALL_NOT_FOUND", "Call not found");
  return json({ call: await getCall(user, id) });
});
