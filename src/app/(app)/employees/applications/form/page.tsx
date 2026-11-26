import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAccess } from "@/lib/auth";
import { canManageApplications } from "@/lib/permissions";
import { getT } from "@/lib/i18n";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { FormBuilder, type BuilderField } from "@/components/recruitment/form-builder";
import { loadFormConfig } from "@/lib/recruitment/data";

export default async function ApplicationFormPage() {
  const user = await requireAccess("/employees");
  // only the admin, or HR with the employees grant, may edit what the public form asks
  if (!canManageApplications(user)) redirect("/employees");
  const t = await getT();
  const config = await loadFormConfig();
  const fields: BuilderField[] = config.map((f) => ({
    key: f.key,
    labelAr: f.labelAr,
    labelEn: f.labelEn,
    type: f.type,
    required: f.required,
    visible: f.visible,
    sortOrder: f.sortOrder,
    builtin: f.builtin,
    custom: f.custom,
    optionsText: f.options.map((o) => `${o.ar} | ${o.en}`).join("\n"),
  }));

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={t.recruitment.admin.form.title}
        description={t.recruitment.admin.form.intro}
        actions={<Button asChild variant="outline"><Link href="/employees/applications">{t.recruitment.admin.back}</Link></Button>}
      />
      <FormBuilder fields={fields} />
    </div>
  );
}
