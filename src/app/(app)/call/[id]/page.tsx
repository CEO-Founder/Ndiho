import type { Metadata } from "next";
import { CallRoom } from "@/components/CallRoom";
import { requirePageUser } from "@/lib/server-session";

export const metadata: Metadata = { title: "Video consultation" };

export default async function CallPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requirePageUser(`/call/${id}`);
  // Participation is checked by the API when the room loads the call.
  return <CallRoom callId={id} me={user.id} />;
}
