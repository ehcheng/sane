"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { useSession, signOut } from "next-auth/react";
import { Calendar, Settings, MessageSquareText, MoreHorizontal, HelpCircle, LogOut, Shield, FileText, Sun, Moon, Monitor } from "lucide-react";
import { motion } from "motion/react";
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useTheme } from "next-themes";
import { Separator } from "@/components/ui/separator";

const tabs = [
  { href: "/events", label: "Events", icon: Calendar },
  { href: "/settings", label: "Settings", icon: Settings },
  { href: "/faq", label: "FAQ", icon: HelpCircle },
  { href: "/feedback", label: "Feedback", icon: MessageSquareText },
] as const;

const themeIcons: Record<string, React.ReactNode> = {
  light: <Sun className="h-5 w-5 text-muted-foreground" />,
  dark: <Moon className="h-5 w-5 text-muted-foreground" />,
  system: <Monitor className="h-5 w-5 text-muted-foreground" />,
};

const themeLabels: Record<string, string> = {
  light: "Light",
  dark: "Dark",
  system: "System",
};

const themeOrder = ["light", "dark", "system"] as const;

export function MobileTabBar() {
  const { data: session } = useSession();
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <>
      <nav
        className="fixed bottom-0 left-0 right-0 z-40 border-t border-border/50 bg-background/80 backdrop-blur-xl md:hidden"
        role="tablist"
        aria-label="Main navigation"
      >
        <div className="flex items-stretch justify-around" style={{ height: 'var(--mobile-tab-bar-h)' }}>
          {tabs.map((tab) => {
            const isActive = pathname === tab.href || pathname.startsWith(tab.href + "/");
            const Icon = tab.icon;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                role="tab"
                aria-selected={isActive}
                className={cn(
                  "flex flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors",
                  isActive
                    ? "text-primary"
                    : "text-muted-foreground active:text-foreground"
                )}
              >
                <motion.div
                  whileTap={{ scale: 0.85 }}
                  transition={{ type: "spring", stiffness: 400, damping: 17 }}
                >
                  <Icon
                    className={cn("h-5 w-5", isActive && "fill-primary/20")}
                    strokeWidth={isActive ? 2.5 : 1.75}
                  />
                </motion.div>
                <span>{tab.label}</span>
              </Link>
            );
          })}

          {/* More tab: opens bottom sheet */}
          <button
            type="button"
            role="tab"
            aria-selected={moreOpen}
            onClick={() => setMoreOpen(true)}
            className={cn(
              "flex flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors",
              moreOpen
                ? "text-primary"
                : "text-muted-foreground active:text-foreground"
            )}
          >
            <motion.div
              whileTap={{ scale: 0.85 }}
              transition={{ type: "spring", stiffness: 400, damping: 17 }}
            >
              <MoreHorizontal className="h-5 w-5" strokeWidth={1.75} />
            </motion.div>
            <span>More</span>
          </button>
        </div>
        {/* Safe area spacer for devices with home indicator */}
        <div className="pb-safe" />
      </nav>

      {/* "More" bottom sheet */}
      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent side="bottom" className="rounded-t-2xl px-2 pb-safe">
          <SheetHeader className="px-4">
            <SheetTitle className="text-base">
              {session?.user?.name ?? "More"}
            </SheetTitle>
          </SheetHeader>
          <div className="mt-3 flex flex-col">
            <Link
              href="/privacy"
              onClick={() => setMoreOpen(false)}
              className="flex items-center gap-3 rounded-lg px-4 py-3 text-sm font-medium text-foreground active:bg-accent"
            >
              <Shield className="h-5 w-5 text-muted-foreground" />
              Privacy
            </Link>
            <Link
              href="/terms"
              onClick={() => setMoreOpen(false)}
              className="flex items-center gap-3 rounded-lg px-4 py-3 text-sm font-medium text-foreground active:bg-accent"
            >
              <FileText className="h-5 w-5 text-muted-foreground" />
              Terms
            </Link>
            {mounted && (() => {
              const current = theme ?? "system";
              const nextIndex = (themeOrder.indexOf(current as typeof themeOrder[number]) + 1) % themeOrder.length;
              const next = themeOrder[nextIndex];
              return (
                <button
                  type="button"
                  onClick={() => setTheme(next)}
                  className="flex items-center gap-3 rounded-lg px-4 py-3 text-sm font-medium text-foreground active:bg-accent"
                >
                  {themeIcons[current]}
                  Theme: {themeLabels[current]}
                </button>
              );
            })()}
            <Separator className="my-1" />
            <button
              type="button"
              onClick={() => {
                setMoreOpen(false);
                signOut({ callbackUrl: "/login" });
              }}
              className="flex items-center gap-3 rounded-lg px-4 py-3 text-sm font-medium text-destructive active:bg-accent"
            >
              <LogOut className="h-5 w-5" />
              Sign out
            </button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
