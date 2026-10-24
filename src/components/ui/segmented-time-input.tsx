"use client";

import { useState, useRef } from "react";
import { cn } from "@/lib/utils";
import { Calendar, Clock, X } from "lucide-react";

const noop = () => {};

function to12(h24: number): { hour: number; period: "AM" | "PM" } {
  if (h24 === 0) return { hour: 12, period: "AM" };
  if (h24 < 12) return { hour: h24, period: "AM" };
  if (h24 === 12) return { hour: 12, period: "PM" };
  return { hour: h24 - 12, period: "PM" };
}

function to24(h12: number, period: "AM" | "PM"): number {
  if (period === "AM") return h12 === 12 ? 0 : h12;
  return h12 === 12 ? 12 : h12 + 12;
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

function currentYear(): string {
  return String(new Date().getFullYear());
}

function daysInMonth(month: number, year: number): number {
  if (month < 1 || month > 12) return 31;
  return new Date(year, month, 0).getDate();
}

/* ------------------------------------------------------------------ */
/*  NumericSegment                                                    */
/* ------------------------------------------------------------------ */

interface SegmentProps {
  value: string;
  placeholder: string;
  maxLen: number;
  min: number;
  max: number;
  onCommit: (v: number) => void;
  onAdvance: () => void;
  onRetreat: () => void;
  inputRef: React.RefObject<HTMLInputElement>;
  width: string;
}

function NumericSegment({
  value,
  placeholder,
  maxLen,
  min,
  max,
  onCommit,
  onAdvance,
  onRetreat,
  inputRef,
  width,
}: SegmentProps) {
  const [text, setText] = useState(value);
  const prevValue = useRef(value);

  // Sync from parent when the committed value changes
  if (value !== prevValue.current) {
    prevValue.current = value;
    setText(value);
  }

  const commit = (andAdvance?: boolean) => {
    const raw = text.replace(/\D/g, "");
    const clamped = !raw ? min : clamp(parseInt(raw, 10), min, max);
    const padded = String(clamped).padStart(maxLen, "0");
    setText(padded);
    prevValue.current = padded;
    onCommit(clamped);
    if (andAdvance) onAdvance();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      commit(true);
    }
    if (e.key === "Tab" && !e.shiftKey) {
      e.preventDefault();
      commit(true);
    }
    if (e.key === "Tab" && e.shiftKey) {
      e.preventDefault();
      commit();
      onRetreat();
    }
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      const cur = parseInt(value, 10) || min;
      const next = e.key === "ArrowUp"
        ? (cur >= max ? min : cur + 1)
        : (cur <= min ? max : cur - 1);
      onCommit(next);
    }
  };

  return (
    <input
      ref={inputRef}
      type="text"
      inputMode="numeric"
      value={text}
      placeholder={placeholder}
      onChange={(e) => setText(e.target.value.replace(/\D/g, "").slice(0, maxLen))}
      onFocus={(e) => e.target.select()}
      onBlur={() => commit()}
      onKeyDown={handleKeyDown}
      className={cn(
        "bg-transparent text-center outline-none select-all tabular-nums",
        width
      )}
    />
  );
}

/* ------------------------------------------------------------------ */
/*  PeriodSegment (AM/PM)                                             */
/* ------------------------------------------------------------------ */

interface PeriodSegmentProps {
  value: "AM" | "PM";
  onCommit: (v: "AM" | "PM") => void;
  onAdvance: () => void;
  onRetreat: () => void;
  inputRef: React.RefObject<HTMLInputElement>;
}

function PeriodSegment({ value, onCommit, onAdvance, onRetreat, inputRef }: PeriodSegmentProps) {
  const toggle = () => onCommit(value === "AM" ? "PM" : "AM");

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      toggle();
    }
    if (e.key === "a" || e.key === "A") {
      e.preventDefault();
      onCommit("AM");
    }
    if (e.key === "p" || e.key === "P") {
      e.preventDefault();
      onCommit("PM");
    }
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      onRetreat();
    }
    if (e.key === "ArrowRight") {
      e.preventDefault();
      onAdvance();
    }
  };

  return (
    <input
      ref={inputRef}
      type="text"
      readOnly
      value={value}
      onKeyDown={handleKeyDown}
      onFocus={(e) => e.target.select()}
      className="bg-transparent text-center outline-none w-[3ch] cursor-default select-all"
      tabIndex={0}
    />
  );
}

/* ------------------------------------------------------------------ */
/*  SegmentedTimeInput                                                */
/* ------------------------------------------------------------------ */

interface SegmentedTimeInputProps {
  value: string; // "HH:MM" 24h or ""
  onChange: (value: string) => void;
  className?: string;
  clearable?: boolean;
}

