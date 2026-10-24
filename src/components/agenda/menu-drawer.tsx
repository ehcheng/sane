"use client";

import { Drawer } from "vaul";
import { Settings, HelpCircle, MessageSquareText, Shield, FileText, Sun, Moon, Monitor } from "lucide-react";
import { useTheme } from "next-themes";
import Link from "next/link";

const THEME_CYCLE = ["light", "dark", "system"] as const;
const THEME_ICONS: Record<string, React.ReactNode> = {
  light: <Sun size={18} />,
  dark: <Moon size={18} />,
  system: <Monitor size={18} />,
};
const THEME_LABELS: Record<string, string> = {
  light: "Light",
  dark: "Dark",
  system: "System",
};

interface MenuDrawerProps {
  open: boolean;
  onClose: () => void;
}

const MENU_ITEMS = [
  { label: "Settings", href: "/settings", icon: Settings },
  { label: "FAQ", href: "/faq", icon: HelpCircle },
  { label: "Feedback", href: "/feedback", icon: MessageSquareText },
  { label: "Privacy Policy", href: "/privacy", icon: Shield },
  { label: "Terms of Service", href: "/terms", icon: FileText },
] as const;

/**
 * Slide-over menu drawer from the left.
 * Replaces the bottom tab bar for the agenda view.
 * Uses Vaul Drawer with direction="left".
 */
export function MenuDrawer({ open, onClose }: MenuDrawerProps) {
  const { theme, setTheme } = useTheme();
  const currentTheme = theme ?? "system";
  const nextTheme = THEME_CYCLE[(THEME_CYCLE.indexOf(currentTheme as typeof THEME_CYCLE[number]) + 1) % THEME_CYCLE.length];

  return (
    <Drawer.Root open={open} onOpenChange={(o) => !o && onClose()} direction="left">
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 bg-black/40 z-40" />
        <Drawer.Content className="fixed top-0 left-0 bottom-0 z-50 w-72 bg-[var(--agenda-surface)] flex flex-col rounded-r-2xl">
          <div className="flex-1 overflow-y-auto pt-safe">
            {/* Header */}
            <div className="px-6 pt-8 pb-4">
              <Drawer.Title className="text-agenda-day font-atkinson font-bold text-agenda-ink">
                SANE
              </Drawer.Title>
            </div>

            {/* Menu items */}
            <nav>
              {MENU_ITEMS.map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={onClose}
                    className="flex items-center gap-3 px-6 h-[var(--agenda-touch-min)] text-agenda-base font-atkinson text-agenda-ink hover:bg-[var(--agenda-divider)] focus-visible:outline-2 focus-visible:outline-agenda-accent focus-visible:outline-offset-[-2px]"
                  >
                    <Icon size={20} strokeWidth={1.75} className="text-agenda-ink-muted flex-shrink-0" />
                    {item.label}
                  </Link>
                );
              })}
            </nav>

            <div className="px-6 mt-6 pt-4 border-t border-[var(--agenda-divider)]">
              <button
                type="button"
                onClick={() => setTheme(nextTheme)}
                className="flex items-center gap-3 w-full h-[var(--agenda-touch-min)] text-agenda-base font-atkinson text-agenda-ink focus-visible:outline-2 focus-visible:outline-agenda-accent"
              >
                <span className="text-agenda-ink-muted flex-shrink-0">{THEME_ICONS[currentTheme]}</span>
                {THEME_LABELS[currentTheme]}
              </button>
            </div>
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
