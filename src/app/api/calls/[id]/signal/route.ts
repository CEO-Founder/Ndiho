import { z } from "zod";
import { relaySignal } from "@/lib/calls";
import { ApiError, handler, json, readJson } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { signalSchema } from "@/lib/schemas";
import { requireUser } from "@/lib/session";

export const POST = handler(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser(req);
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) throw new ApiError(404, "CALL_NOT_FOUND", "Call not found");
  // ICE trickling sends bursts of candidates; this still caps abuse.
  rateLimit(`signal:${user.id}`, 600, 60 * 1000);
  const { kind, data } = await readJson(req, signalSchema);
  return json(await relaySignal(user, id, kind, data));
});
