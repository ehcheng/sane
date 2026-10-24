"use client";

import { Drawer } from "vaul";
import { ChildName } from "./child-name";
import type { AgendaChild, AgendaFilter } from "./types";

interface FilterSheetProps {
  open: boolean;
  onClose: () => void;
  filter: AgendaFilter;
  onFilterChange: (filter: AgendaFilter) => void;
  children: AgendaChild[];
}

export function FilterSheet({
  open,
  onClose,
  filter,
  onFilterChange,
  children: allChildren,
}: FilterSheetProps) {
  const selectedChildId =
    filter.childIds && filter.childIds.length === 1
      ? filter.childIds[0]
      : null;

  return (
    <Drawer.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 bg-black/40 z-40" />
        <Drawer.Content className="fixed bottom-0 left-0 right-0 z-50 flex flex-col rounded-t-2xl bg-[var(--agenda-surface)] shadow-[0_-4px_24px_rgba(0,0,0,0.1)] dark:shadow-[0_-4px_24px_rgba(0,0,0,0.4)] border-t border-black/[0.06] dark:border-white/[0.1]">
          <div className="flex justify-center pt-3 pb-1">
            <div className="w-10 h-1 rounded-full bg-[var(--agenda-divider)]" />
          </div>

          <div className="px-[var(--agenda-gutter)] pb-6">
            <Drawer.Title className="text-agenda-day font-atkinson font-bold text-agenda-ink">
              Filter
            </Drawer.Title>

            <p className="text-agenda-sm font-atkinson text-agenda-ink-muted mt-1 mb-2">
              Show events for:
            </p>

            <div className="flex flex-wrap gap-2" role="radiogroup">
              <RadioChip
                label="All"
                selected={filter.childIds === null}
                onTap={() => onFilterChange({ ...filter, childIds: null })}
              />
              {allChildren.map((child) => (
                <RadioChip
                  key={child.id}
                  selected={selectedChildId === child.id}
                  onTap={() => onFilterChange({ ...filter, childIds: [child.id] })}
                >
                  <ChildName child={child} />
                </RadioChip>
              ))}
            </div>

            <div className="mt-3 border-t border-[var(--agenda-divider)] pt-3 space-y-0">
              <ToggleRow label="Actionable only" checked={filter.actionableOnly} onToggle={() => onFilterChange({ ...filter, actionableOnly: !filter.actionableOnly })} />
              <ToggleRow label="Show completed" checked={filter.showCompleted} onToggle={() => onFilterChange({ ...filter, showCompleted: !filter.showCompleted })} />
            </div>
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

function RadioChip({
  label,
  selected,
  onTap,
  children,
}: {
  label?: string;
  selected: boolean;
  onTap: () => void;
  children?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onTap}
      role="radio"
      aria-checked={selected}
      className={`h-10 px-4 rounded-full font-atkinson text-agenda-sm border focus-visible:outline-2 focus-visible:outline-agenda-accent transition-colors ${
        selected
          ? "bg-agenda-accent text-white border-agenda-accent"
          : "bg-transparent text-agenda-ink border-[var(--agenda-divider)]"
      }`}
    >
      {children ?? label}
    </button>
  );
}

function ToggleRow({ label, checked, onToggle }: { label: string; checked: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex items-center justify-between w-full py-3 px-1 rounded-xl focus-visible:outline-2 focus-visible:outline-agenda-accent"
      role="switch"
      aria-checked={checked}
    >
      <span className="text-agenda-sm font-atkinson text-agenda-ink">{label}</span>
      <span
        className={`relative flex-shrink-0 rounded-full transition-colors ${checked ? "bg-agenda-accent" : "bg-[#CBD5E1] dark:bg-[#475569]"}`}
        style={{ width: 44, height: 26 }}
      >
        <span
          className={`absolute rounded-full border transition-all ${
            checked
              ? "bg-white border-white/50"
              : "bg-white border-[#94A3B8] dark:bg-[#E2E8F0] dark:border-[#94A3B8]"
          }`}
          style={{ width: 20, height: 20, top: 3, left: checked ? 21 : 3 }}
        />
      </span>
    </button>
  );
}
