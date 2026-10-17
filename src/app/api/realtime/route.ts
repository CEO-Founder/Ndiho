import type { NextRequest } from "next/server";
import { errorResponse } from "@/lib/http";
import { subscribe, type RealtimeEvent } from "@/lib/realtime";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Server-Sent Events stream of the signed-in user's own events: incoming calls,
// call state changes and WebRTC signaling from the other participant.
export async function GET(req: NextRequest) {
  let user;
  try {
    user = await requireUser(req);
  } catch (err) {
    return errorResponse(err);
  }

  const encoder = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          cleanup();
        }
      };
      send("ready", { userId: user.id });
      const unsubscribe = subscribe(user.id, (e: RealtimeEvent) => send(e.type, e));
      // Comments keep proxies from closing an idle connection.
      const keepAlive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          cleanup();
        }
      }, 25_000);
      cleanup = () => {
        clearInterval(keepAlive);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // already closed
        }
      };
      req.signal.addEventListener("abort", () => cleanup());
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      // Disable response buffering on nginx-style proxies.
      "X-Accel-Buffering": "no",
    },
  });
}
