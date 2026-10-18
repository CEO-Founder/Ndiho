import { getAvailability, setAvailability } from "@/lib/appointments";
import { handler, json, readJson } from "@/lib/http";
import { availabilitySchema } from "@/lib/schemas";
import { requireUser } from "@/lib/session";

export const GET = handler(async (req) => {
  const user = await requireUser(req, "therapist");
  return json({ windows: await getAvailability(user.id) });
});

export const PUT = handler(async (req) => {
  const user = await requireUser(req, "therapist");
  const { windows } = await readJson(req, availabilitySchema);
  return json({ windows: await setAvailability(user, windows) });
});
