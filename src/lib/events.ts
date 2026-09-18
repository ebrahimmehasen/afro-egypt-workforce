import { EventEmitter } from "node:events";

/**
 * Single-process pub/sub for "some record changed, refresh your view".
 * In-memory only — correct for the standard single-Node deployment this app
 * targets (see README's standalone/Docker recipe). A multi-instance/cluster
 * deployment would need a shared bus (Redis pub/sub, etc.) instead.
 *
 * Kept on `globalThis` so Next.js dev-server hot reloads reuse the same
 * emitter instead of leaking a new one per reload (mirrors src/lib/prisma.ts).
 */
declare global {
  // eslint-disable-next-line no-var
  var __afroDataChangeBus: EventEmitter | undefined;
}

function bus(): EventEmitter {
  if (!globalThis.__afroDataChangeBus) {
    globalThis.__afroDataChangeBus = new EventEmitter();
    // one listener per open SSE connection (every logged-in tab) — no fixed cap
    globalThis.__afroDataChangeBus.setMaxListeners(0);
  }
  return globalThis.__afroDataChangeBus;
}

/** Broadcasts "some record changed" to every open connection in this process. */
export function notifyDataChanged(): void {
  bus().emit("change");
}

/** Subscribe to change notifications; returns an unsubscribe function. */
export function onDataChanged(listener: () => void): () => void {
  bus().on("change", listener);
  return () => bus().off("change", listener);
}
