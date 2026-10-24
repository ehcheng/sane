"use client";

import { useState, useEffect, type ReactNode } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ChevronRight, ChevronLeft } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useIsNarrowViewport } from "@/hooks/use-mobile";

export interface SettingsSection {
  id: string;
  label: string;
  icon: LucideIcon;
  dataTour?: string;
}

interface SettingsShellProps {
  title: string;
  description: string;
  sections: SettingsSection[];
  children: (activeSection: string) => ReactNode;
  defaultSection?: string;
  alert?: ReactNode;
  /** Maps sub-section hash fragments to their parent section id */
  subSectionMap?: Record<string, string>;
}

function getHashSection(
  sections: SettingsSection[],
  subSectionMap?: Record<string, string>,
): string | null {
  if (typeof window === "undefined") return null;
  const hash = window.location.hash.slice(1);
  if (sections.some((s) => s.id === hash)) return hash;
  // Check if it's a known sub-section and resolve to the parent section
  if (subSectionMap && hash in subSectionMap) return subSectionMap[hash];
  return null;
}

export function SettingsShell({
  title,
  description,
  sections,
  children,
  defaultSection,
  alert,
  subSectionMap,
}: SettingsShellProps) {
  const fallback = defaultSection ?? sections[0]?.id ?? "";
  const [active, setActive] = useState(fallback);
  const isMobile = useIsNarrowViewport();
  // On mobile: false = show section list, true = show section content
  const [mobileShowContent, setMobileShowContent] = useState(false);

  // Sync from hash on mount (and open section content on mobile if hash present)
  useEffect(() => {
    const fromHash = getHashSection(sections, subSectionMap);
    if (fromHash) {
      setActive(fromHash);
      setMobileShowContent(true);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Listen for popstate (back/forward)
  useEffect(() => {
    function onHashChange() {
      const fromHash = getHashSection(sections, subSectionMap);
      if (fromHash) {
        setActive(fromHash);
        setMobileShowContent(true);
      }
    }
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [sections]);

  function navigate(id: string) {
    setActive(id);
    setMobileShowContent(true);
    window.history.replaceState(null, "", `#${id}`);
  }

  function navigateBack() {
    setMobileShowContent(false);
    window.history.replaceState(null, "", window.location.pathname);
  }

  const activeSection = sections.find((s) => s.id === active);

  return (
    <div className="space-y-6">
      {description && (
        <p className={cn(
          "text-muted-foreground",
          mobileShowContent && isMobile && "hidden"
        )}>{description}</p>
      )}

      {alert && (
        <div className={cn(mobileShowContent && isMobile && "hidden")}>
          {alert}
        </div>
      )}

      {/* Desktop layout: sidebar + content side by side */}
      <div className="hidden md:flex md:flex-row md:gap-8">
        <nav className="w-48 shrink-0">
          <div className="sticky top-20 space-y-1">
            {sections.map((section) => {
              const Icon = section.icon;
              return (
                <button
                  key={section.id}
                  onClick={() => navigate(section.id)}
                  data-tour={section.dataTour}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                    active === section.id
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground"
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {section.label}
                </button>
              );
            })}
            <VersionLabel className="px-3" />
          </div>
        </nav>
        <div className="min-w-0 flex-1">
          {children(active)}
        </div>
      </div>

      {/* Mobile layout: stacked navigation with push/pop */}
      <div className="md:hidden">
        <AnimatePresence mode="popLayout" initial={false}>
          {!mobileShowContent || !isMobile ? (
            <motion.div
              key="section-list"
              initial={{ x: "-100%", opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: "-100%", opacity: 0 }}
              transition={{ type: "spring", stiffness: 400, damping: 35 }}
            >
              <nav className="space-y-1">
                {sections.map((section) => {
                  const Icon = section.icon;
                  return (
                    <button
                      key={section.id}
                      onClick={() => navigate(section.id)}
                      data-tour={section.dataTour}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-xl px-4 py-3.5 text-left transition-colors active:bg-accent/50",
                        active === section.id
                          ? "bg-accent text-accent-foreground"
                          : "text-foreground hover:bg-accent/30"
                      )}
                    >
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted">
                        <Icon className="h-4.5 w-4.5 text-muted-foreground" />
                      </div>
                      <span className="flex-1 text-sm font-medium">{section.label}</span>
                      <ChevronRight className="h-4 w-4 text-muted-foreground/50" />
                    </button>
                  );
                })}
                <VersionLabel className="px-4" />
              </nav>
            </motion.div>
          ) : (
            <motion.div
              key="section-content"
              initial={{ x: "100%", opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: "100%", opacity: 0 }}
              transition={{ type: "spring", stiffness: 400, damping: 35 }}
            >
              {/* Back button + section title */}
              <button
                type="button"
                onClick={navigateBack}
                className="mb-4 flex items-center gap-1.5 text-sm font-medium text-primary active:opacity-70"
              >
                <ChevronLeft className="h-4 w-4" />
                Settings
              </button>

              {activeSection && (
                <div className="mb-4 flex items-center gap-2">
                  <activeSection.icon className="h-5 w-5 text-muted-foreground" />
                  <h2 className="text-lg font-semibold">{activeSection.label}</h2>
                </div>
              )}

              {children(active)}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function VersionLabel({ className }: { className?: string }) {
  const v = process.env.NEXT_PUBLIC_APP_VERSION;
  if (!v) return null;
  return <p className={cn("pt-4 text-xs text-muted-foreground/50", className)}>v{v}</p>;
}
