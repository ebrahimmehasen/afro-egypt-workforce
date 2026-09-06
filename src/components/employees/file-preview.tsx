"use client";

import { useState } from "react";
import { Download, Eye, ExternalLink } from "lucide-react";
import { useT } from "@/components/providers/locale-provider";
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
      <a href={url} download={filename}>
        <Button size="icon" variant="ghost" aria-label={t.filePreview.download}>
          <Download className="h-4 w-4" />
        </Button>
      </a>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="truncate pe-8 text-start">{filename}</DialogTitle>
          </DialogHeader>

          <div className="flex max-h-[72vh] items-center justify-center overflow-auto rounded-lg border border-border bg-muted/30">
            {kind === "image" && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={url} alt={filename} className="max-h-[72vh] w-auto object-contain" />
            )}
            {kind === "pdf" && (
              <iframe src={url} title={filename} className="h-[72vh] w-full" />
            )}
            {kind === "other" && (
              <p className="p-10 text-sm text-muted-foreground">{t.filePreview.noPreview}</p>
            )}
          </div>

          <div className="flex items-center justify-end gap-2">
            <a href={url} target="_blank" rel="noopener noreferrer">
              <Button variant="outline" size="sm" className="gap-1.5">
                <ExternalLink className="h-4 w-4" />
                {t.filePreview.openTab}
              </Button>
            </a>
            <a href={url} download={filename}>
              <Button size="sm" className="gap-1.5">
                <Download className="h-4 w-4" />
                {t.filePreview.download}
              </Button>
            </a>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
