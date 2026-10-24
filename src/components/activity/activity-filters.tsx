"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface ActivityFilterValues {
  sender: string;
  keyword: string;
  datePreset: "7d" | "30d" | "all";
}

interface ActivityFiltersProps {
  values: ActivityFilterValues;
  onChange: (values: ActivityFilterValues) => void;
}

const DATE_PRESETS = [
  { label: "7 days", value: "7d" as const },
  { label: "30 days", value: "30d" as const },
  { label: "All", value: "all" as const },
];

function useDebounced(value: string, delay: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

export function ActivityFilters({ values, onChange }: ActivityFiltersProps) {
  const [senderInput, setSenderInput] = useState(values.sender);
  const [keywordInput, setKeywordInput] = useState(values.keyword);
  const isInitial = useRef(true);

  const debouncedSender = useDebounced(senderInput, 300);
  const debouncedKeyword = useDebounced(keywordInput, 300);

  // Sync debounced values to parent
  useEffect(() => {
    if (isInitial.current) {
      isInitial.current = false;
      return;
    }
    if (debouncedSender !== values.sender || debouncedKeyword !== values.keyword) {
      onChange({
        ...values,
        sender: debouncedSender,
        keyword: debouncedKeyword,
      });
    }
  }, [debouncedSender, debouncedKeyword]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = useCallback(
    (partial: Partial<ActivityFilterValues>) => {
      onChange({ ...values, ...partial });
    },
    [values, onChange]
  );

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex rounded-md border">
        {DATE_PRESETS.map((p) => (
          <Button
            key={p.value}
            variant={values.datePreset === p.value ? "default" : "ghost"}
            size="sm"
            className={cn(
              "h-7 text-xs",
              p.value === "7d" && "rounded-r-none",
              p.value === "all" && "rounded-l-none",
              p.value === "30d" && "rounded-none"
            )}
            onClick={() => set({ datePreset: p.value })}
          >
            {p.label}
          </Button>
        ))}
      </div>

      <Input
        value={senderInput}
        onChange={(e) => setSenderInput(e.target.value)}
        placeholder="Filter by sender..."
        className="h-7 min-w-[140px] flex-1 text-xs"
      />
      <Input
        value={keywordInput}
        onChange={(e) => setKeywordInput(e.target.value)}
        placeholder="Search subject/summary..."
        className="h-7 min-w-[140px] flex-1 text-xs"
      />
    </div>
  );
}
