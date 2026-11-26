"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Tag } from "lucide-react";
import { classifyExit } from "@/lib/actions/leaves";
import { annotateExit } from "@/lib/actions/exit-annotations";
import { useActionFeedback } from "@/hooks/use-action-feedback";
import { useT } from "@/components/providers/locale-provider";
import { PermissionDurationPicker } from "@/components/leaves/permission-duration-picker";
import { PunchReminder } from "@/components/leaves/punch-reminder";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { format } from "@/lib/i18n/format";

/** What the day view needs for one employee's exits that day. Built on the server, so the times are the server's. */
export interface ClassifyContext {
  employeeId: string;
  date: string;
  /** Whether the viewer may classify (may approve leaves); the notes below are shown to everyone */
  canClassify: boolean;
  /** keyed by the exit's time (ISO): the minute they left (server time), the stretch's minutes, and the return punch */
  windows: Record<string, { startTime: string; minutes: number; back: string }>;
  /** keyed by the exit's time (ISO): the latest record-only note on that stretch */
  annotations: Record<string, { type: "mission" | "excused_absence"; by: string; reason: string }>;
}

type Kind = "permission" | "mission" | "excused_absence";

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  const t = useT();
  return <Button type="submit" disabled={pending}>{pending ? t.common.saving : label}</Button>;
}

/**
 * Classify one exit stretch the day view detected. A permission for a duration records an approved permission for
 * exactly that stretch (duration prefilled with the stretch's minutes) and the day is worked out again. A mission or
 * an excused absence is a note for the record only (who, when, why): it changes no deduction, overtime or pay.
 */
export function ClassifyExitDialog({
  employeeId,
  date,
  startTime,
  minutes,
  out,
  back,
  outIso,
  backIso,
}: {
  employeeId: string;
  date: string;
  startTime: string;
  minutes: number;
  out: string;
  back: string;
  outIso: string;
  backIso: string;
}) {
  const t = useT();
  const m = t.midDay;
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<Kind>("permission");
  const [permissionState, permissionAction] = useActionState(classifyExit, {});
  const [noteState, noteAction] = useActionState(annotateExit, {});
  useActionFeedback(permissionState, () => setOpen(false));
  useActionFeedback(noteState, () => setOpen(false));
  // the two record-only kinds always carry the warning under their name: choosing them waives nothing
  const kinds: { value: Kind; label: string; note?: string }[] = [
    { value: "permission", label: m.classifyPermission },
    { value: "mission", label: m.classifyMission, note: m.classifyRecordOnlyLabel },
    { value: "excused_absence", label: m.classifyExcused, note: m.classifyRecordOnlyLabel },
  ];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="mt-1 w-fit gap-1.5">
          <Tag className="h-3.5 w-3.5" />
          {m.classify}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>{m.classifyTitle}</DialogTitle></DialogHeader>
        <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          {format(m.classifyIntro, { out, back, minutes })}
        </p>
        <PunchReminder />
        <div className="flex flex-col gap-1.5">
          <Label>{m.classifyKindLabel}</Label>
          <div className="flex flex-wrap gap-2">
            {kinds.map((k) => (
              <Button
                key={k.value}
                type="button"
                size="sm"
                variant={kind === k.value ? "default" : "outline"}
                className={k.note ? "h-auto flex-col items-start gap-0.5 py-1.5 text-start" : undefined}
                onClick={() => setKind(k.value)}
              >
                <span>{k.label}</span>
                {k.note && <span className="max-w-[16rem] whitespace-normal text-[10px] font-normal leading-tight opacity-80">{k.note}</span>}
              </Button>
            ))}
          </div>
        </div>

        {kind === "permission" ? (
          <form action={permissionAction} className="flex flex-col gap-4">
            <input type="hidden" name="employeeId" value={employeeId} />
            <input type="hidden" name="date" value={date} />
            <input type="hidden" name="kind" value="permission" />
            <input type="hidden" name="startTime" value={startTime} />
            <div className="flex flex-col gap-1.5">
              <p className="text-xs text-muted-foreground">{m.classifyDuration}</p>
              <PermissionDurationPicker startTime={startTime} defaultMinutes={minutes} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="classify-reason">{t.leaves.formReason} <span className="text-xs font-normal text-muted-foreground">({t.common.optional})</span></Label>
              <Textarea id="classify-reason" name="reason" />
            </div>
            <DialogFooter><Submit label={m.classifySubmit} /></DialogFooter>
          </form>
        ) : (
          <form action={noteAction} className="flex flex-col gap-4">
            <input type="hidden" name="employeeId" value={employeeId} />
            <input type="hidden" name="date" value={date} />
            <input type="hidden" name="type" value={kind} />
            <input type="hidden" name="out" value={outIso} />
            <input type="hidden" name="back" value={backIso} />
            <p className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs">{m.classifyRecordOnlyHint}</p>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="annotate-reason">{m.annotateReason}</Label>
              <Textarea id="annotate-reason" name="reason" required minLength={3} />
            </div>
            <DialogFooter><Submit label={m.annotateSubmit} /></DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
