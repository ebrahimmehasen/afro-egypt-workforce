"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Send, Sparkles, Trash2, X } from "lucide-react";
import {
  AssistantMessageDTO,
  clearAssistantHistory,
  loadAssistantHistory,
  sendAssistantMessage,
} from "@/lib/actions/assistant";
import { useT } from "@/components/providers/locale-provider";
import { Button } from "@/components/ui/button";
import { AssistantMessage } from "@/components/assistant/assistant-message";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

/**
 * A floating chat: a round button that widens to say what it is when you hover it, and opens the
 * conversation. The conversation is saved per user on the server, so it is still there next time.
 */
export function EmployeeAssistant() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [messages, setMessages] = useState<AssistantMessageDTO[]>([]);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  // an explicit flag, not useTransition: an async transition's pending state can end before the request does
  const [pending, setPending] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open || loaded) return;
    let cancelled = false;
    loadAssistantHistory().then((res) => {
      if (cancelled) return;
      if ("messages" in res) setMessages(res.messages);
      else setError(res.error);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [open, loaded]);

  // A new answer is read from its first line, so scroll to its top; the question you just sent, the
  // "thinking" note and a freshly opened chat go to the bottom.
  useEffect(() => {
    const list = listRef.current;
    if (!open || !list) return;
    const last = messages[messages.length - 1];
    if (!pending && last?.role === "assistant") {
      list.querySelector<HTMLElement>(`[data-msg-id="${last.id}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    } else {
      list.scrollTo({ top: list.scrollHeight, behavior: "smooth" });
    }
  }, [messages, pending, open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  function send(raw: string) {
    const text = raw.trim();
    if (!text || pending) return;
    setError(null);
    setInput("");
    const temp: AssistantMessageDTO = { id: `pending-${Date.now()}`, role: "user", content: text, createdAt: new Date().toISOString() };
    setMessages((m) => [...m, temp]);

    setPending(true);
    sendAssistantMessage(text)
      .then((res) => {
        if ("error" in res) {
          // take the question back out of the thread and into the box so it can be sent again
          setMessages((m) => m.filter((x) => x.id !== temp.id));
          setInput(text);
          setError(res.error);
          return;
        }
        setMessages((m) => [...m.filter((x) => x.id !== temp.id), ...res.messages]);
      })
      .catch(() => {
        setMessages((m) => m.filter((x) => x.id !== temp.id));
        setInput(text);
        setError(t.assistant.errorGeneric);
      })
      .finally(() => setPending(false));
  }

  function clear() {
    setPending(true);
    clearAssistantHistory()
      .then((res) => {
        if ("error" in res) setError(res.error);
        else {
          setMessages([]);
          setError(null);
        }
      })
      .catch(() => setError(t.assistant.errorGeneric))
      .finally(() => setPending(false));
  }

  return (
    <div className="fixed bottom-6 end-6 z-40 flex flex-col items-end gap-3">
      {open && (
        <div
          role="dialog"
          aria-label={t.assistant.title}
          className="flex h-[min(34rem,calc(100vh-9rem))] w-[min(26rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-elevated"
        >
          <div className="flex items-center justify-between gap-2 border-b border-border bg-primary px-4 py-3 text-primary-foreground">
            <div className="flex min-w-0 items-center gap-2">
              <Sparkles className="h-5 w-5 shrink-0" />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{t.assistant.title}</p>
                <p className="truncate text-xs opacity-80">{t.assistant.subtitle}</p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {messages.length > 0 && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button size="icon" variant="ghost" className="h-8 w-8 text-primary-foreground hover:bg-white/15 hover:text-primary-foreground" aria-label={t.assistant.clear} title={t.assistant.clear} disabled={pending}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>{t.assistant.clearTitle}</AlertDialogTitle>
                      <AlertDialogDescription>{t.assistant.clearConfirm}</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>{t.common.cancel}</AlertDialogCancel>
                      <AlertDialogAction onClick={clear}>{t.assistant.clear}</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
              <Button size="icon" variant="ghost" className="h-8 w-8 text-primary-foreground hover:bg-white/15 hover:text-primary-foreground" aria-label={t.assistant.close} onClick={() => setOpen(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div ref={listRef} className="flex flex-1 flex-col gap-3 overflow-y-auto p-3">
            {loaded && messages.length === 0 && !pending && (
              <div className="flex flex-col gap-3 py-2">
                <p className="text-center text-sm text-muted-foreground">{t.assistant.empty}</p>
                <div className="flex flex-col gap-2">
                  {t.assistant.suggestions.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => send(s)}
                      className="rounded-xl border border-border px-3 py-2 text-start text-sm transition-colors hover:bg-muted"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m) =>
              m.role === "user" ? (
                <div key={m.id} data-msg-id={m.id} dir="auto" className="max-w-[85%] self-end whitespace-pre-wrap rounded-2xl rounded-ee-sm bg-primary px-3 py-2 text-sm text-primary-foreground">
                  {m.content}
                </div>
              ) : (
                <div key={m.id} data-msg-id={m.id} dir="auto" className="max-w-[92%] self-start rounded-2xl rounded-es-sm bg-muted px-3 py-2">
                  <AssistantMessage text={m.content} />
                </div>
              ),
            )}

            {pending && (
              <div className="flex items-center gap-2 self-start rounded-2xl rounded-es-sm bg-muted px-3 py-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t.assistant.thinking}
              </div>
            )}
          </div>

          <div className="border-t border-border p-3">
            {error && <p className="mb-2 text-xs text-destructive">{error}</p>}
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                dir="auto"
                rows={1}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    send(input);
                  }
                }}
                placeholder={t.assistant.placeholder}
                className="max-h-28 min-h-10 flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <Button size="icon" onClick={() => send(input)} disabled={pending || !input.trim()} aria-label={t.assistant.send}>
                <Send className="h-4 w-4 rtl:-scale-x-100" />
              </Button>
            </div>
            <p className="mt-2 text-center text-[11px] text-muted-foreground">{t.assistant.disclaimer}</p>
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={t.assistant.hoverLabel}
        aria-expanded={open}
        className="group flex h-12 items-center rounded-full bg-primary px-3.5 text-primary-foreground shadow-lg transition-all hover:gap-2 hover:shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        <Sparkles className="h-5 w-5 shrink-0" />
        <span className="max-w-0 overflow-hidden whitespace-nowrap text-sm font-medium opacity-0 transition-all duration-200 group-hover:max-w-[10rem] group-hover:opacity-100 group-focus-visible:max-w-[10rem] group-focus-visible:opacity-100">
          {t.assistant.hoverLabel}
        </span>
      </button>
    </div>
  );
}
