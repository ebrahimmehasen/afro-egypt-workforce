import { describe, expect, it } from "vitest";
import {
  INITIAL_VIEW,
  MAX_ZOOM,
  MIN_ZOOM,
  clampOffset,
  clampZoom,
  fitScale,
  turn,
  zoomAt,
} from "@/lib/image-view";

describe("turn", () => {
  it("goes clockwise and counter-clockwise in quarter turns", () => {
    expect(turn(0, 1)).toBe(90);
    expect(turn(270, 1)).toBe(0);
    expect(turn(0, -1)).toBe(270);
    expect(turn(90, -1)).toBe(0);
  });

  it("returns to the start after four turns either way", () => {
    let r = 0;
    for (let i = 0; i < 4; i++) r = turn(r, 1);
    expect(r).toBe(0);
    for (let i = 0; i < 4; i++) r = turn(r, -1);
    expect(r).toBe(0);
  });
});

describe("fitScale", () => {
  it("fits a wide image by its width", () => {
    expect(fitScale(800, 600, 1600, 1000, 0)).toBe(0.5);
  });

  it("swaps the image's sides when it is turned sideways", () => {
    // 1600x1000 rotated 90° is 1000 wide x 1600 tall → height limits it
    expect(fitScale(800, 600, 1600, 1000, 90)).toBe(0.375);
    expect(fitScale(800, 600, 1600, 1000, 180)).toBe(0.5);
    expect(fitScale(800, 600, 1600, 1000, 270)).toBe(0.375);
  });

  it("falls back to 1 before the sizes are known", () => {
    expect(fitScale(0, 0, 0, 0, 0)).toBe(1);
  });
});

describe("zoomAt", () => {
  it("clamps the zoom to its bounds", () => {
    expect(clampZoom(100)).toBe(MAX_ZOOM);
    expect(clampZoom(0.001)).toBe(MIN_ZOOM);
  });

  it("scales about the centre for the buttons", () => {
    const v = zoomAt({ ...INITIAL_VIEW, x: 40, y: -20 }, 2, 0, 0);
    expect(v.zoom).toBe(2);
    expect(v.x).toBe(80);
    expect(v.y).toBe(-40);
  });

  it("keeps the point under the cursor fixed", () => {
    // a point at (100, 50) on screen, view currently at the origin
    const v = zoomAt(INITIAL_VIEW, 2, 100, 50);
    // content point under the cursor before: (100, 50); after: (100 - x)/zoom
    expect((100 - v.x) / v.zoom).toBeCloseTo(100);
    expect((50 - v.y) / v.zoom).toBeCloseTo(50);
  });

  it("does not drift once the zoom limit is hit", () => {
    const atMax = { ...INITIAL_VIEW, zoom: MAX_ZOOM, x: 12, y: 34 };
    expect(zoomAt(atMax, 2, 200, 100)).toEqual(atMax);
  });

  it("leaves the rotation alone", () => {
    expect(zoomAt({ ...INITIAL_VIEW, rotation: 90 }, 1.25, 0, 0).rotation).toBe(90);
  });
});

describe("clampOffset", () => {
  it("lets a small image sit near the edge but not leave", () => {
    // viewport 800x600, image 200x100 → may move until 48px of it remains
    expect(clampOffset(9999, 9999, 800, 600, 200, 100)).toEqual({ x: 452, y: 302 });
    expect(clampOffset(-9999, -9999, 800, 600, 200, 100)).toEqual({ x: -452, y: -302 });
  });

  it("leaves in-range offsets untouched", () => {
    expect(clampOffset(10, -10, 800, 600, 200, 100)).toEqual({ x: 10, y: -10 });
  });
});
