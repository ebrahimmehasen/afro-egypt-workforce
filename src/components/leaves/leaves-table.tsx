"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Check, X, CalendarDays } from "lucide-react";
import { Leave, Employee } from "@/lib/types";
import { decideLeave } from "@/lib/actions/leaves";
import { leaveTypeLabel } from "@/lib/i18n/labels";
import { useT } from "@/components/providers/locale-provider";
import { RequestStatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/shared/empty-state";

export function LeavesTable({
  leaves,
  employees,
  canApprove,
}: {
  leaves: Leave[];
  employees: Employee[];
  canApprove: boolean;
}) {
  const t = useT();
  const empMap = new Map(employees.map((e) => [e.id, e]));
  const [pending, startTransition] = useTransition();

  if (leaves.length === 0) {
    return <EmptyState icon={CalendarDays} title={t.leaves.noRequests} />;
  }

  function decide(id: string, decision: "approved" | "rejected") {
    startTransition(async () => {
      const res = await decideLeave(id, decision);
      if (res?.error) toast.error(res.error);
      else toast.success(decision === "approved" ? t.leaves.approved : t.leaves.rejected);
    });
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t.leaves.colEmployee}</TableHead>
            <TableHead>{t.leaves.colType}</TableHead>
            <TableHead>{t.leaves.colFrom}</TableHead>
            <TableHead>{t.leaves.colTo}</TableHead>
            <TableHead>{t.leaves.colReason}</TableHead>
            <TableHead>{t.leaves.colStatus}</TableHead>
            <TableHead>{t.leaves.colApprovedBy}</TableHead>
            {canApprove && <TableHead className="text-end">{t.leaves.colActions}</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {leaves.map((l) => {
            const employee = empMap.get(l.employeeId);
            return (
              <TableRow key={l.id}>
                <TableCell>
                  <div className="font-medium">{employee?.name ?? l.employeeId}</div>
                  <div className="text-xs text-muted-foreground">{l.employeeId}</div>
                </TableCell>
                <TableCell>{leaveTypeLabel(l.type, t)}</TableCell>
                <TableCell>{l.from}</TableCell>
                <TableCell>{l.to}</TableCell>
                <TableCell className="max-w-[220px] truncate text-muted-foreground">{l.reason}</TableCell>
                <TableCell><RequestStatusBadge status={l.status} /></TableCell>
                <TableCell className="text-muted-foreground">{l.approvedBy ?? "—"}</TableCell>
                {canApprove && (
                  <TableCell className="text-end">
                    {l.status === "pending" ? (
                      <div className="flex justify-end gap-1">
                        <Button size="icon" variant="ghost" className="text-success" disabled={pending} onClick={() => decide(l.id, "approved")}>
                          <Check className="h-4 w-4" />
                        </Button>
                        <Button size="icon" variant="ghost" className="text-destructive" disabled={pending} onClick={() => decide(l.id, "rejected")}>
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                )}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
