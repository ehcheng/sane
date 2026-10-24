"use client";

import { useState, useMemo, useCallback } from "react";
import { Search } from "lucide-react";
import { PublicPageShell } from "@/components/layout/public-page-shell";
import { Input } from "@/components/ui/input";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { cn } from "@/lib/utils";
import { faqCategories } from "./faq-data";

export default function FaqPage() {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return faqCategories;
    return faqCategories
      .map((cat) => ({
        ...cat,
        questions: cat.questions.filter(
          (fq) =>
            fq.question.toLowerCase().includes(q) ||
            (fq.searchText ?? (typeof fq.answer === "string" ? fq.answer : ""))
              .toLowerCase()
              .includes(q)
        ),
      }))
      .filter((cat) => cat.questions.length > 0);
  }, [search]);

  const scrollTo = useCallback((id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  return (
    <PublicPageShell>
      <div className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="text-3xl font-bold tracking-tight">
          Frequently Asked Questions
        </h1>
        <p className="mt-2 text-muted-foreground">
          Find answers to common questions about SANE.
        </p>

        {/* Search */}
        <div className="relative mt-6">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search questions..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Category nav */}
        {!search && (
          <nav className="mt-6 flex gap-2 overflow-x-auto pb-2">
            {faqCategories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => scrollTo(cat.id)}
                className="shrink-0 rounded-full border bg-background px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                {cat.title}
              </button>
            ))}
          </nav>
        )}

        {/* FAQ sections */}
        <div className="mt-8 space-y-10">
          {filtered.map((cat) => (
            <section key={cat.id} id={cat.id} className="scroll-mt-24">
              <h2 className="text-xl font-semibold">{cat.title}</h2>
              <Accordion type="single" collapsible className="mt-3">
                {cat.questions.map((fq, i) => (
                  <AccordionItem key={i} value={`${cat.id}-${i}`}>
                    <AccordionTrigger className="text-left">
                      {fq.question}
                    </AccordionTrigger>
                    <AccordionContent className="text-muted-foreground">
                      {fq.answer}
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </section>
          ))}

          {filtered.length === 0 && (
            <div className="py-12 text-center text-muted-foreground">
              <p className="text-lg font-medium">No matching questions found</p>
              <p className="mt-1 text-sm">
                Try a different search term or{" "}
                <button
                  onClick={() => setSearch("")}
                  className={cn(
                    "underline underline-offset-4 hover:text-foreground"
                  )}
                >
                  clear the search
                </button>
              </p>
            </div>
          )}
        </div>
      </div>
    </PublicPageShell>
  );
}
