import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { Dashboard } from "@/components/Dashboard";
import { requirePageUser } from "@/lib/server-session";
import { getAccount } from "@/lib/users";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requirePageUser("/dashboard");
  if (user.role === "admin") redirect("/admin");
  const account = (await getAccount(user.id))!;
  return <Dashboard account={account} welcome={(await searchParams).welcome === "1"} />;
}
