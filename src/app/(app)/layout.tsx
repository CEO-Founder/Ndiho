import { AppHeader } from "@/components/AppHeader";
import { IncomingCall } from "@/components/IncomingCall";
import { RealtimeProvider } from "@/components/RealtimeProvider";
import { requirePageUser } from "@/lib/server-session";

// Every page under (app) requires a signed-in Ndiho user and shares one
// realtime connection, so incoming calls ring wherever the user is.
export default async function NdihoAppLayout({ children }: { children: React.ReactNode }) {
  // Pages also guard themselves with their own return path.
  const user = await requirePageUser("/dashboard");
  return (
    <RealtimeProvider>
      <AppHeader user={{ fullName: user.fullName, role: user.role }} />
      <main className="flex-1">{children}</main>
      <IncomingCall userId={user.id} />
    </RealtimeProvider>
  );
}
