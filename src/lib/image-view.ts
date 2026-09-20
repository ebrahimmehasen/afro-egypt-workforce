// Pure maths behind the document image viewer (zoom / rotate / pan). Offsets are in
// screen pixels measured from the centre of the viewport.

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 8;
export const ZOOM_STEP = 1.25;

export interface ImageView {
  /** Multiplier on top of the "fit to viewport" size — 1 means the whole image is visible. */
  zoom: number;
  x: number;
  y: number;
  /** Clockwise degrees, always one of 0 / 90 / 180 / 270. */
  rotation: number;
}

export const INITIAL_VIEW: ImageView = { zoom: 1, x: 0, y: 0, rotation: 0 };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function clampZoom(zoom: number): number {
  return clamp(zoom, MIN_ZOOM, MAX_ZOOM);
}

/** One quarter turn: +1 clockwise (right), -1 counter-clockwise (left). */
export function turn(rotation: number, direction: 1 | -1): number {
  return (((rotation + direction * 90) % 360) + 360) % 360;
}

/** The scale that fits the whole (possibly sideways) image inside the viewport. */
export function fitScale(viewW: number, viewH: number, imgW: number, imgH: number, rotation: number): number {
  if (!viewW || !viewH || !imgW || !imgH) return 1;
  const sideways = rotation % 180 !== 0;
  const w = sideways ? imgH : imgW;
  const h = sideways ? imgW : imgH;
  return Math.min(viewW / w, viewH / h);
}

/** Zoom by `factor` keeping the point under (px, py) fixed — the viewport centre for the buttons. */
export function zoomAt(view: ImageView, factor: number, px: number, py: number): ImageView {
  const zoom = clampZoom(view.zoom * factor);
  const ratio = zoom / view.zoom;
  return { ...view, zoom, x: px - (px - view.x) * ratio, y: py - (py - view.y) * ratio };
}

/** Keep at least `margin` px of the image inside the viewport so it can't be dragged out of reach. */
export function clampOffset(
  x: number,
  y: number,
  viewW: number,
  viewH: number,
  visualW: number,
  visualH: number,
  margin = 48,
): { x: number; y: number } {
  const maxX = Math.max(0, visualW / 2 + viewW / 2 - margin);
  const maxY = Math.max(0, visualH / 2 + viewH / 2 - margin);
  return { x: clamp(x, -maxX, maxX), y: clamp(y, -maxY, maxY) };
}
