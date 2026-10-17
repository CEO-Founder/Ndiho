import type { Metadata } from "next";
import { ConnectionCheck } from "@/components/ConnectionCheck";
import { requirePageUser } from "@/lib/server-session";

export const metadata: Metadata = { title: "Test camera & connection" };

export default async function CheckPage() {
  await requirePageUser("/check");
  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
      <h1 className="mb-1 font-nd-serif text-4xl font-black tracking-tight text-nd-primary">Test your setup</h1>
      <p className="mb-8 text-nd-muted">
        Check your camera, microphone and network before a session. Run it on the device and network you&apos;ll use for the call.
      </p>
      <ConnectionCheck />
    </div>
  );
}
