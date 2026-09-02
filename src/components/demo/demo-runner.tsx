"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  Fingerprint, AlertTriangle, LogOut, CheckCircle2, TimerReset,
  ThumbsUp, MinusCircle, Calculator, Receipt, TrendingUp, PlayCircle, RotateCcw,
} from "lucide-react";
import { simulatePunch } from "@/lib/actions/attendance";
import { createOvertime, decideOvertime } from "@/lib/actions/overtime";
import { createDeduction } from "@/lib/actions/deductions";
import { calculatePayroll } from "@/lib/actions/payroll";
import { getDemoSnapshot } from "@/lib/actions/demo";
import { DEMO_DATE, DEMO_EMPLOYEE_ID, DEMO_PERIOD_ID, DEVICE_ID, formatEGP } from "@/lib/constants";
import { translateLabel } from "@/lib/i18n/data-labels";
import { useLocale, useT } from "@/components/providers/locale-provider";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AttendanceStatusBadge } from "@/components/shared/status-badge";
import Link from "next/link";

type Snapshot = Awaited<ReturnType<typeof getDemoSnapshot>>;

function fd(values: Record<string, string>) {
  const f = new FormData();
  Object.entries(values).forEach(([k, v]) => f.append(k, v));
  return f;
}

export function DemoRunner({ initialSnapshot }: { initialSnapshot: Snapshot }) {
  const t = useT();
  const locale = useLocale();
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [stepIndex, setStepIndex] = useState(0);
  const [pending, startTransition] = useTransition();

  async function refresh() {
    const next = await getDemoSnapshot();
    setSnapshot(next);
    return next;
  }

  const steps = [
    { title: t.demo.step1Title, icon: Fingerprint, description: t.demo.step1Desc },
    {
      title: t.demo.step2Title,
      icon: Fingerprint,
      description: t.demo.step2Desc,
      action: async () => {
        const res = await simulatePunch({}, fd({ employeeId: DEMO_EMPLOYEE_ID, punchType: "in", date: DEMO_DATE, time: "08:13", deviceId: DEVICE_ID }));
        if (res.error) throw new Error(res.error);
      },
    },
    { title: t.demo.step3Title, icon: AlertTriangle, description: t.demo.step3Desc },
    {
      title: t.demo.step4Title,
      icon: LogOut,
      description: t.demo.step4Desc,
      action: async () => {
        const res = await simulatePunch({}, fd({ employeeId: DEMO_EMPLOYEE_ID, punchType: "out", date: DEMO_DATE, time: "16:05", deviceId: DEVICE_ID }));
        if (res.error) throw new Error(res.error);
      },
    },
    { title: t.demo.step5Title, icon: CheckCircle2, description: t.demo.step5Desc },
    {
      title: t.demo.step6Title,
      icon: TimerReset,
      description: t.demo.step6Desc,
      action: async () => {
        const rate = Math.round((snapshot.employee.basicSalary / 26 / 8) * 1.5);
        const res = await createOvertime({}, fd({ employeeId: DEMO_EMPLOYEE_ID, date: DEMO_DATE, hours: "1.5", hourlyRate: String(rate), notes: t.demo.title }));
        if (res.error) throw new Error(res.error);
      },
    },
    {
      title: t.demo.step7Title,
      icon: ThumbsUp,
      description: t.demo.step7Desc,
      action: async () => {
        const fresh = await getDemoSnapshot();
        if (!fresh.overtime) throw new Error(t.overtime.noRecords);
        const res = await decideOvertime(fresh.overtime.id, "approved");
        if (res?.error) throw new Error(res.error);
      },
    },
    {
      title: t.demo.step8Title,
      icon: MinusCircle,
      description: t.demo.step8Desc,
      action: async () => {
        const res = await createDeduction({}, fd({ employeeId: DEMO_EMPLOYEE_ID, type: "advance", amount: "500", date: DEMO_DATE, reason: t.demo.title }));
        if (res.error) throw new Error(res.error);
      },
    },
    {
      title: t.demo.step9Title,
      icon: Calculator,
      description: t.demo.step9Desc,
      action: async () => {
        const res = await calculatePayroll(DEMO_PERIOD_ID);
        if (res?.error) throw new Error(res.error);
      },
    },
    { title: t.demo.step10Title, icon: Receipt, description: t.demo.step10Desc },
    { title: t.demo.step11Title, icon: TrendingUp, description: t.demo.step11Desc },
  ];

  const current = steps[stepIndex];
  const isLast = stepIndex === steps.length - 1;

  function handleNext() {
    if (!current.action) {
      setStepIndex((i) => Math.min(i + 1, steps.length - 1));
      return;
    }
    startTransition(async () => {
      try {
        await current.action!();
        await refresh();
        setStepIndex((i) => Math.min(i + 1, steps.length - 1));
        toast.success(`${t.demo.stepDone} ${current.title}`);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : t.validation.invalidData);
      }
    });
  }

  function handleRestart() {
    setStepIndex(0);
    refresh();
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2">
        {steps.map((s, i) => (
          <div
            key={s.title}
            className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold ${
              i < stepIndex ? "bg-success/15 text-success" : i === stepIndex ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
            }`}
          >
            {i + 1}
          </div>
        ))}
      </div>

      <Card>
        <CardContent className="flex flex-col gap-4 p-6">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <current.icon className="h-5 w-5" />
            </div>
            <div>
              <p className="text-lg font-bold text-foreground">{current.title}</p>
              <p className="text-sm text-muted-foreground">{current.description}</p>
            </div>
          </div>

          <DemoStateView snapshot={snapshot} stepIndex={stepIndex} t={t} locale={locale} />

          <div className="flex items-center gap-2">
            {!isLast ? (
              <Button size="lg" disabled={pending} onClick={handleNext} className="gap-2">
                <PlayCircle className="h-4 w-4" />
                {pending ? t.demo.running : t.demo.next}
              </Button>
            ) : (
              <Link href="/workforce-cost">
                <Button size="lg" className="gap-2">
                  <TrendingUp className="h-4 w-4" />
                  {t.demo.openWorkforceCost}
                </Button>
              </Link>
            )}
            <Button variant="outline" onClick={handleRestart} className="gap-2">
              <RotateCcw className="h-4 w-4" />
              {t.demo.restart}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function DemoStateView({
  snapshot, stepIndex, t, locale,
}: {
  snapshot: Snapshot;
  stepIndex: number;
  t: ReturnType<typeof useT>;
  locale: ReturnType<typeof useLocale>;
}) {
  const { employee, department, attendance, overtime, deductions, payrollRecord } = snapshot;
  const timeFmt = (iso: string | null) =>
    iso ? new Date(iso).toLocaleTimeString(locale === "ar" ? "ar-EG" : "en-US", { hour: "2-digit", minute: "2-digit" }) : "—";

  return (
      <div className="grid grid-cols-1 gap-3 rounded-lg bg-muted/40 p-4 sm:grid-cols-2 lg:grid-cols-3">
        <Info label={t.demo.fieldEmployee} value={`${employee.name} — ${employee.id}`} />
        <Info label={t.demo.fieldDepartment} value={translateLabel(department?.name ?? "-", locale)} />

        {stepIndex >= 2 && attendance && (
          <>
            <Info label={t.demo.fieldIn} value={timeFmt(attendance.actualIn)} />
            <div className="flex flex-col gap-0.5">
              <span className="text-xs text-muted-foreground">{t.demo.fieldStatus}</span>
              <AttendanceStatusBadge status={attendance.status} />
            </div>
            {attendance.deductibleLateMinutes > 0 && (
              <Info label={t.demo.fieldDeductibleLate} value={`${attendance.deductibleLateMinutes} ${t.common.minutes}`} />
            )}
          </>
        )}

        {stepIndex >= 4 && attendance?.actualOut && (
          <>
            <Info label={t.demo.fieldOut} value={timeFmt(attendance.actualOut)} />
            <Info label={t.demo.fieldWorkedHours} value={`${(attendance.workedMinutes / 60).toFixed(1)} ${t.common.hours}`} />
          </>
        )}

        {stepIndex >= 6 && overtime && (
          <Info
            label={t.demo.fieldOvertime}
            value={`${overtime.hours} ${t.common.hours} — ${formatEGP(overtime.amount, locale)}`}
            extra={<Badge variant={overtime.status === "approved" ? "success" : "warning"}>{overtime.status === "approved" ? t.demo.approved : t.demo.pending}</Badge>}
          />
        )}

        {stepIndex >= 8 && deductions.length > 0 && (
          <Info label={t.demo.fieldDeductionsAdded} value={formatEGP(deductions.reduce((s, d) => s + d.amount, 0), locale)} />
        )}

        {stepIndex >= 9 && payrollRecord && (
          <>
            <Info label={t.demo.fieldGross} value={formatEGP(payrollRecord.grossSalary, locale)} />
            <Info label={t.demo.fieldTotalDeductions} value={formatEGP(payrollRecord.totalDeductions, locale)} />
            <Info label={t.demo.fieldNetSalary} value={formatEGP(payrollRecord.netSalary, locale)} accent />
          </>
        )}
      </div>
  );
}

function Info({ label, value, accent, extra }: { label: string; value: string; accent?: boolean; extra?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="flex items-center gap-2">
        <span className={`font-semibold tabular-nums ${accent ? "text-primary text-base" : "text-foreground"}`}>{value}</span>
        {extra}
      </div>
    </div>
  );
}
