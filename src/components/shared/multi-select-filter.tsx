"use client";

import { useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useT } from "@/components/providers/locale-provider";
import { format } from "@/lib/i18n/format";
import { cn } from "@/lib/utils";

export interface MultiSelectOption {
  value: string;
  label: string;
}

/**
 * Checkbox-list filter: an empty `selected` means "all" (no filtering), matching
 * the previous single-select "all" sentinel — every list this replaced treated
 * an empty/"all" selection as "don't filter", so callers can keep that logic,
 * just checking `selected.includes(x)` instead of `x === value`.
 */
export function MultiSelectFilter({
  options,
  selected,
  onChange,
  placeholder,
  className,
  searchable = false,
}: {
  options: MultiSelectOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
  className?: string;
  searchable?: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const filteredOptions = useMemo(() => {
    if (!searchable || !query.trim()) return options;
    const q = query.trim().toLowerCase();
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query, searchable]);

  const toggle = (value: string) => {
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);
  };

  const label =
    selected.length === 0
      ? placeholder
      : selected.length === 1
        ? (options.find((o) => o.value === selected[0])?.label ?? placeholder)
        : format(t.common.selectedCount, { count: selected.length });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "h-10 justify-between gap-2 font-normal",
            selected.length === 0 && "text-muted-foreground",
            className,
          )}
        >
          <span className="truncate">{label}</span>
          <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-2" align="start">
        {searchable && (
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t.common.search}
            className="mb-2 h-9"
          />
        )}
        <div className="flex items-center justify-between px-1 pb-2 text-xs">
          <button
            type="button"
            className="font-medium text-primary hover:underline"
            onClick={() => onChange(options.map((o) => o.value))}
          >
            {t.common.selectAll}
          </button>
          <button
            type="button"
            className="text-muted-foreground hover:underline"
            onClick={() => onChange([])}
          >
            {t.common.clearAll}
          </button>
        </div>
        <div className="flex max-h-64 flex-col gap-0.5 overflow-y-auto">
          {filteredOptions.map((o) => (
            <label
              key={o.value}
              className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-muted"
            >
              <Checkbox checked={selected.includes(o.value)} onCheckedChange={() => toggle(o.value)} />
              <span className="truncate">{o.label}</span>
            </label>
          ))}
          {filteredOptions.length === 0 && (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">{t.common.noResults}</p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
