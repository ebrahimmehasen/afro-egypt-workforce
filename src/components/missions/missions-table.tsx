"use client";

import { useState } from "react";
import { Plane, Pencil } from "lucide-react";
import { useT } from "@/components/providers/locale-provider";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from "@/components/ui/table";
import { Employee, Mission } from "@/lib/types";
import { EditMissionDialog } from "@/components/missions/mission-form-dialog";
import { DeleteMissionButton } from "@/components/missions/delete-mission-button";

function whenText(m: Mission): string {
  if (m.startTime) return `${m.from} — ${m.startTime}${m.endTime ? ` → ${m.endTime}` : ""}`;
  return m.from === m.to ? m.from : `${m.from} → ${m.to}`;
}

export function MissionsTable({ missions, employees, canManage }: { missions: Mission[]; employees: Employee[]; canManage: boolean }) {
  const t = useT();
  const [editing, setEditing] = useState<Mission | null>(null);
  const byId = new Map(employees.map((e) => [e.id, e]));

  if (missions.length === 0) return <EmptyState icon={Plane} title={t.missions.noRecords} />;

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t.missions.colEmployee}</TableHead>
            <TableHead>{t.missions.colDestination}</TableHead>
            <TableHead>{t.missions.colWhen}</TableHead>
            {canManage && <TableHead>{t.missions.colActions}</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {missions.map((m) => {
            const e = byId.get(m.employeeId);
            return (
              <TableRow key={m.id}>
                <TableCell>{e ? `${e.name} — ${e.employeeNumber}` : m.employeeId}</TableCell>
                <TableCell>{m.destination}</TableCell>
                <TableCell>{whenText(m)}</TableCell>
                {canManage && (
                  <TableCell className="flex gap-1">
                    <Button variant="ghost" size="icon" onClick={() => setEditing(m)}><Pencil className="h-4 w-4" /></Button>
                    <DeleteMissionButton id={m.id} />
                  </TableCell>
                )}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {editing && (
        <EditMissionDialog
          mission={editing}
          employees={employees}
          open={Boolean(editing)}
          onOpenChange={(open) => { if (!open) setEditing(null); }}
        />
      )}
    </>
  );
}
