/**
 * GET /api/events — Server-Sent Events stream for real-time dashboard updates.
 *
 * The browser opens one persistent connection per dashboard session.
 * Webhook handlers publish events to Vercel KV; this endpoint polls KV
 * every second and streams any pending events down to the browser.
 *
 * The browser reconnects automatically if the connection drops (SSE spec).
 * Keepalive comments are sent every 15s to prevent proxy timeouts.
 */
import type { NextRequest } from "next/server";
import { auth } from "@/auth";
import { popEvent } from "@/lib/kv";

// SSE must never be statically optimized or cached, and needs to stay open as
// long as the platform allows. Vercel terminates the function at maxDuration;
// the browser's EventSource then reconnects automatically (SSE spec), so the
// stream is continuous from the client's perspective. 300s is the Pro cap;
// Vercel clamps this to the plan limit (60s on Hobby) automatically.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const POLL_INTERVAL_MS = 1000;
const KEEPALIVE_INTERVAL_MS = 15_000;

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return new Response("Unauthorized", { status: 401 });
  }

  const recruiterId = session.user.id;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;

      function send(data: object) {
        if (closed) return;
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(data)}\n\n`)
        );
      }

      function keepalive() {
        if (closed) return;
        controller.enqueue(encoder.encode(`: keepalive\n\n`));
      }

      // Confirm connection established
      send({ type: "connected" });

      // Poll KV for events
      const pollTimer = setInterval(async () => {
        if (closed) return;
        const event = await popEvent(recruiterId);
        if (event) send(event);
      }, POLL_INTERVAL_MS);

      // Keepalive to prevent proxy/load-balancer timeouts
      const keepaliveTimer = setInterval(keepalive, KEEPALIVE_INTERVAL_MS);

      // Clean up when client disconnects
      req.signal.addEventListener("abort", () => {
        closed = true;
        clearInterval(pollTimer);
        clearInterval(keepaliveTimer);
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
