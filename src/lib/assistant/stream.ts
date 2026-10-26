import type { BridgeEvent } from "@/lib/assistant/claude-bridge";
import type { AssistantMessageDTO } from "@/lib/assistant/dto";

/** What the browser hears while an answer is written, one JSON object per line. */
export type BrowserEvent =
  | { type: "delta"; text: string }
  | { type: "tool" }
  | { type: "saved"; messages: AssistantMessageDTO[] }
  | { type: "error"; message: string };

export interface AnswerStreamDeps {
  /** The answer as the assistant service writes it. */
  events: (signal: AbortSignal) => AsyncIterable<BridgeEvent>;
  /** Stores the finished exchange and returns it. Only called when the whole answer arrived. */
  save: (answer: string, toolsUsed: string[]) => Promise<AssistantMessageDTO[]>;
  /** The words shown to the user for a failure. */
  describeError: (e: unknown) => string;
  /** Always called once, however the stream ends; frees the user's place so they can ask again. */
  finish: () => void;
}

/**
 * Turns the service's events into the stream the browser reads. A question that is stopped or abandoned half way
 * is not saved (the browser puts it back in the box), and the request to the service is dropped so the CLI behind
 * it stops too.
 */
export function createAnswerStream(deps: AnswerStreamDeps): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const abort = new AbortController();
  let closed = false;

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: BrowserEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          closed = true;
        }
      };
      try {
        let done: Extract<BridgeEvent, { type: "done" }> | null = null;
        for await (const ev of deps.events(abort.signal)) {
          if (ev.type === "done") done = ev;
          else send(ev);
        }
        if (!done) throw new Error("The assistant ended without an answer");
        if (!closed) send({ type: "saved", messages: await deps.save(done.answer, done.toolsUsed) });
      } catch (e) {
        if (!closed) send({ type: "error", message: deps.describeError(e) });
      } finally {
        deps.finish();
        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch {
            // already closed by the reader going away
          }
        }
      }
    },
    cancel() {
      closed = true;
      abort.abort();
    },
  });
}
