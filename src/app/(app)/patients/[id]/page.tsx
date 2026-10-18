import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { PatientDetail } from "@/components/PatientDetail";
import { listAppointments } from "@/lib/appointments";
import { ApiError } from "@/lib/http";
import { assertPatientOf, listNotes } from "@/lib/patients";
import { requirePageUser } from "@/lib/server-session";

export const metadata: Metadata = { title: "Patient" };

export default async function PatientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requirePageUser(`/patients/${id}`);
  if (user.role !== "therapist") redirect("/dashboard");
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  let data;
  try {
    const patient = await assertPatientOf(user, id);
    const [appointments, notes] = await Promise.all([
      listAppointments(user, { scope: "all", withUser: id, limit: 100 }),
      listNotes(user, id),
    ]);
    data = { patient, appointments, notes };
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }
  return <PatientDetail me={user.id} patient={data.patient} appointments={data.appointments} initialNotes={data.notes} />;
}
