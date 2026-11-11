import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { APP_TIME_ZONE } from "@/lib/i18n/format";

/**
 * Every time the app shows is Egypt's. A date-time format without a `timeZone` uses the zone of whatever device
 * renders it, so the same punch read 08:00 on one screen and 09:00 on another set an hour off. This keeps every
 * such format in src/ naming its zone.
 */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

// the calls that turn a moment into text in some time zone; toLocaleString() on a number is not one
const DATE_FORMAT = /toLocaleTimeString\(|toLocaleDateString\(|toLocaleString\(intlLocale|new Intl\.DateTimeFormat\(/g;

describe("times are shown in Egypt's time zone", () => {
  it("every date-time format in src/ names its time zone", () => {
    const missing: string[] = [];
    for (const file of sourceFiles(join(__dirname, "..", "src"))) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(DATE_FORMAT)) {
        // the call and its options, up to where the format is used
        const call = text.slice(match.index, match.index + 400).split(/\.format\(|;\n/)[0];
        if (!call.includes("timeZone")) missing.push(`${file}:${text.slice(0, match.index).split("\n").length}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("one moment reads the same whatever zone the device is in", () => {
    const punch = "2026-11-10T06:00:00.000Z"; // 08:00 in Cairo (UTC+2 since summer time ended)
    const fmt = (tz?: string) => new Date(punch).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: tz });
    expect(fmt(APP_TIME_ZONE)).toBe("08:00");
    // what a device set to Riyadh showed before: an hour off
    expect(fmt("Asia/Riyadh")).toBe("09:00");
  });
});
