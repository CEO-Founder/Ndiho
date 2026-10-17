import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/AuthShell";
import { RegisterForm } from "@/components/RegisterForm";
import { currentUser } from "@/lib/server-session";

export const metadata: Metadata = { title: "Create your account" };

export default async function RegisterPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (await currentUser()) redirect("/dashboard");
  const role = (await searchParams).role === "therapist" ? "therapist" : "patient";
  return (
    <AuthShell title="Join Ndiho Space" subtitle="Mental wellness, made accessible." wide>
      <RegisterForm initialRole={role} />
    </AuthShell>
  );
}
