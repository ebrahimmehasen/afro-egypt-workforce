"use client";

import { useActionState, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { Check, ClipboardList, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { createWorkRequest, decideWorkRequest } from "@/lib/actions/work-requests";
import { keepFilledFields, useActionFeedback } from "@/hooks/use-action-feedback";
import { useT } from "@/components/providers/locale-provider";
import { format } from "@/lib/i18n/format";
import type { WorkRequestRow } from "@/lib/work-requests";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { MultiSelectFilter, type MultiSelectOption } from "@/components/shared/multi-select-filter";
import { RequestStatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  const t = useT();
  return <Button type="submit" disabled={pending}>{pending ? t.common.saving : label}</Button>;
}

/** "طلب جديد": the type, the day, the hours (needed for late work), the workers and what's needed. */
export function WorkRequestDialog({ employees }: { employees: MultiSelectOption[] }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<"late_work" | "other">("late_work");
  const [selected, setSelected] = useState<string[]>([]);
  const [state, formAction] = useActionState(createWorkRequest, {});
  useActionFeedback(state, () => {
    setOpen(false);
    setSelected([]);
  });
  const bad = (f: string) => (state.fields?.includes(f) ? "border-destructive ring-1 ring-destructive" : "");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2"><Plus className="h-4 w-4" />{t.workRequests.add}</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t.workRequests.dialogTitle}</DialogTitle>
          <DialogDescription>{t.workRequests.noPayEffect}</DialogDescription>
        </DialogHeader>
        <form action={formAction} ref={keepFilledFields} className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label>{t.workRequests.type}</Label>
              <Select name="type" value={type} onValueChange={(v) => setType(v as "late_work" | "other")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="late_work">{t.workRequests.typeLateWork}</SelectItem>
                  <SelectItem value="other">{t.workRequests.typeOther}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="wr-date">{t.workRequests.date}</Label>
              <Input id="wr-date" name="date" type="date" className={bad("date")} required />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="wr-from">{t.workRequests.from}</Label>
              <Input id="wr-from" name="fromTime" type="time" className={bad("fromTime")} required={type === "late_work"} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="wr-to">{t.workRequests.to}</Label>
              <Input id="wr-to" name="toTime" type="time" className={bad("toTime")} required={type === "late_work"} />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>{t.workRequests.employees}</Label>
            <MultiSelectFilter
              className={`w-full ${bad("employeeIds")}`}
              placeholder={t.workRequests.employeesPlaceholder}
              selected={selected}
              onChange={setSelected}
              options={employees}
              searchable
            />
            {selected.map((id) => <input key={id} type="hidden" name="employeeIds" value={id} />)}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="wr-details">{t.workRequests.details}</Label>
            <Textarea id="wr-details" name="details" rows={3} placeholder={t.workRequests.detailsPlaceholder} className={bad("details")} required />
          </div>
          <DialogFooter><SubmitButton label={t.workRequests.submit} /></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RejectDialog({ id }: { id: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();
  const reject = () =>
    startTransition(async () => {
      const r = await decideWorkRequest(id, "rejected", note);
      if (r.error) toast.error(r.error);
      else {
        toast.success(r.message);
        setOpen(false);
      }
    });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1.5 text-destructive hover:text-destructive"><X className="h-4 w-4" />{t.workRequests.reject}</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>{t.workRequests.rejectTitle}</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`note-${id}`}>{t.workRequests.decisionNote}</Label>
          <Textarea id={`note-${id}`} rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t.workRequests.decisionNotePlaceholder} />
        </div>
        <DialogFooter>
          <Button variant="destructive" disabled={pending} onClick={reject}>{t.workRequests.reject}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ApproveButton({ id }: { id: string }) {
  const t = useT();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      size="sm"
      className="gap-1.5"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const r = await decideWorkRequest(id, "approved");
          if (r.error) toast.error(r.error);
          else toast.success(r.message);
        })
      }
    >
      <Check className="h-4 w-4" />{t.workRequests.approve}
    </Button>
  );
}

function RequestCard({ r, names, canDecide }: { r: WorkRequestRow; names: Record<string, string>; canDecide: boolean }) {
  const t = useT();
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{r.type === "late_work" ? t.workRequests.typeLateWork : t.workRequests.typeOther}</Badge>
            <span className="text-sm font-medium" dir="ltr">
              {r.date}
              {r.fromTime && ` · ${r.fromTime} → ${r.toTime ?? ""}`}
            </span>
          </div>
          <RequestStatusBadge status={r.status} />
        </div>
        <div className="text-sm">
          <span className="text-muted-foreground">{format(t.workRequests.selectedEmployees, { count: r.employeeIds.length })}: </span>
          {r.employeeIds.map((id) => names[id] ?? id).join("، ")}
        </div>
        <p className="whitespace-pre-wrap text-sm text-foreground">{r.details}</p>
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>
            {t.workRequests.requestedBy}: {r.requestedBy}
            {r.decidedBy && ` · ${t.workRequests.decidedBy}: ${r.decidedBy}`}
            {r.decisionNote && ` — ${r.decisionNote}`}
          </span>
          {canDecide && r.status === "pending" && (
            <div className="flex gap-2">
              <ApproveButton id={r.id} />
              <RejectDialog id={r.id} />
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/** The requests by status — pending first — with approve / reject for the system admin or HR. */
export function WorkRequestsView({ requests, names, canDecide }: { requests: WorkRequestRow[]; names: Record<string, string>; canDecide: boolean }) {
  const t = useT();
  const groups = (["pending", "approved", "rejected"] as const).map((status) => ({ status, rows: requests.filter((r) => r.status === status) }));
  return (
    <Tabs defaultValue="pending" className="flex flex-col gap-4">
      <TabsList className="self-start">
        {groups.map((g) => (
          <TabsTrigger key={g.status} value={g.status}>{t.workRequests[g.status]} ({g.rows.length})</TabsTrigger>
        ))}
      </TabsList>
      {groups.map((g) => (
        <TabsContent key={g.status} value={g.status} className="mt-0">
          {g.rows.length === 0 ? (
            <EmptyState icon={ClipboardList} title={t.workRequests.noRecords} />
          ) : (
            <div className="flex flex-col gap-3">
              {g.rows.map((r) => <RequestCard key={r.id} r={r} names={names} canDecide={canDecide} />)}
            </div>
          )}
        </TabsContent>
      ))}
    </Tabs>
  );
}
