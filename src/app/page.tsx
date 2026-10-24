import fs from "fs";
import path from "path";
import { remark } from "remark";
import html from "remark-html";
import Image from "next/image";
import Link from "next/link";
import { PublicHeader } from "@/components/layout/public-header";
import { HeroCTAs } from "@/components/layout/hero-ctas";
import { MobileTabBarConditional } from "@/components/layout/mobile-tab-bar-conditional";
import { cn } from "@/lib/utils";
import { prisma } from "@/server/db/prisma";
import type { Metadata } from "next";

async function getBrandInfo() {
  try {
    const config = await prisma.systemConfig.findUnique({
      where: { id: "singleton" },
      select: { brandName: true, brandTagline: true },
    });
    return {
      brandName: config?.brandName ?? "SANE",
      brandTagline: config?.brandTagline ?? "School Alerts, Notices & Essentials",
    };
  } catch {
    return { brandName: "SANE", brandTagline: "School Alerts, Notices & Essentials" };
  }
}

export async function generateMetadata(): Promise<Metadata> {
  const { brandName, brandTagline } = await getBrandInfo();
  return { title: `${brandName} — ${brandTagline}` };
}

async function getAboutContent(): Promise<string> {
  try {
    const filePath = path.join(process.cwd(), "content", "about.md");
    const markdown = fs.readFileSync(filePath, "utf-8");
    const result = await remark().use(html, { sanitize: true }).process(markdown);
    return result.toString();
  } catch {
    return "<h2>About</h2><p>SANE helps parents filter and summarize school emails.</p>";
  }
}

export default async function HomePage() {
  const [content, { brandName, brandTagline }] = await Promise.all([
    getAboutContent(),
    getBrandInfo(),
  ]);

  return (
    <div className="bg-background">
      <PublicHeader />

      {/* Hero — above the fold */}
      <section className="flex min-h-[calc(100dvh-3.5rem)] flex-col items-center justify-center px-4 text-center">
        <div className="mx-auto max-w-2xl space-y-8">
          {/* Mascot */}
          <div className="flex justify-center">
            <Image
              src="/sane_ollie.png"
              alt="Ollie, the SANE mascot"
              width={160}
              height={160}
              priority
              unoptimized
              className="drop-shadow-lg"
            />
          </div>

          {/* Brand */}
          <div className="space-y-3">
            <h1 className={cn(
              "font-bold tracking-tight",
              brandName.length <= 5
                ? "text-6xl sm:text-7xl"
                : brandName.length <= 10
                  ? "text-5xl sm:text-6xl"
                  : brandName.length <= 20
                    ? "text-4xl sm:text-5xl"
                    : "text-3xl sm:text-4xl"
            )}>
              {brandName}
            </h1>
            <p className="text-sm font-medium uppercase tracking-[0.25em] text-muted-foreground">
              {brandTagline}
            </p>
          </div>

          {/* Tagline */}
          <p className="mx-auto max-w-md text-lg text-muted-foreground sm:text-xl">
            Filter and summarize school emails.
            <br className="hidden sm:block" />
            You just see what matters.
          </p>

          {/* CTAs — hidden when signed in */}
          <HeroCTAs />
        </div>

        {/* Scroll hint */}
        <div className="absolute bottom-8 animate-bounce text-muted-foreground/50">
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 5v14M5 12l7 7 7-7" />
          </svg>
        </div>
      </section>

      {/* Detailed content — below the fold */}
      <section className="border-t bg-muted/30">
        <main className="mx-auto max-w-3xl px-4 py-16">
          {/* Render content header (h1) */}
          <article
            className="
              prose prose-slate dark:prose-invert
              max-w-none
              prose-headings:font-bold prose-headings:tracking-tight
              prose-h1:text-4xl prose-h1:mb-4
            "
            dangerouslySetInnerHTML={{ __html: content.slice(0, content.indexOf('<h2')) }}
          />

          {/* Render rest of content (h2 onward) */}
          <article
            className="
              prose prose-slate dark:prose-invert
              max-w-none
              prose-headings:font-bold prose-headings:tracking-tight
              prose-h2:text-2xl prose-h2:mt-10 prose-h2:mb-4 prose-h2:border-b prose-h2:pb-2 prose-h2:border-border
              prose-p:leading-7 prose-p:mb-4 prose-p:text-muted-foreground
              prose-li:text-muted-foreground prose-li:leading-7
              prose-strong:text-foreground prose-strong:font-semibold
              prose-a:text-primary prose-a:no-underline hover:prose-a:underline
              prose-em:text-muted-foreground
              prose-ul:my-4 prose-ul:space-y-1
            "
            dangerouslySetInnerHTML={{ __html: content.slice(content.indexOf('<h2')) }}
          />
        </main>
      </section>
      <MobileTabBarConditional />
    </div>
  );
}
