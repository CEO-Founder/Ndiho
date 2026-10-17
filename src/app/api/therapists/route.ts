import { handler, json } from "@/lib/http";
import { listVerifiedTherapists } from "@/lib/users";

// Public directory: only verified, active therapists, and only public fields.
export const GET = handler(async (req) => {
  const params = req.nextUrl.searchParams;
  const therapists = await listVerifiedTherapists({
    specialty: params.get("specialty")?.slice(0, 60) || undefined,
    language: params.get("language")?.slice(0, 30) || undefined,
    limit: Number(params.get("limit")) || undefined,
  });
  return json({ therapists });
});
