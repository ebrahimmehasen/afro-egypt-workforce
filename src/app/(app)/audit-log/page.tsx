import { getAuditLog } from "@/lib/data";
import { requireAccess } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { PageHeader } from "@/components/shared/page-header";
import { AuditLogTable } from "@/components/audit/audit-log-table";

export default async function AuditLogPage() {
  await requireAccess("/audit-log");
  const [entries, t] = await Promise.all([getAuditLog(), getT()]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t.auditLog.title} description={t.auditLog.description} />
      <AuditLogTable entries={entries} />
    </div>
  );
}
