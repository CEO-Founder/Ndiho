import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BookingWizard } from "@/components/BookingWizard";
import { requirePageUser } from "@/lib/server-session";

export const metadata: Metadata = { title: "Book a session" };

export default async function BookPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requirePageUser("/book");
  if (user.role !== "patient") redirect("/dashboard");
  const { therapist } = await searchParams;
  return <BookingWizard initialTherapistId={therapist && /^[0-9a-f-]{36}$/i.test(therapist) ? therapist : undefined} />;
}
