import { z } from "zod";
import { getAppointment } from "@/lib/appointments";
import { ApiError, handler, json } from "@/lib/http";
import { requireUser } from "@/lib/session";

export const GET = handler(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser(req);
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) throw new ApiError(404, "APPOINTMENT_NOT_FOUND", "Appointment not found");
  return json({ appointment: await getAppointment(user, id) });
});
