"use client";

import { useEffect, useState } from "react";
import { useT } from "@/components/providers/locale-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { format } from "@/lib/i18n/format";
import { PRESET_DURATIONS, durationFromUntil } from "@/lib/permission-duration";

type Mode = "preset" | "custom" | "until";

/**
 * How long a timed permission lasts: quick choices first, then any number of minutes, or the time the employee
 * will be back (turned into minutes from the time they leave). It posts `durationMinutes`, or `untilTime` for the
 * last way — the server turns that into minutes too and refuses a time that is not later than the departure.
 * `onMinutesChange` reports the minutes the choice comes to (null while there are none yet).
 */
export function PermissionDurationPicker({
  startTime,
  defaultMinutes,
  onMinutesChange,
}: {
  startTime: string;
  defaultMinutes?: number;
  onMinutesChange?: (minutes: number | null) => void;
}) {
  const t = useT();
  const l = t.leaves;
  const startsOnPreset = defaultMinutes !== undefined && (PRESET_DURATIONS as readonly number[]).includes(defaultMinutes);
  const [mode, setMode] = useState<Mode>(defaultMinutes !== undefined && !startsOnPreset ? "custom" : "preset");
  const [preset, setPreset] = useState<number | null>(startsOnPreset ? (defaultMinutes ?? null) : null);
  const [custom, setCustom] = useState(defaultMinutes !== undefined && !startsOnPreset ? String(defaultMinutes) : "");
  const [until, setUntil] = useState("");

  const untilResult = mode === "until" && until && startTime ? durationFromUntil(startTime, until) : null;
  const minutes =
    mode === "preset" ? preset : mode === "custom" ? (Number(custom) > 0 ? Number(custom) : null) : untilResult?.ok ? untilResult.minutes : null;
  useEffect(() => {
    onMinutesChange?.(minutes);
  }, [minutes, onMinutesChange]);

  return (
    <div className="flex flex-col gap-2">
      <Label>{l.durationPresetsLabel}</Label>
      <div className="flex flex-wrap gap-2">
        {PRESET_DURATIONS.map((m) => (
          <Button
            key={m}
            type="button"
            size="sm"
            variant={mode === "preset" && preset === m ? "default" : "outline"}
            onClick={() => {
              setMode("preset");
              setPreset(m);
            }}
          >
            {format(l.presetMinutes, { minutes: m })}
          </Button>
        ))}
        <Button type="button" size="sm" variant={mode === "custom" ? "default" : "outline"} onClick={() => setMode("custom")}>
          {l.durationCustom}
        </Button>
        <Button type="button" size="sm" variant={mode === "until" ? "default" : "outline"} onClick={() => setMode("until")}>
          {l.durationUntil}
        </Button>
      </div>

      {mode === "preset" && <input type="hidden" name="durationMinutes" value={preset ?? ""} />}
      {mode === "custom" && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="durationMinutes">{l.formDuration}</Label>
          <Input id="durationMinutes" name="durationMinutes" type="number" min={1} max={1440} step={1} dir="ltr" value={custom} onChange={(e) => setCustom(e.target.value)} required />
        </div>
      )}
      {mode === "until" && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="untilTime">{l.formUntilTime}</Label>
          <Input id="untilTime" name="untilTime" type="time" dir="ltr" value={until} onChange={(e) => setUntil(e.target.value)} required />
          {untilResult && !untilResult.ok && (
            <p role="alert" className="text-xs text-destructive">
              {untilResult.reason === "not_later" ? l.errUntilNotLater : l.errUntilInvalid}
            </p>
          )}
          {untilResult?.ok && <p className="text-xs text-muted-foreground">{format(l.untilResult, { minutes: untilResult.minutes })}</p>}
        </div>
      )}
    </div>
  );
}
