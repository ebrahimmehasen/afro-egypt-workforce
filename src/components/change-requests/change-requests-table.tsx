"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Check, X, ClipboardCheck } from "lucide-react";
import { approveChangeRequest, rejectChangeRequest } from "@/lib/actions/change-requests";
import { useT, useLocale } from "@/components/providers/locale-provider";
import { intlLocale } from "@/lib/i18n/format";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/shared/empty-state";

type Status = "pending" | "approved" | "rejected";

interface ChangeRequestRow {
  id: string;
  requestedBy: string;
  module: string;
  actionLabel: string;
  summary: string;
  status: Status;
  reviewedBy: string | null;
  reviewNote: string | null;
  createdAt: string;
  reviewedAt: string | null;
}

const STATUS_VARIANT: Record<Status, "warning" | "success" | "destructive"> = {
  pending: "warning",
  approved: "success",
  rejected: "destructive",
};

export function ChangeRequestsTable({ requests }: { requests: ChangeRequestRow[] }) {
  const t = useT();
  const locale = useLocale();
  const [tab, setTab] = useState<Status>("pending");
  const [pending, startTransition] = useTransition();
  const [rejectTarget, setRejectTarget] = useState<ChangeRequestRow | null>(null);
  const [reason, setReason] = useState("");

  const fmt = (iso: string) => new Date(iso).toLocaleString(intlLocale(locale));

  const grouped = useMemo(() => {
    const byStatus: Record<Status, ChangeRequestRow[]> = { pending: [], approved: [], rejected: [] };
    for (const r of requests) byStatus[r.status].push(r);
    return byStatus;
  }, [requests]);

  function approve(id: string) {
    startTransition(async () => {
      const res = await approveChangeRequest(id);
      if (res?.error) toast.error(res.error);
      else toast.success(t.changeRequests.approvedMessage);
    });
  }

  function submitReject() {
    if (!rejectTarget) return;
    const id = rejectTarget.id;
    startTransition(async () => {
      const res = await rejectChangeRequest(id, reason.trim() || undefined);
      if (res?.error) toast.error(res.error);
      else {
        toast.success(t.changeRequests.rejectedMessage);
        setRejectTarget(null);
        setReason("");
      }
    });
  }

  const rows = grouped[tab];

  return (
    <div className="flex flex-col gap-4">
      <Tabs value={tab} onValueChange={(v) => setTab(v as Status)}>
        <TabsList>
          <TabsTrigger value="pending">{t.changeRequests.pendingTab} ({grouped.pending.length})</TabsTrigger>
          <TabsTrigger value="approved">{t.changeRequests.approvedTab} ({grouped.approved.length})</TabsTrigger>
          <TabsTrigger value="rejected">{t.changeRequests.rejectedTab} ({grouped.rejected.length})</TabsTrigger>
        </TabsList>

        <TabsContent value={tab} className="mt-4">
          {rows.length === 0 ? (
            <EmptyState icon={ClipboardCheck} title={t.changeRequests.noRequests} />
          ) : (
            <div className="overflow-hidden rounded-xl border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t.changeRequests.colRequestedBy}</TableHead>
                    <TableHead>{t.changeRequests.colModule}</TableHead>
                    <TableHead>{t.changeRequests.colAction}</TableHead>
                    <TableHead>{t.changeRequests.colSummary}</TableHead>
                    <TableHead>{t.changeRequests.colDate}</TableHead>
                    {tab !== "pending" && <TableHead>{t.changeRequests.colReviewedBy}</TableHead>}
                    {tab === "pending" && <TableHead className="text-end">{t.common.actions}</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">{r.requestedBy}</TableCell>
                      <TableCell className="text-muted-foreground">{r.module}</TableCell>
                      <TableCell>
                        <Badge variant={STATUS_VARIANT[r.status]}>{r.actionLabel}</Badge>
                      </TableCell>
                      <TableCell className="max-w-[320px] truncate">{r.summary}</TableCell>
                      <TableCell dir="ltr" className="tabular-nums text-xs text-muted-foreground">{fmt(r.createdAt)}</TableCell>
                      {tab !== "pending" && (
                        <TableCell className="text-xs text-muted-foreground">
                          {r.reviewedBy}
                          {r.reviewNote && <div className="italic">{r.reviewNote}</div>}
                        </TableCell>
                      )}
                      {tab === "pending" && (
                        <TableCell className="text-end">
                          <div className="flex justify-end gap-1">
                            <Button size="icon" variant="ghost" className="text-success" disabled={pending} onClick={() => approve(r.id)}>
                              <Check className="h-4 w-4" />
                            </Button>
                            <Button size="icon" variant="ghost" className="text-destructive" disabled={pending} onClick={() => setRejectTarget(r)}>
                              <X className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={rejectTarget != null} onOpenChange={(open) => !open && setRejectTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.changeRequests.reject}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <p className="text-sm text-muted-foreground">{rejectTarget?.summary}</p>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t.changeRequests.rejectReasonPlaceholder}
            />
          </div>
          <DialogFooter>
            <Button variant="destructive" disabled={pending} onClick={submitReject}>
              {t.changeRequests.reject}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
