import { getDb } from "@/lib/data";
import { requireAccess } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { PageHeader } from "@/components/shared/page-header";
import { AuditLogTable } from "@/components/audit/audit-log-table";

export default async function AuditLogPage() {
  await requireAccess("/audit-log");
  const db = await getDb();
  const t = await getT();
  const entries = [...db.auditLog].sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t.auditLog.title} description={t.auditLog.description} />
      <AuditLogTable entries={entries} />
    </div>
  );
}
