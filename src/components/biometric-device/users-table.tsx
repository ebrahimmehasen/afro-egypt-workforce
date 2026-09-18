"use client";

import { useRouter } from "next/navigation";
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useT } from "@/components/providers/locale-provider";
import { DeviceUser } from "@/lib/zk-device";
import { Employee } from "@/lib/types";

export function DeviceUsersTable({
  users, employees, punchCounts,
}: {
  users: DeviceUser[];
  employees: Employee[];
  punchCounts: Record<string, number>;
}) {
  const t = useT();
  const router = useRouter();
  const employeesByDeviceUserId = new Map(employees.filter((e) => e.biometricDeviceUserId).map((e) => [e.biometricDeviceUserId!, e]));

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t.biometricDevice.uid}</TableHead>
            <TableHead>{t.biometricDevice.deviceUserId}</TableHead>
            <TableHead>{t.biometricDevice.name}</TableHead>
            <TableHead>{t.biometricDevice.linkedEmployee}</TableHead>
            <TableHead>{t.biometricDevice.punchCount}</TableHead>
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
                onClick={() => router.push(`/biometric-device/users/${u.uid}`)}
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
                <TableCell dir="ltr" className="tabular-nums">{(punchCounts[u.userId] ?? 0).toLocaleString()}</TableCell>
                <TableCell dir="ltr">{u.cardno || "—"}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
