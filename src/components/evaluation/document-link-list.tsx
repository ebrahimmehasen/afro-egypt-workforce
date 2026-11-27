import { FileText } from "lucide-react";
import { FilePreview } from "@/components/employees/file-preview";
import type { EmployeeDocumentLink } from "@/lib/evaluation/data";

/** Read-only list of document links, each served through the EXISTING authorized route the id already came from — no copy, no new storage. */
export function DocumentLinkList({ documents }: { documents: EmployeeDocumentLink[] }) {
  return (
    <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
      {documents.map((d) => (
        <li key={d.id} className="flex items-center justify-between gap-2 px-3 py-2">
          <span className="flex min-w-0 items-center gap-2 text-sm">
            <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="truncate">{d.fileName ?? d.id}</span>
          </span>
          <FilePreview url={d.url} name={d.fileName ?? undefined} mime={d.mimeType ?? undefined} />
        </li>
      ))}
    </ul>
  );
}
