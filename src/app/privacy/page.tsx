import fs from "fs";
import path from "path";
import { remark } from "remark";
import html from "remark-html";
import { PublicPageShell } from "@/components/layout/public-page-shell";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy — SANE",
};

async function getPrivacyContent(): Promise<string> {
  try {
    const filePath = path.join(process.cwd(), "content", "privacy.md");
    const markdown = fs.readFileSync(filePath, "utf-8");
    const result = await remark().use(html, { sanitize: true }).process(markdown);
    return result.toString();
  } catch {
    return "<h1>Privacy Policy</h1><p>Unable to load privacy policy. Please contact us.</p>";
  }
}

export default async function PrivacyPage() {
  const content = await getPrivacyContent();

  return (
    <PublicPageShell>
      <main className="mx-auto max-w-3xl px-4 py-16">
        <article
          className="
            prose prose-slate dark:prose-invert
            max-w-none
            prose-headings:font-bold prose-headings:tracking-tight
            prose-h1:text-4xl prose-h1:mb-4
            prose-h2:text-2xl prose-h2:mt-10 prose-h2:mb-4 prose-h2:border-b prose-h2:pb-2 prose-h2:border-border
            prose-h3:text-lg prose-h3:mt-6 prose-h3:mb-2
            prose-p:leading-7 prose-p:mb-4 prose-p:text-muted-foreground
            prose-li:text-muted-foreground prose-li:leading-7
            prose-strong:text-foreground prose-strong:font-semibold
            prose-a:text-primary prose-a:no-underline hover:prose-a:underline
            prose-em:text-muted-foreground
            prose-ul:my-4 prose-ul:space-y-1
          "
          dangerouslySetInnerHTML={{ __html: content }}
        />
      </main>
    </PublicPageShell>
  );
}
