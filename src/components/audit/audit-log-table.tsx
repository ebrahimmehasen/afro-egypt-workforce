"use client";

import { useMemo, useState } from "react";
import { Search, History } from "lucide-react";
import { AuditLogEntry } from "@/lib/types";
import { Input } from "@/components/ui/input";
import { MultiSelectFilter } from "@/components/shared/multi-select-filter";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/shared/empty-state";
import { useLocale, useT } from "@/components/providers/locale-provider";
import { intlLocale } from "@/lib/i18n/format";

export function AuditLogTable({ entries }: { entries: AuditLogEntry[] }) {
  const t = useT();
  const locale = useLocale();
  const [search, setSearch] = useState("");
  const [module, setModule] = useState<string[]>([]);

  const modules = useMemo(() => Array.from(new Set(entries.map((e) => e.module))), [entries]);

  const rows = useMemo(() => {
    return entries.filter((e) => {
      const matchesModule = module.length === 0 || module.includes(e.module);
      const matchesSearch =
        !search ||
        e.userName.toLowerCase().includes(search.toLowerCase()) ||
        e.action.toLowerCase().includes(search.toLowerCase());
      return matchesModule && matchesSearch;
    });
  }, [entries, search, module]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder={t.auditLog.searchPlaceholder} className="ps-9" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <MultiSelectFilter
          className="sm:w-56"
          placeholder={t.auditLog.allModules}
          selected={module}
          onChange={setModule}
          options={modules.map((m) => ({ value: m, label: m }))}
        />
      </div>

      {rows.length === 0 ? (
        <EmptyState icon={History} title={t.auditLog.noEntries} />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t.auditLog.colUser}</TableHead>
                <TableHead>{t.auditLog.colAction}</TableHead>
                <TableHead>{t.auditLog.colModule}</TableHead>
                <TableHead>{t.auditLog.colOldValue}</TableHead>
                <TableHead>{t.auditLog.colNewValue}</TableHead>
                <TableHead>{t.auditLog.colReason}</TableHead>
                <TableHead>{t.auditLog.colTimestamp}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="font-medium">{e.userName}</TableCell>
                  <TableCell>{e.action}</TableCell>
                  <TableCell className="text-muted-foreground">{e.module}</TableCell>
                  <TableCell className="max-w-[160px] truncate text-muted-foreground">{e.oldValue}</TableCell>
                  <TableCell className="max-w-[160px] truncate">{e.newValue}</TableCell>
                  <TableCell className="max-w-[200px] truncate text-muted-foreground">{e.reason ?? "—"}</TableCell>
                  <TableCell dir="ltr" className="tabular-nums text-xs text-muted-foreground">
                    {new Date(e.timestamp).toLocaleString(intlLocale(locale))}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
