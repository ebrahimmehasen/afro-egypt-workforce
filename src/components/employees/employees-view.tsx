"use client";

import { useState } from "react";
import { Archive, Users } from "lucide-react";
import { Employee, Department, Shift } from "@/lib/types";
import { format } from "@/lib/i18n/format";
import { useT } from "@/components/providers/locale-provider";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/page-header";
import { EmployeesTable } from "@/components/employees/employees-table";

/**
 * The /employees page body: header, the "المؤرشفون" switch and the table. Which list is showing is a client
 * state, not a URL, so flipping it keeps the table's search and filters, and the same table instance simply
 * receives the other group of employees. The server decides who is archived (see isArchived) and sends the ids.
 */
export function EmployeesView({
  employees,
  archivedIds,
  departments,
  shifts,
  incompleteDocIds,
  photoUrls,
  headerActions,
}: {
  employees: Employee[];
  archivedIds: string[];
  departments: Department[];
  shifts: Shift[];
  incompleteDocIds: string[];
  photoUrls: Record<string, string>;
  /** The page's own buttons (add employee), rendered on the server. */
  headerActions?: React.ReactNode;
}) {
  const t = useT();
  const [showArchived, setShowArchived] = useState(false);

  const archived = new Set(archivedIds);
  const visible = employees.filter((e) => archived.has(e.id) === showArchived);

  return (
    <>
      <PageHeader
        title={showArchived ? t.employees.archivedViewTitle : t.employees.title}
        description={format(t.employees.totalCount, { count: visible.length })}
        actions={
          <>
            <Button
              variant={showArchived ? "default" : "outline"}
              className="gap-2"
              aria-pressed={showArchived}
              onClick={() => setShowArchived((v) => !v)}
            >
              {showArchived ? <Users className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
              {showArchived ? t.employees.backToActiveList : `${t.employees.archivedFilter} (${archived.size})`}
            </Button>
            {/* `contents` keeps the buttons laid out as siblings; the wrapper stops React asking for a key on the
                server-rendered element, which it can't see through when it sits next to another child */}
            <div className="contents">{headerActions}</div>
          </>
        }
      />
      <EmployeesTable
        employees={visible}
        departments={departments}
        shifts={shifts}
        incompleteDocIds={incompleteDocIds}
        photoUrls={photoUrls}
      />
    </>
  );
}
