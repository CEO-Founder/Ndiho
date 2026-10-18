"use client";

import { useState } from "react";
import { SESSION_MINUTES, SLOT_STEP_MINUTES } from "@/lib/schemas";
import { minuteLabel, WEEKDAYS } from "@/lib/time";
import { api, errorMessage } from "./api";
import { Card, PLATFORM_TIMEZONE_LABEL } from "./sessions";
import { Button, LinkButton } from "./ui";

type Window = { weekday: number; startMinute: number; endMinute: number };

// Monday first, as therapists plan their week.
const ORDER = [1, 2, 3, 4, 5, 6, 0];
const HOURS = Array.from({ length: 18 }, (_, i) => (i + 6) * 60); // 06:00 … 23:00

function sessionsIn(w: Window) {
  let n = 0;
  for (let m = w.startMinute; m + SESSION_MINUTES <= w.endMinute; m += SLOT_STEP_MINUTES) n++;
  return n;
}

export function AvailabilityEditor({ initial }: { initial: Window[] }) {
  const [windows, setWindows] = useState<Window[]>(initial);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const update = (next: Window[]) => {
    setWindows(next);
    setMessage(null);
  };
  const forDay = (d: number) => windows.map((w, i) => ({ w, i })).filter(({ w }) => w.weekday === d);

  function addWindow(day: number) {
    const existing = forDay(day).map(({ w }) => w);
    const start = existing.length ? Math.min(Math.max(...existing.map((w) => w.endMinute)) + 60, 21 * 60) : 9 * 60;
    update([...windows, { weekday: day, startMinute: start, endMinute: Math.min(start + 3 * 60, 23 * 60) }]);
  }

  function setField(index: number, field: "startMinute" | "endMinute", value: number) {
    update(windows.map((w, i) => (i === index ? { ...w, [field]: value } : w)));
  }

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      const { windows: saved } = await api<{ windows: Window[] }>("/availability", { method: "PUT", body: { windows } });
      setWindows(saved);
      setMessage({ ok: true, text: "Availability saved. Patients can now book these times." });
    } catch (err) {
      setMessage({ ok: false, text: errorMessage(err) });
    } finally {
      setSaving(false);
    }
  }

  const total = windows.reduce((n, w) => n + sessionsIn(w), 0);

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
      <h1 className="font-nd-serif text-4xl font-black tracking-tight text-nd-primary">Weekly availability</h1>
      <p className="mb-6 mt-1 text-nd-muted">
        Patients can book {SESSION_MINUTES}-minute sessions starting on the hour inside these times ({PLATFORM_TIMEZONE_LABEL}).
        Changing your hours never cancels sessions already booked.
      </p>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" onClick={() => update([1, 2, 3, 4, 5].map((weekday) => ({ weekday, startMinute: 540, endMinute: 1020 })))}>
          Weekdays 09:00–17:00
        </Button>
        <Button size="sm" variant="ghost" onClick={() => update([])}>Clear all</Button>
        <span className="ml-auto text-sm font-semibold text-nd-primary" data-testid="weekly-total">{total} sessions / week</span>
      </div>

      <Card className="!p-0">
        <ul className="divide-y divide-nd-surface-highest/70">
          {ORDER.map((day) => {
            const rows = forDay(day);
            return (
              <li key={day} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:p-5">
                <div className="flex w-32 shrink-0 items-center gap-2 pt-1.5">
                  <span className={`h-2.5 w-2.5 rounded-full ${rows.length ? "bg-emerald-500" : "bg-nd-surface-highest"}`} />
                  <span className="font-semibold text-nd-primary">{WEEKDAYS[day]}</span>
                </div>
                <div className="flex flex-1 flex-col gap-2">
                  {rows.length === 0 && <p className="pt-1.5 text-sm text-nd-muted">Unavailable</p>}
                  {rows.map(({ w, i }) => (
                    <div key={i} className="flex flex-wrap items-center gap-2" data-testid={`window-${WEEKDAYS[day]}`}>
                      <select aria-label={`${WEEKDAYS[day]} start`} className="rounded-lg bg-nd-surface-low px-3 py-2 text-sm" value={w.startMinute} onChange={(e) => setField(i, "startMinute", Number(e.target.value))}>
                        {HOURS.slice(0, -1).map((m) => <option key={m} value={m}>{minuteLabel(m)}</option>)}
                      </select>
                      <span className="text-sm text-nd-muted">to</span>
                      <select aria-label={`${WEEKDAYS[day]} end`} className="rounded-lg bg-nd-surface-low px-3 py-2 text-sm" value={w.endMinute} onChange={(e) => setField(i, "endMinute", Number(e.target.value))}>
                        {HOURS.slice(1).map((m) => <option key={m} value={m}>{minuteLabel(m)}</option>)}
                      </select>
                      <span className="text-xs text-nd-muted">{sessionsIn(w)} session{sessionsIn(w) === 1 ? "" : "s"}</span>
                      <button type="button" aria-label="Remove time window" onClick={() => update(windows.filter((_, j) => j !== i))} className="ml-auto rounded-full px-2 text-lg text-nd-muted hover:bg-red-50 hover:text-red-600 sm:ml-0">
                        ×
                      </button>
                    </div>
                  ))}
                </div>
                <Button size="sm" variant="ghost" onClick={() => addWindow(day)} className="self-start">+ Add time</Button>
              </li>
            );
          })}
        </ul>
      </Card>

      {message && (
        <p role="status" className={`mt-4 rounded-xl px-4 py-3 text-sm font-medium ${message.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`}>{message.text}</p>
      )}
      <div className="mt-6 flex justify-between">
        <LinkButton href="/dashboard" variant="outline">← Dashboard</LinkButton>
        <Button size="lg" disabled={saving} onClick={save}>{saving ? "Saving…" : "Save availability"}</Button>
      </div>
    </div>
  );
}
