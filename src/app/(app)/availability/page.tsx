import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AvailabilityEditor } from "@/components/AvailabilityEditor";
import { getAvailability } from "@/lib/appointments";
import { requirePageUser } from "@/lib/server-session";

export const metadata: Metadata = { title: "Availability" };

export default async function AvailabilityPage() {
  const user = await requirePageUser("/availability");
  if (user.role !== "therapist") redirect("/dashboard");
  return <AvailabilityEditor initial={await getAvailability(user.id)} />;
}
