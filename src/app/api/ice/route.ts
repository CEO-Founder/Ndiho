import { handler, json } from "@/lib/http";
import { getIceConfig } from "@/lib/ice";
import { requireUser } from "@/lib/session";

// Fresh STUN/TURN configuration (with short-lived TURN credentials) for the
// signed-in user. Fetched by the call room right before connecting.
export const GET = handler(async (req) => {
  const user = await requireUser(req);
  return json(getIceConfig(user.id));
});
