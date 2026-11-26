import Image from "next/image";
import type { Metadata } from "next";
import { COMPANY } from "@/lib/constants";
import { getDictionary } from "@/lib/i18n";
import { format } from "@/lib/i18n/format";
import { getLocale } from "@/lib/i18n/locale";
import { LanguageSwitcher } from "@/components/shared/language-switcher";
import { ApplyForm, type ApplyFieldView } from "@/components/recruitment/apply-form";
import { loadFormConfig, loadOpenJobs, type PublicJob } from "@/lib/recruitment/data";
import { visibleFields } from "@/lib/recruitment/form-config";

// The public page (no login). It reads only the open jobs and the form configuration, through the whitelisted loaders in
// src/lib/recruitment/data.ts: nothing from the HR system reaches it. Read at request time, so a change HR makes shows at once.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Afro Egypt | Apply", robots: { index: false } };

const money = (n: number, locale: string) => n.toLocaleString(locale === "ar" ? "ar-EG" : "en-US");

function salaryText(job: PublicJob, a: ReturnType<typeof getDictionary>["recruitment"]["apply"], locale: string): string | null {
  if (!job.salary) return null;
  const { min, max } = job.salary;
  if (min !== null && max !== null) return format(a.salaryRange, { min: money(min, locale), max: money(max, locale) });
  if (min !== null) return format(a.salaryFrom, { min: money(min, locale) });
  return max !== null ? format(a.salaryUpTo, { max: money(max, locale) }) : null;
}

export default async function ApplyPage() {
  const locale = await getLocale();
  const t = getDictionary(locale);
  const a = t.recruitment.apply;
  const [jobs, config] = await Promise.all([loadOpenJobs(), loadFormConfig()]);

  const fields: ApplyFieldView[] = visibleFields(config).map((f) => ({
    key: f.key,
    label: locale === "ar" ? f.labelAr : f.labelEn,
    type: f.type,
    required: f.required,
    options: f.options.map((o) => ({ value: o.value, label: locale === "ar" ? o.ar : o.en })),
  }));

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <Image src={COMPANY.logo} alt="Afro Egypt" width={88} height={44} priority />
          </div>
          <LanguageSwitcher variant="outline" />
        </div>
      </header>
      <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-8">
        <div>
          <h1 className="text-2xl font-extrabold">{a.pageTitle}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{a.subtitle}</p>
        </div>
        <ApplyForm jobs={jobs.map((j) => ({ id: j.id, title: j.title, description: j.description, salaryText: salaryText(j, a, locale) }))} fields={fields} />
      </main>
    </div>
  );
}
