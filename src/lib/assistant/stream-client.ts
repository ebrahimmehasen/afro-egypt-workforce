import type { BrowserEvent } from "@/lib/assistant/stream";

/** Reads the answer stream in the browser: calls `onEvent` for each line as soon as it arrives. */
export async function readEventStream(body: ReadableStream<Uint8Array>, onEvent: (e: BrowserEvent) => void): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  const handle = (line: string) => {
    if (!line.trim()) return;
    try {
      onEvent(JSON.parse(line) as BrowserEvent);
    } catch {
      // a broken line is skipped rather than ending the answer
    }
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    pending += decoder.decode(value, { stream: true });
    let i;
    while ((i = pending.indexOf("\n")) >= 0) {
      handle(pending.slice(0, i));
      pending = pending.slice(i + 1);
    }
  }
  handle(pending + decoder.decode());
}
