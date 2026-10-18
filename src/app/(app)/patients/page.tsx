import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Card } from "@/components/sessions";
import { formatWhen } from "@/lib/format";
import { Avatar } from "@/components/ui";
import { listPatients } from "@/lib/patients";
import { requirePageUser } from "@/lib/server-session";

export const metadata: Metadata = { title: "Patients" };

export default async function PatientsPage() {
  const user = await requirePageUser("/patients");
  if (user.role !== "therapist") redirect("/dashboard");
  const patients = await listPatients(user);
  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-12">
      <h1 className="font-nd-serif text-4xl font-black tracking-tight text-nd-primary">Your patients</h1>
      <p className="mb-8 mt-1 text-nd-muted">Everyone who has booked or called you. Open a patient for their sessions and your private notes.</p>
      <Card className="!p-0">
        {patients.length === 0 ? (
          <p className="p-10 text-center text-sm text-nd-muted">No patients yet.</p>
        ) : (
          <ul className="divide-y divide-nd-surface-highest/70">
            {patients.map((p) => (
              <li key={p.id}>
                <Link href={`/patients/${p.id}`} className="flex items-center gap-4 p-4 transition hover:bg-nd-surface-low/60 sm:p-5">
                  <Avatar name={p.fullName} size={44} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-nd-primary">{p.fullName}</p>
                    <p className="text-xs text-nd-muted">
                      {p.sessionsHeld} session{p.sessionsHeld === 1 ? "" : "s"} held
                      {p.lastSessionAt && ` · last ${formatWhen(p.lastSessionAt)}`}
                    </p>
                  </div>
                  {p.nextAppointmentAt && (
                    <span className="hidden rounded-full bg-nd-secondary px-3 py-1 text-xs font-semibold text-nd-primary sm:inline">
                      Next: {formatWhen(p.nextAppointmentAt)}
                    </span>
                  )}
                  <span aria-hidden className="text-nd-muted">→</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
