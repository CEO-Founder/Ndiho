"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, errorMessage } from "./api";
import { AppointmentList, Card, formatWhen, useNow } from "./sessions";
import type { AppointmentView } from "./types";
import { Avatar, Button, inputClass, LinkButton } from "./ui";

interface Note {
  id: string;
  body: string;
  appointmentId: string | null;
  createdAt: string;
  updatedAt: string;
}

export function PatientDetail({
  me,
  patient,
  appointments,
  initialNotes,
}: {
  me: string;
  patient: { id: string; fullName: string };
  appointments: AppointmentView[];
  initialNotes: Note[];
}) {
  const router = useRouter();
  const [notes, setNotes] = useState(initialNotes);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const now = useNow(60_000);
  const upcoming = appointments.filter((a) => a.status !== "cancelled" && Date.parse(a.joinClosesAt) > now).reverse();
  const past = appointments.filter((a) => !upcoming.includes(a));

  async function add() {
    setBusy(true);
    setError(null);
    try {
      const { note } = await api<{ note: Note }>(`/patients/${patient.id}/notes`, { body: { body: draft } });
      setNotes([note, ...notes]);
      setDraft("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit() {
    if (!editing) return;
    setBusy(true);
    setError(null);
    try {
      const { note } = await api<{ note: Note }>(`/notes/${editing.id}`, { method: "PATCH", body: { body: editing.body } });
      setNotes(notes.map((n) => (n.id === note.id ? note : n)));
      setEditing(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!window.confirm("Delete this note? This can't be undone.")) return;
    setBusy(true);
    try {
      await fetch(`/api/notes/${id}`, { method: "DELETE", credentials: "same-origin" });
      setNotes(notes.filter((n) => n.id !== id));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-12">
      <div className="mb-8 flex items-center gap-4">
        <Avatar name={patient.fullName} size={64} />
        <div>
          <h1 className="font-nd-serif text-3xl font-black tracking-tight text-nd-primary sm:text-4xl">{patient.fullName}</h1>
          <p className="text-sm text-nd-muted">{appointments.filter((a) => a.sessionHeld).length} sessions held</p>
        </div>
        <LinkButton href="/patients" variant="ghost" size="sm" className="ml-auto">← All patients</LinkButton>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
        <div className="flex flex-col gap-6">
          <Card>
            <h2 className="mb-4 font-nd-serif text-xl font-bold text-nd-primary">Upcoming</h2>
            <AppointmentList appointments={upcoming} me={me} onChanged={() => router.refresh()} empty={<p className="text-sm text-nd-muted">No upcoming sessions.</p>} />
          </Card>
          <Card>
            <h2 className="mb-4 font-nd-serif text-xl font-bold text-nd-primary">History</h2>
            <AppointmentList appointments={past} me={me} onChanged={() => router.refresh()} empty={<p className="text-sm text-nd-muted">No past sessions yet.</p>} />
          </Card>
        </div>

        <Card>
          <h2 className="font-nd-serif text-xl font-bold text-nd-primary">Session notes</h2>
          <p className="mb-4 text-xs text-nd-muted">🔒 Private: only you can read these. Patients and administrators never see them.</p>
          <label className="flex flex-col gap-2">
            <span className="sr-only">New note</span>
            <textarea className={`${inputClass} min-h-28`} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="What did you cover? Goals for next time?" maxLength={20000} />
          </label>
          <div className="mt-2 flex justify-end">
            <Button size="sm" disabled={busy || !draft.trim()} onClick={add}>Save note</Button>
          </div>
          {error && <p role="alert" className="mt-2 text-sm text-red-600">{error}</p>}
          <ul className="mt-6 flex flex-col gap-3">
            {notes.length === 0 && <li className="text-sm text-nd-muted">No notes yet.</li>}
            {notes.map((n) => (
              <li key={n.id} className="rounded-2xl bg-nd-surface-low/70 p-4">
                <p className="mb-2 text-xs text-nd-muted">
                  {formatWhen(n.createdAt)}
                  {n.updatedAt !== n.createdAt && " · edited"}
                </p>
                {editing?.id === n.id ? (
                  <>
                    <textarea className={`${inputClass} min-h-28`} value={editing.body} onChange={(e) => setEditing({ id: n.id, body: e.target.value })} />
                    <div className="mt-2 flex justify-end gap-2">
                      <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
                      <Button size="sm" disabled={busy || !editing.body.trim()} onClick={saveEdit}>Save</Button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="whitespace-pre-wrap text-sm text-nd-on-background">{n.body}</p>
                    <div className="mt-2 flex gap-3 text-xs">
                      <button type="button" className="font-semibold text-nd-primary-light hover:underline" onClick={() => setEditing({ id: n.id, body: n.body })}>Edit</button>
                      <button type="button" className="font-semibold text-red-600 hover:underline" onClick={() => remove(n.id)}>Delete</button>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
