import { z } from "zod";
import { cancelAppointment } from "@/lib/appointments";
import { ApiError, handler, json, readJson } from "@/lib/http";
import { cancelSchema } from "@/lib/schemas";
import { requireUser } from "@/lib/session";

export const POST = handler(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser(req);
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) throw new ApiError(404, "APPOINTMENT_NOT_FOUND", "Appointment not found");
  const { reason } = await readJson(req, cancelSchema);
  return json({ appointment: await cancelAppointment(user, id, reason) });
});
