"use client";

import { atkinson, inter } from "@/app/fonts/agenda-fonts";
import { AgendaPage } from "./agenda-page";
import { useAgendaFonts } from "./use-agenda-fonts";

/**
 * Full-screen wrapper for the agenda view when rendered inside the (app) layout.
 * Covers the AppShell chrome (header, tab bar, padding) with a fixed overlay.
 */
export function AgendaMobileShell() {
  useAgendaFonts();

  return (
    <div
      className={`fixed inset-0 z-50 overflow-hidden bg-[var(--agenda-bg)] ${atkinson.variable} ${inter.variable}`}
    >
      <AgendaPage />
    </div>
  );
}
