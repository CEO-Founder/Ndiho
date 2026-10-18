import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { ProfileForm } from "@/components/ProfileForm";
import { requirePageUser } from "@/lib/server-session";
import { getAccount } from "@/lib/users";

export const metadata: Metadata = { title: "Your profile" };

export default async function ProfilePage() {
  const user = await requirePageUser("/profile");
  if (user.role === "admin") redirect("/admin");
  const account = (await getAccount(user.id))!;
  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
      <h1 className="mb-1 font-nd-serif text-4xl font-black tracking-tight text-nd-primary">Your profile</h1>
      <p className="mb-8 text-nd-muted">
        {account.role === "therapist"
          ? "This is what patients see in the directory once you're verified."
          : "Only you and the therapists you consult can see your name. Your other details stay private."}
      </p>
      <ProfileForm account={account} />
    </div>
  );
}
