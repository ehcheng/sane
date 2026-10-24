"use client";

import { useEffect } from "react";
import { atkinson, inter } from "@/app/fonts/agenda-fonts";

/**
 * Adds agenda font CSS variables to <html> so portal-rendered content
 * (Vaul sheets, Radix dialogs) can access font-atkinson/font-inter.
 */
export function useAgendaFonts() {
  useEffect(() => {
    const html = document.documentElement;
    html.classList.add(atkinson.variable, inter.variable);
    return () => {
      html.classList.remove(atkinson.variable, inter.variable);
    };
  }, []);
}
