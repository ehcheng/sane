/**
 * Renders an AI summary with bullet-point detection and zebra striping.
 * Shared across agenda view, month view detail panel, and upcoming events card.
 */

export type SummarySegment =
  | { type: "paragraph"; text: string }
  | { type: "bullets"; items: string[] };

export function parseSummary(text: string): SummarySegment[] {
  const bulletPrefix = /^[\s]*(?:[-•*]|\d+[.):])\s+/;

  // Split into groups separated by blank lines
  const groups: string[][] = [];
  let current: string[] = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") {
      if (current.length > 0) {
        groups.push(current);
        current = [];
      }
    } else {
      current.push(line);
    }
  }
  if (current.length > 0) groups.push(current);

  const segments: SummarySegment[] = [];
  for (const group of groups) {
    const hasBulletPrefix = group.some((l) => bulletPrefix.test(l));
    if (hasBulletPrefix || group.length >= 2) {
      segments.push({
        type: "bullets",
        items: group.map((l) => l.replace(bulletPrefix, "").trim()),
      });
    } else {
      segments.push({ type: "paragraph", text: group[0]!.trim() });
    }
  }

  return segments;
}

export interface EventLink {
  url: string;
  label: string;
}

export function EventLinks({ links }: { links: EventLink[] }) {
  if (links.length === 0) return null;
  return (
    <div className="rounded-md border border-border/50 overflow-hidden">
      {links.map((link, i) => {
        let domain: string;
        try { domain = new URL(link.url).hostname; } catch { domain = link.url; }
        return (
          <div
            key={i}
            className={`flex gap-1.5 px-2 py-1 text-xs font-normal leading-relaxed ${
              i % 2 === 0 ? "bg-muted/30" : ""
            }`}
          >
            <span className="mt-px shrink-0 text-muted-foreground/50">&#x2022;</span>
            <span className="text-foreground/90">
              <a
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:underline dark:text-blue-400"
              >
                {link.label}
              </a>
              <span className="ml-1 text-muted-foreground/60">{domain}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

const VARIANTS = {
  default: {
    wrapper: "space-y-2",
    paragraph: "whitespace-pre-line text-xs font-normal leading-relaxed text-foreground/90",
    list: "rounded-md border border-border/50 overflow-hidden",
    item: "flex gap-1.5 px-2 py-1 text-xs font-normal leading-relaxed",
    itemZebra: "bg-muted/30",
    bullet: "mt-px shrink-0 text-muted-foreground/50",
    itemText: "text-foreground/90",
  },
  agenda: {
    wrapper: "space-y-2",
    paragraph: "text-agenda-base font-atkinson leading-[var(--agenda-leading-body)] text-agenda-ink",
    list: "space-y-1.5",
    item: "flex gap-2 text-agenda-base font-atkinson leading-[var(--agenda-leading-body)] text-agenda-ink",
    itemZebra: "",
    bullet: "text-agenda-ink-muted select-none flex-shrink-0",
    itemText: "",
  },
} as const;

export type FormattedSummaryVariant = keyof typeof VARIANTS;

export function FormattedSummary({
  text,
  variant = "default",
}: {
  text: string;
  variant?: FormattedSummaryVariant;
}) {
  const segments = parseSummary(text);
  const styles = VARIANTS[variant];

  return (
    <div className={styles.wrapper}>
      {segments.map((seg, i) =>
        seg.type === "paragraph" ? (
          <p key={i} className={styles.paragraph}>
            {seg.text}
          </p>
        ) : variant === "agenda" ? (
          <ul key={i} className={styles.list}>
            {seg.items.map((item, j) => (
              <li key={j} className={styles.item}>
                <span className={styles.bullet}>&bull;</span>
                <span className={styles.itemText || undefined}>{item}</span>
              </li>
            ))}
          </ul>
        ) : (
          <div key={i} className={styles.list}>
            {seg.items.map((item, j) => (
              <div
                key={j}
                className={`${styles.item} ${j % 2 === 0 ? styles.itemZebra : ""}`}
              >
                <span className={styles.bullet}>&#x2022;</span>
                <span className={styles.itemText}>{item}</span>
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );
}
