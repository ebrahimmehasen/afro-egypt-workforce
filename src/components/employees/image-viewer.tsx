"use client";

import { useEffect, useRef, useState } from "react";
import { Maximize2, RotateCcw, RotateCw, ZoomIn, ZoomOut } from "lucide-react";
import { useT } from "@/components/providers/locale-provider";
import { Button } from "@/components/ui/button";
import {
  INITIAL_VIEW,
  ImageView,
  ZOOM_STEP,
  clampOffset,
  fitScale,
  turn,
  zoomAt,
} from "@/lib/image-view";

/**
 * Zoom, rotate and drag an image without leaving the dialog. The image is laid out at its
 * natural size in the middle of the viewport and moved with one CSS transform, so every
 * tool is instant and nothing is re-fetched.
 */
export function ImageViewer({ src, alt }: { src: string; alt: string }) {
  const t = useT();
  const boxRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ px: number; py: number; x: number; y: number } | null>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [view, setView] = useState<ImageView>(INITIAL_VIEW);
  const [dragging, setDragging] = useState(false);

  const fit = natural ? fitScale(box.w, box.h, natural.w, natural.h, view.rotation) : 1;
  const scale = fit * view.zoom;

  // The wheel handlers below run outside React's render, so they read the latest geometry from a ref.
  const geom = useRef({ box, natural, fit });
  geom.current = { box, natural, fit };

  /** Bounding size of the image on screen at `zoom`, given its current rotation. */
  function visualSize(zoom: number, rotation: number) {
    const { natural: n, fit: f } = geom.current;
    if (!n) return { w: 0, h: 0 };
    const sideways = rotation % 180 !== 0;
    return { w: (sideways ? n.h : n.w) * f * zoom, h: (sideways ? n.w : n.h) * f * zoom };
  }

  function constrain(next: ImageView): ImageView {
    const { box: b } = geom.current;
    const v = visualSize(next.zoom, next.rotation);
    return { ...next, ...clampOffset(next.x, next.y, b.w, b.h, v.w, v.h) };
  }

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Non-passive so the wheel zooms the image instead of scrolling the dialog behind it.
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const px = e.clientX - rect.left - rect.width / 2;
      const py = e.clientY - rect.top - rect.height / 2;
      const factor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
      setView((v) => constrain(zoomAt(v, factor, px, py)));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const zoomBy = (factor: number) => setView((v) => constrain(zoomAt(v, factor, 0, 0)));
  const rotateBy = (dir: 1 | -1) => setView((v) => constrain({ ...v, rotation: turn(v.rotation, dir) }));

  return (
    <div className="flex flex-col gap-2">
      {/* dir=ltr so "left" / "minus" always sit on the left, matching their icons, in both languages */}
      <div dir="ltr" className="flex flex-wrap items-center justify-center gap-1.5">
        <Button size="icon" variant="outline" aria-label={t.filePreview.rotateLeft} title={t.filePreview.rotateLeft} onClick={() => rotateBy(-1)}>
          <RotateCcw className="h-4 w-4" />
        </Button>
        <Button size="icon" variant="outline" aria-label={t.filePreview.rotateRight} title={t.filePreview.rotateRight} onClick={() => rotateBy(1)}>
          <RotateCw className="h-4 w-4" />
        </Button>
        <span className="mx-1 h-5 w-px bg-border" />
        <Button size="icon" variant="outline" aria-label={t.filePreview.zoomOut} title={t.filePreview.zoomOut} onClick={() => zoomBy(1 / ZOOM_STEP)}>
          <ZoomOut className="h-4 w-4" />
        </Button>
        <span className="min-w-12 text-center text-xs tabular-nums text-muted-foreground">{Math.round(view.zoom * 100)}%</span>
        <Button size="icon" variant="outline" aria-label={t.filePreview.zoomIn} title={t.filePreview.zoomIn} onClick={() => zoomBy(ZOOM_STEP)}>
          <ZoomIn className="h-4 w-4" />
        </Button>
        <span className="mx-1 h-5 w-px bg-border" />
        <Button size="icon" variant="outline" aria-label={t.filePreview.resetView} title={t.filePreview.resetView} onClick={() => setView(INITIAL_VIEW)}>
          <Maximize2 className="h-4 w-4" />
        </Button>
      </div>

      <div
        ref={boxRef}
        className={`relative h-[calc(90vh-16rem)] min-h-64 touch-none select-none overflow-hidden rounded-lg border border-border bg-muted/30 ${
          dragging ? "cursor-grabbing" : "cursor-grab"
        }`}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          dragRef.current = { px: e.clientX, py: e.clientY, x: view.x, y: view.y };
          setDragging(true);
        }}
        onPointerMove={(e) => {
          const d = dragRef.current;
          if (!d) return;
          setView((v) => constrain({ ...v, x: d.x + e.clientX - d.px, y: d.y + e.clientY - d.py }));
        }}
        onPointerUp={() => {
          dragRef.current = null;
          setDragging(false);
        }}
        onPointerCancel={() => {
          dragRef.current = null;
          setDragging(false);
        }}
        onDoubleClick={() => setView((v) => (v.zoom > 1 ? { ...v, zoom: 1, x: 0, y: 0 } : constrain(zoomAt(v, 2.5, 0, 0))))}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt}
          draggable={false}
          onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
          // physical `left` (not `start`), so the centring maths is identical in rtl and ltr
          className="pointer-events-none absolute left-1/2 top-1/2 max-w-none"
          style={
            natural
              ? {
                  width: natural.w,
                  height: natural.h,
                  transform: `translate(calc(-50% + ${view.x}px), calc(-50% + ${view.y}px)) scale(${scale}) rotate(${view.rotation}deg)`,
                }
              : { visibility: "hidden" }
          }
        />
      </div>
      <p className="text-center text-xs text-muted-foreground">{t.filePreview.panHint}</p>
    </div>
  );
}
