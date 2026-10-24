import localFont from "next/font/local";

/**
 * Atkinson Hyperlegible: body, titles, day headers, hero text.
 * Optimized for readability at all sizes, especially for 40+ audience.
 */
export const atkinson = localFont({
  src: [
    { path: "./atkinson-400.woff2", weight: "400", style: "normal" },
    { path: "./atkinson-700.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-atkinson",
  display: "swap",
});

/**
 * Inter: timestamps, UI labels, button labels.
 * Loaded with tabular figures so times align in fixed-width columns.
 */
export const inter = localFont({
  src: [{ path: "./inter-latin.woff2", weight: "400 500", style: "normal" }],
  variable: "--font-inter",
  display: "swap",
});