export function SegmentedTimeInput({
  value,
  onChange,
  className,
  clearable,
}: SegmentedTimeInputProps) {
  const hourRef = useRef<HTMLInputElement>(null!);
  const minRef = useRef<HTMLInputElement>(null!);
  const periodRef = useRef<HTMLInputElement>(null!);
  const pickerRef = useRef<HTMLInputElement>(null!);

  const parts = value ? value.split(":").map(Number) : [NaN, NaN];
  const hasValue = !isNaN(parts[0]) && !isNaN(parts[1]);
  const { hour: h12, period } = hasValue ? to12(parts[0]) : { hour: 12, period: "AM" as const };
  const hourStr = hasValue ? String(h12).padStart(2, "0") : "";
  const minStr = hasValue ? String(parts[1]).padStart(2, "0") : "";
  const periodStr: "AM" | "PM" = hasValue ? period : "AM";

  const openPicker = () => {
    try { pickerRef.current?.showPicker(); } catch { pickerRef.current?.click(); }
  };

  const emit = (h12: number, m: number, p: "AM" | "PM") => {
    const h24 = to24(h12, p);
    onChange(`${String(h24).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
  };

  const commitHour = (v: number) => emit(v, hasValue ? parts[1] : 0, periodStr);
  const commitMin = (v: number) => emit(hasValue ? h12 : 12, v, periodStr);
  const commitPeriod = (v: "AM" | "PM") => emit(hasValue ? h12 : 12, hasValue ? parts[1] : 0, v);

  return (
    <div
      className={cn(
        "inline-flex items-center gap-0.5 rounded-md border border-input bg-background px-2 h-8 text-sm",
        "ring-offset-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2",
        className
      )}
    >
      <NumericSegment
        value={hourStr}
        placeholder="--"
        maxLen={2}
        min={1}
        max={12}
        onCommit={commitHour}
        onAdvance={() => minRef.current?.focus()}
        onRetreat={noop}
        inputRef={hourRef}
        width="w-[2ch]"
      />
      <span className="text-muted-foreground">:</span>
      <NumericSegment
        value={minStr}
        placeholder="--"
        maxLen={2}
        min={0}
        max={59}
        onCommit={commitMin}
        onAdvance={() => periodRef.current?.focus()}
        onRetreat={() => hourRef.current?.focus()}
        inputRef={minRef}
        width="w-[2ch]"
      />
      <PeriodSegment
        value={periodStr}
        onCommit={commitPeriod}
        onAdvance={noop}
        onRetreat={() => minRef.current?.focus()}
        inputRef={periodRef}
      />
      <button
        type="button"
        tabIndex={-1}
        onClick={openPicker}
        className="ml-0.5 text-muted-foreground hover:text-foreground"
      >
        <Clock className="h-3.5 w-3.5" />
      </button>
      {clearable && value && (
        <button
          type="button"
          tabIndex={-1}
          onClick={() => onChange("")}
          className="text-muted-foreground hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
      <input
        ref={pickerRef}
        type="time"
        value={value}
        onChange={(e) => { if (e.target.value) onChange(e.target.value); }}
        className="sr-only"
        tabIndex={-1}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  SegmentedDateInput                                                */
/* ------------------------------------------------------------------ */

interface SegmentedDateInputProps {
  value: string; // "YYYY-MM-DD" or ""
  onChange: (value: string) => void;
  className?: string;
}

export function SegmentedDateInput({
  value,
  onChange,
  className,
}: SegmentedDateInputProps) {
  const monthRef = useRef<HTMLInputElement>(null!);
  const dayRef = useRef<HTMLInputElement>(null!);
  const yearRef = useRef<HTMLInputElement>(null!);
  const pickerRef = useRef<HTMLInputElement>(null!);

  const openPicker = () => {
    try { pickerRef.current?.showPicker(); } catch { pickerRef.current?.click(); }
  };

  const parts = value ? value.split("-") : [];
  const yyyy = parts[0] ?? "";
  const mm = parts[1] ?? "";
  const dd = parts[2] ?? "";
  const defaultYear = currentYear();

  const emit = (y: string, m: string, d: string) => {
    const maxDay = daysInMonth(parseInt(m, 10), parseInt(y, 10));
    const clampedDay = String(clamp(parseInt(d, 10) || 1, 1, maxDay)).padStart(2, "0");
    onChange(`${y}-${m}-${clampedDay}`);
  };

  const commitMonth = (v: number) => emit(yyyy || defaultYear, String(v).padStart(2, "0"), dd || "01");
  const commitDay = (v: number) => emit(yyyy || defaultYear, mm || "01", String(v).padStart(2, "0"));
  const commitYear = (v: number) => emit(String(v).padStart(4, "0"), mm || "01", dd || "01");

  return (
    <div
      className={cn(
        "inline-flex items-center gap-0.5 rounded-md border border-input bg-background px-2 h-8 text-sm",
        "ring-offset-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2",
        className
      )}
    >
      <NumericSegment
        value={mm}
        placeholder="MM"
        maxLen={2}
        min={1}
        max={12}
        onCommit={commitMonth}
        onAdvance={() => dayRef.current?.focus()}
        onRetreat={noop}
        inputRef={monthRef}
        width="w-[2.5ch]"
      />
      <span className="text-muted-foreground">/</span>
      <NumericSegment
        value={dd}
        placeholder="DD"
        maxLen={2}
        min={1}
        max={daysInMonth(parseInt(mm, 10) || 1, parseInt(yyyy, 10) || parseInt(defaultYear, 10))}
        onCommit={commitDay}
        onAdvance={() => yearRef.current?.focus()}
        onRetreat={() => monthRef.current?.focus()}
        inputRef={dayRef}
        width="w-[2.5ch]"
      />
      <span className="text-muted-foreground">/</span>
      <NumericSegment
        value={yyyy}
        placeholder="YYYY"
        maxLen={4}
        min={2020}
        max={2099}
        onCommit={commitYear}
        onAdvance={noop}
        onRetreat={() => dayRef.current?.focus()}
        inputRef={yearRef}
        width="w-[4ch]"
      />
      <button
        type="button"
        tabIndex={-1}
        onClick={openPicker}
        className="ml-0.5 text-muted-foreground hover:text-foreground"
      >
        <Calendar className="h-3.5 w-3.5" />
      </button>
      <input
        ref={pickerRef}
        type="date"
        value={value}
        onChange={(e) => { if (e.target.value) onChange(e.target.value); }}
        className="sr-only"
        tabIndex={-1}
      />
    </div>
  );
}
