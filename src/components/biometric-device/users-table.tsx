"use client";

import { useState } from "react";
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useT } from "@/components/providers/locale-provider";
import { DeviceUser } from "@/lib/zk-device";
import { Employee } from "@/lib/types";
import { DeviceUserDetailDialog } from "@/components/biometric-device/device-user-detail-dialog";

export function DeviceUsersTable({ users, employees }: { users: DeviceUser[]; employees: Employee[] }) {
  const t = useT();
  const [selected, setSelected] = useState<DeviceUser | null>(null);
  const employeesByDeviceUserId = new Map(employees.filter((e) => e.biometricDeviceUserId).map((e) => [e.biometricDeviceUserId!, e]));

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t.biometricDevice.uid}</TableHead>
              <TableHead>{t.biometricDevice.deviceUserId}</TableHead>
              <TableHead>{t.biometricDevice.name}</TableHead>
              <TableHead>{t.biometricDevice.linkedEmployee}</TableHead>
              <TableHead>{t.biometricDevice.card}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((u) => {
              const linked = employeesByDeviceUserId.get(u.userId);
              return (
                <TableRow
                  key={u.uid}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => setSelected(u)}
                >
                  <TableCell dir="ltr" className="tabular-nums">{u.uid}</TableCell>
                  <TableCell dir="ltr" className="tabular-nums">{u.userId}</TableCell>
                  <TableCell className="font-medium">{u.name}</TableCell>
                  <TableCell>
                    {linked ? (
                      <Badge variant="success">{linked.name}</Badge>
                    ) : (
                      <Badge variant="outline">{t.biometricDevice.notLinked}</Badge>
                    )}
                  </TableCell>
                  <TableCell dir="ltr">{u.cardno || "—"}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <DeviceUserDetailDialog
        user={selected}
        linkedEmployee={selected ? (employeesByDeviceUserId.get(selected.userId) ?? null) : null}
        employees={employees}
        onOpenChange={(open) => !open && setSelected(null)}
      />
    </div>
  );
}
