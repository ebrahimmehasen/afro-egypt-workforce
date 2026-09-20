"use client";

import { useState } from "react";
import { Download, Eye, ExternalLink } from "lucide-react";
import { useT } from "@/components/providers/locale-provider";
import { ImageViewer } from "@/components/employees/image-viewer";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

function kindOf(url: string, mime?: string): "image" | "pdf" | "other" {
  const m = (mime ?? "").toLowerCase();
  const u = url.toLowerCase();
  if (m.startsWith("image/") || /\.(jpe?g|png|webp|gif|bmp)$/.test(u)) return "image";
  if (m === "application/pdf" || u.endsWith(".pdf")) return "pdf";
  return "other";
}

/** Preview (in a dialog) + download buttons for an uploaded file. */
export function FilePreview({
  url,
  name,
  mime,
}: {
  url: string;
  name?: string;
  mime?: string;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const kind = kindOf(url, mime);
  const filename = name ?? url.split("/").pop() ?? "file";

  return (
    <>
      <Button size="icon" variant="ghost" aria-label={t.filePreview.view} onClick={() => setOpen(true)}>
        <Eye className="h-4 w-4" />
      </Button>
      <Button asChild size="icon" variant="ghost" aria-label={t.filePreview.download}>
        <a href={url} download={filename}>
          <Download className="h-4 w-4" />
        </a>
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle className="truncate pe-8 text-start">{filename}</DialogTitle>
          </DialogHeader>

          {/* images get zoom / rotate / drag here; a PDF keeps the browser's own viewer, which has those tools built in */}
          {kind === "image" && <ImageViewer src={url} alt={filename} />}
          {kind === "pdf" && (
            <div className="overflow-hidden rounded-lg border border-border bg-muted/30">
              <iframe src={url} title={filename} className="h-[calc(90vh-14rem)] min-h-64 w-full" />
            </div>
          )}
          {kind === "other" && (
            <div className="flex items-center justify-center rounded-lg border border-border bg-muted/30">
              <p className="p-10 text-sm text-muted-foreground">{t.filePreview.noPreview}</p>
            </div>
          )}

          <div className="flex items-center justify-end gap-2">
            <Button asChild variant="outline" size="sm" className="gap-1.5">
              <a href={url} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-4 w-4" />
                {t.filePreview.openTab}
              </a>
            </Button>
            <Button asChild size="sm" className="gap-1.5">
              <a href={url} download={filename}>
                <Download className="h-4 w-4" />
                {t.filePreview.download}
              </a>
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
