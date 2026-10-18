import { bookAppointment, listAppointments } from "@/lib/appointments";
import { handler, json, readJson } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { bookingSchema } from "@/lib/schemas";
import { requireUser } from "@/lib/session";

export const GET = handler(async (req) => {
  const user = await requireUser(req);
  const scope = req.nextUrl.searchParams.get("scope");
  const appointments = await listAppointments(user, {
    scope: scope === "past" || scope === "all" ? scope : "upcoming",
    limit: Number(req.nextUrl.searchParams.get("limit")) || undefined,
  });
  return json({ appointments });
});

export const POST = handler(async (req) => {
  const user = await requireUser(req, "patient");
  rateLimit(`book:${user.id}`, 20, 60 * 60 * 1000);
  const input = await readJson(req, bookingSchema);
  return json({ appointment: await bookAppointment(user, input) }, 201);
});
