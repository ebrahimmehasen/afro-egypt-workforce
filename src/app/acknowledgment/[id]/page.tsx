import { notFound, redirect } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { inScope, viewerScope } from "@/lib/scope";
import { COMPANY } from "@/lib/constants";
import { getT } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n/locale";
import { intlLocale } from "@/lib/i18n/format";
import { acknowledgmentTypeLabel } from "@/lib/acknowledgments";
import { Separator } from "@/components/ui/separator";
import { PrintButton } from "@/components/payroll/print-button";

export default async function AcknowledgmentPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getSession();
  if (!user) redirect("/login");

  const { id } = await params;
  const t = await getT();
  const locale = await getLocale();

  const ack = await prisma.employeeAcknowledgment.findUnique({
    where: { id },
    include: { employee: { include: { department: true } } },
  });
  if (!ack) notFound();

  const roster = await prisma.employee.findMany({ where: { deletedAt: null }, select: { id: true, departmentId: true } });
  if (!inScope(viewerScope(user, roster), ack.employeeId)) notFound();

  const dateFmt = (d: Date) => d.toLocaleDateString(intlLocale(locale), { year: "numeric", month: "long", day: "numeric" });

  return (
    <div className="min-h-screen bg-muted/30 py-8">
      <div className="mx-auto flex max-w-2xl flex-col gap-4 px-4">
        <div className="flex items-center justify-between no-print">
          <Link href={`/employees/${ack.employeeId}`} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
            <ArrowRight className="h-4 w-4 rtl:rotate-180" />
            {t.acknowledgments.back}
          </Link>
          <PrintButton />
        </div>

        <div className="rounded-2xl border border-border bg-white p-8 shadow-elevated print:border-none print:shadow-none">
          <div className="flex items-center justify-between border-b border-border pb-6">
            <div className="flex items-center gap-3">
              <div className="relative h-14 w-14 overflow-hidden rounded-lg bg-white ring-1 ring-border">
                <Image src={COMPANY.logo} alt={COMPANY.name} fill className="object-contain p-1" />
              </div>
              <div>
                <p className="text-lg font-extrabold text-foreground">{COMPANY.name}</p>
                <p className="text-xs text-muted-foreground">{COMPANY.productName}</p>
              </div>
            </div>
            <p className="text-lg font-bold text-foreground">{acknowledgmentTypeLabel(ack.type, t)}</p>
          </div>

          <div className="grid grid-cols-2 gap-4 border-b border-border py-6 text-sm">
            <Field label={t.employees.colName} value={ack.employee.name} />
            <Field label={t.employees.colId} value={ack.employee.id} />
            <Field label={t.employees.colDepartment} value={ack.employee.department?.name ?? "-"} />
            <Field label={t.acknowledgments.generatedAt} value={dateFmt(ack.generatedAt)} />
          </div>

          <p className="whitespace-pre-line py-6 text-sm leading-8 text-foreground">{ack.title}</p>

          <Separator className="my-2" />

          <div className="mt-10 grid grid-cols-2 gap-8 text-sm">
            <div>
              <p className="text-muted-foreground">{t.acknowledgments.employeeSignature}</p>
              <div className="mt-10 border-t border-dashed border-border pt-1 text-xs text-muted-foreground">
                {t.acknowledgments.nameAndSignature}
              </div>
            </div>
            <div>
              <p className="text-muted-foreground">{t.acknowledgments.date}</p>
              <div className="mt-10 border-t border-dashed border-border pt-1 text-xs text-muted-foreground">
                &nbsp;
              </div>
            </div>
          </div>

          <div className="mt-8 flex items-center justify-between border-t border-dashed border-border pt-4 text-[11px] text-muted-foreground">
            <span>{COMPANY.name}</span>
            <span className="italic">{COMPANY.slogan}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground">{value}</span>
    </div>
  );
}
