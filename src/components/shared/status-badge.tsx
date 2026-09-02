"use client";

import { Badge } from "@/components/ui/badge";
import { ATTENDANCE_STATUS_VARIANT, REQUEST_STATUS_VARIANT } from "@/lib/constants";
import { attendanceStatusLabel, requestStatusLabel } from "@/lib/i18n/labels";
import { useT } from "@/components/providers/locale-provider";
import { AttendanceStatus, RequestStatus } from "@/lib/types";

export function AttendanceStatusBadge({ status }: { status: AttendanceStatus }) {
  const t = useT();
  return <Badge variant={ATTENDANCE_STATUS_VARIANT[status]}>{attendanceStatusLabel(status, t)}</Badge>;
}

export function RequestStatusBadge({ status }: { status: RequestStatus }) {
  const t = useT();
  return <Badge variant={REQUEST_STATUS_VARIANT[status]}>{requestStatusLabel(status, t)}</Badge>;
}
