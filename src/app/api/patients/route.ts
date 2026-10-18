import { handler, json } from "@/lib/http";
import { listPatients } from "@/lib/patients";
import { requireUser } from "@/lib/session";

export const GET = handler(async (req) => {
  const user = await requireUser(req, "therapist");
  return json({ patients: await listPatients(user) });
});
