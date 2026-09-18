import { getSession } from "@/lib/auth";
import { onDataChanged } from "@/lib/events";

export const dynamic = "force-dynamic";

const KEEPALIVE_MS = 25_000;

/**
 * Server-Sent Events stream — one open connection per logged-in tab. Emits
 * `data: changed` whenever any write happens anywhere in the app (see
 * src/lib/prisma.ts), and a `data: ping` every 25s to keep the connection
 * alive through proxies/load balancers that time out idle connections.
 */
export async function GET() {
  const user = await getSession();
  if (!user) return new Response("unauthorized", { status: 401 });

  const encoder = new TextEncoder();
  let unsubscribe: () => void = () => {};
  let keepAlive: ReturnType<typeof setInterval>;

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string) => {
        try {
          controller.enqueue(encoder.encode(`data: ${event}\n\n`));
        } catch {
          // controller already closed (client disconnected) — cancel() will clean up
        }
      };
      unsubscribe = onDataChanged(() => send("changed"));
      keepAlive = setInterval(() => send("ping"), KEEPALIVE_MS);
    },
    cancel() {
      unsubscribe();
      clearInterval(keepAlive);
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
