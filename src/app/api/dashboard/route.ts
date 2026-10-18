import { ApiError, handler, json } from "@/lib/http";
import { dashboardStats } from "@/lib/patients";
import { requireUser } from "@/lib/session";

export const GET = handler(async (req) => {
  const user = await requireUser(req);
  if (user.role === "admin") throw new ApiError(400, "USE_ADMIN_OVERVIEW", "Admins use /api/admin/overview");
  return json({ stats: await dashboardStats(user) });
});
