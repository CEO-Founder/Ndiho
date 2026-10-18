import { z } from "zod";
import { getSlots } from "@/lib/appointments";
import { ApiError, handler, json } from "@/lib/http";
import { requireUser } from "@/lib/session";
import { platformTimezone } from "@/lib/time";

export const GET = handler(async (req, ctx: { params: Promise<{ id: string }> }) => {
  await requireUser(req);
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) throw new ApiError(404, "THERAPIST_NOT_FOUND", "Therapist not found");
  return json({ timezone: platformTimezone(), days: await getSlots(id) });
});
