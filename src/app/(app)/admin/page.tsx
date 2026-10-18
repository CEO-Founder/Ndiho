import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AdminDashboard } from "@/components/AdminDashboard";
import { requirePageUser } from "@/lib/server-session";

export const metadata: Metadata = { title: "Admin" };

export default async function AdminPage() {
  const user = await requirePageUser("/admin");
  if (user.role !== "admin") redirect("/dashboard");
  return <AdminDashboard me={user.id} />;
}
