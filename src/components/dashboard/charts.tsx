"use client";

import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  BarChart,
  Bar,
  Legend,
} from "recharts";
import { useT } from "@/components/providers/locale-provider";

const CHART_COLORS = {
  present: "#1a7f4e",
  late: "#e7b13a",
  absent: "#d6392a",
  primary: "#d6392a",
  gold: "#e7b13a",
};

export function AttendanceTrendChart({
  data,
}: {
  data: { date: string; present: number; late: number; absent: number }[];
}) {
  const t = useT();
  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 16% 89%)" />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 11 }}
          tickFormatter={(v: string) => v.slice(5)}
        />
        <YAxis tick={{ fontSize: 11 }} width={30} />
        <Tooltip
          contentStyle={{ fontSize: 12, borderRadius: 8 }}
          labelFormatter={(v) => `${t.common.date}: ${v}`}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Line type="monotone" dataKey="present" name={t.statuses.present} stroke={CHART_COLORS.present} strokeWidth={2} dot={false} />
        <Line type="monotone" dataKey="late" name={t.statuses.late} stroke={CHART_COLORS.late} strokeWidth={2} dot={false} />
        <Line type="monotone" dataKey="absent" name={t.statuses.absent} stroke={CHART_COLORS.absent} strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function DepartmentAttendanceChart({
  data,
}: {
  data: { department: string; present: number; total: number; rate: number }[];
}) {
  const t = useT();
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 16% 89%)" />
        <XAxis dataKey="department" tick={{ fontSize: 11 }} />
        <YAxis tick={{ fontSize: 11 }} width={30} unit="%" />
        <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
        <Bar dataKey="rate" name={t.dashboard.attendanceByDept} fill={CHART_COLORS.primary} radius={[6, 6, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function CostByDepartmentChart({
  data,
}: {
  data: { department: string; total: number; overtime: number; deductions: number }[];
}) {
  const t = useT();
  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 16% 89%)" />
        <XAxis dataKey="department" tick={{ fontSize: 11 }} />
        <YAxis tick={{ fontSize: 11 }} width={50} />
        <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="total" name={t.payroll.netSalary} fill={CHART_COLORS.primary} radius={[6, 6, 0, 0]} />
        <Bar dataKey="overtime" name={t.workforceCost.overtime} fill={CHART_COLORS.gold} radius={[6, 6, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
