# SANE: Architecture Reference

> Current as of alpha26 (September 2026). Companion documents: `docs/PRODUCT.md` (what and why), `README.md` (setup and operations).

## System Overview

Next.js 14 App Router monolith plus a BullMQ background worker. Two processes in production:

- **Web**: Next.js standalone server (UI + tRPC API + REST-ish API routes)
- **Worker**: BullMQ job processor (polls Gmail, runs AI analysis, sends forwards and briefs, runs lifecycle and diagnostics)

```
Browser  -->  Next.js 14 (App Router)  -->  tRPC API  -->  PostgreSQL
                                                              |
                                              BullMQ Worker --+
                                                |
                                    +-----------+-----------+
                                 Gmail API     AI API     Resend API
```

Errors from web, worker, and edge are captured by Sentry (`sentry.*.config.ts`, `src/instrumentation.ts`, `src/app/global-error.tsx`).

## Root Config Files

| File | Purpose |
|------|---------|
| `package.json` | Scripts: `dev`, `dev:all`, `build`, `worker:dev`, `test`, `test:pipeline`, `test:all` |
| `app.config.defaults.ts` | Factory defaults for all DB-stored config, including all AI prompts (no fs dependency, safe for bundling) |
| `next.config.js` | Standalone output, security headers (CSP, HSTS), reads `build-number` for app version |
| `docker-compose.yml` | Local PostgreSQL 16 + Redis 7 |
| `Dockerfile` / `Dockerfile.worker` | Separate web and worker production images (non-root) |
| `vitest.config.ts` | Vitest config (node env, `@` alias, custom HTML reporter) |
| `sentry.client/server/edge.config.ts` | Sentry initialization per runtime |

## App Router Pages (`src/app/`)

```
src/app/
+-- layout.tsx              # Root layout (providers, fonts, theme)
+-- page.tsx                # Landing/marketing page
+-- middleware.ts           # Auth redirects, public paths, HTTPS enforcement, role routing
|
+-- (auth)/                 # login, signup, setup-admin (first run), forgot/reset password, unsubscribe
+-- (app)/                  # Authenticated user pages
|   +-- events/             # Calendar (desktop dual-view; mobile agenda shell on narrow viewports)
|   +-- settings/           # 7 tabs: Family, Delivery, Email Setup, Events Setup, Email Log, Privacy, Account
|   +-- setup/              # 3-step wizard: family, gmail, forwarding
|   +-- feedback/           # Categorized feedback form
|   +-- account/delete/     # Account deletion with password confirmation
+-- (admin)/admin/          # Admin-only pages
|   +-- page.tsx            # Dashboard: health, stats, feedback rates, brief report, token costs
|   +-- users/              # User management: lifecycle indicators, activity signals, actions
|   +-- emails/             # Processing log across all users
|   +-- ai-logs/            # AI call audit log viewer with CSV/JSON export
|   +-- insights/           # Diagnostic run history, on-demand runs, context file download
|   +-- feedback/           # Feedback analytics (email AI, event AI, user-submitted)
|   +-- settings/           # 8 sections: System, Account, Branding, Access, AI, Email, Worker, Debug
+-- about/ faq/ privacy/ terms/ contactsane/ reactivate/ verify-result/   # Public pages
```

## API Routes (`src/app/api/`)

```
+-- trpc/[trpc]/            # tRPC HTTP handler
+-- auth/                   # NextAuth handler, signup, setup-admin, access-code checks (all rate limited)
+-- gmail/connect|callback/ # Gmail OAuth flow (HMAC-signed state)
+-- calendar/[token]/       # iCal subscription feed (token-based, rate limited, updates lastCalendarAccessAt hourly)
+-- events/[eventId]/ics/   # Single-event .ics download
+-- household/              # Household invite accept/decline endpoints
+-- feedback/               # One-click email feedback (HMAC token)
+-- sender-rule/            # One-click sender rule from forwarded email (HMAC token)
+-- unsubscribe/            # One-click unsubscribe (HMAC token)
+-- verify-email/           # Email and forwarding address verification
+-- forgot-password/ reset-password/ validate-reset-token/
+-- contact/                # Public contact form
+-- health/                 # Health check (DB ping)
+-- webhooks/resend/        # Delivery status webhook (Svix signature verification)
```

## tRPC Routers (14)

`src/server/trpc/routers/`:

| Router | Purpose |
|--------|---------|
| `user.ts` | Profile, password, email change, delivery settings, tours, monitoring toggle |
| `parents.ts` / `children.ts` | Family CRUD (child fields PII-encrypted) |
| `forwarding.ts` | Forwarding address CRUD, verification, test emails |
| `email.ts` | Gmail connection status, reconnect, backfill, account type |
| `events.ts` | Event CRUD (soft delete), agenda query with carry-forward, calendar token, event feedback |
| `activity.ts` | Processed email feed (infinite scroll), stats, force-forward, CSV export |
| `sender-rules.ts` / `allowed-senders.ts` / `ignored-activities.ts` / `priority-activities.ts` | Filtering lists |
| `feedback.ts` | User feedback, opt-in consent, snapshots |
| `household.ts` | Create, invite (HMAC, 7-day expiry), accept/decline, remove, leave, dissolve; max 6 members |
| `admin.ts` | Stats, user management, config CRUD, debug actions, alerts, forced briefs, AI test |

**Middleware pattern** (`src/server/trpc/trpc.ts`): `protectedProcedure` scopes every query to `ctx.userId`; for household members `ctx.userId` resolves to the household primary while `ctx.authUserId` stays the logged-in user. `adminProcedure` checks role; `householdOwnerProcedure` checks household ownership.

## Server Logic (`src/server/`)

```
+-- auth.ts                 # NextAuth v5 (JWT strategy, credentials provider, 7-day maxAge)
+-- db/prisma.ts            # Prisma client singleton
+-- config/index.ts         # Config loader: SystemConfig row + defaults, 60s cache
+-- ai/
|   +-- provider.ts         # OpenAI/Gemini/Grok chat-completion provider + factory
|   +-- anthropic-provider.ts  # Anthropic Messages API provider
|   +-- provider-cache.ts   # Provider instance cache (keeps SDK deps out of admin bundle)
|   +-- prompt-builder.ts   # Family context + filtering knobs + untrusted-content wrapping
|   +-- response-parser.ts  # Zod-validated structured response parsing, invariant enforcement
+-- email-providers/        # Provider abstraction: gmail/client.ts (History API sync), token-manager.ts
+-- email/
|   +-- sender.ts           # Resend sender (600ms throttle for 2 req/sec limit)
|   +-- sanitize.ts         # HTML sanitization for email bodies
|   +-- templates/          # React Email: forwarded-email, daily-brief, weekly-digest,
|                           # verification, test, reauth, quota-paused, monitoring started/stopped,
|                           # inactivity-warning, deactivation, reactivation,
|                           # household-invite, household-departure, household-deactivation,
|                           # admin-heartbeat, responsive wrapper, shared styles
+-- attachments/            # extract-text.ts (pdf-parse, mammoth), process-images.ts (sharp), orchestrator
+-- alerts/create-alert.ts  # Admin alert creation with dedup keys
```

### AI pipeline detail

Nine admin-editable prompts (defaults in `app.config.defaults.ts`): system, relevance, concise summary, response format, no-send, event extraction, brief summary, link extraction, brutal mode. The AI returns a strict JSON object validated by Zod (`src/lib/validators.ts`): `relevant`, `send`, `subject`, `summary`, `children`, `reasoning`, `events[]`, `links[]`, `topicSlug`.

Attachments: PDFs and DOCX are text-extracted (Gemini also supports native PDF input); images are resized/converted by sharp and sent to the configured vision model. Email bodies are capped at 32KB, attachment text at 16KB each. All untrusted content is wrapped in `<untrusted_email>` / `<untrusted_attachment>` tags as prompt-injection defense.

Event dedup (in `process-user-emails.ts`): exact same-day title match first, then an AI semantic-match call against same-day events, then merge (longer title wins, AI merges differing details, endDate/location fill in, actionable flag ORs, children union, source email appended). Soft-deleted events (`deletedAt`) are never resurrected.

## Worker (`src/worker/`)

```
+-- index.ts                # Worker entry, job router, Sentry capture, graceful shutdown (25s drain)
+-- queue.ts                # Redis connection + queue singleton
+-- jobs/
    +-- poll-scheduler.ts       # Repeatable: enqueues process-user-emails for eligible users (active hours, timezone-aware)
    +-- process-user-emails.ts  # Core pipeline: Gmail sync -> filters -> AI -> record -> events -> delivery routing
    +-- send-brief.ts           # Daily/weekly brief assembly and send (23h double-send guard)
    +-- flush-queued-brief.ts   # Processes queued brief items
    +-- manual-forward.ts       # User-triggered force-forward of skipped emails
    +-- attachment-forward.ts   # Forwards with attachment content
    +-- user-lifecycle.ts       # Daily: activity aggregation, WARNING/DEACTIVATED transitions, reminder emails
    +-- admin-heartbeat.ts      # Daily merged admin report: heartbeat sections + diagnostic findings
    +-- diagnostic-checks.ts    # Shared library of 7 anomaly checks (used by heartbeat + manual runs)
    +-- manual-diagnostics.ts   # On-demand diagnostic run from admin Insights page
    +-- data-retention-cleanup.ts  # Periodic cleanup per retention config
```

Worker config: concurrency 5, 3 retries with exponential backoff (5s base), per-user Redis mutex (5-minute TTL), poll jobs prioritized over backfills.

### User lifecycle state machine

`ACTIVE -> WARNING -> DEACTIVATED`, with reactivation on any activity signal.

- Threshold: 30 school days inactive (summer June 16 - Aug 14 excluded; `src/lib/school-year.ts`)
- Activity signals: `lastActiveAt` (web), `lastCalendarAccessAt` (ICS feed), `lastProcessedEmailAt` (email processing; household members inherit the primary's)
- Warning window: 14 days with emails at day 0, 7, and 13, then deactivation
- Household members get a dedicated notice when their primary deactivates
- Master switch: `SystemConfig.lifecycleEnforcementEnabled` (default false = observe-only)

## Shared Libraries (`src/lib/`)

| File | Purpose |
|------|---------|
| `encryption.ts` / `pii-encryption.ts` | AES-256-GCM; PII helpers for child + forwarding fields (SHA-256 hash for uniqueness) |
| `rate-limit.ts` | In-memory sliding-window limiter + `getClientIp` |
| `validators.ts` | Zod schemas including the AI response schema; centralized `FIELD_LIMITS` |
| `constants.ts` | Shared constants including lifecycle thresholds |
| `school-year.ts` | Summer grace period + school-day counting |
| `logger.ts` | Structured logger (file + console in dev) |
| `ai-call-logger.ts` | Fire-and-forget encrypted AI call audit logging |
| `ics.ts` / `calendar-links.ts` | ICS generation, Google Calendar links |
| `feedback-token.ts` / `sender-rule-token.ts` / `unsubscribe-token.ts` | HMAC-signed one-click tokens (purpose-enforced) |
| `verification-token.ts` | DB-stored verification tokens |
| `date-utils.ts` | Timezone-aware date helpers |
| `brief-stats.ts` | Shared brief delivery aggregation |
| `url-validation.ts` | Open-redirect prevention |
| `trpc.ts` | Client-side tRPC + React Query setup |

## Components (`src/components/`)

```
+-- providers.tsx           # tRPC, React Query, Theme, Toast providers
+-- layout/                 # App shell, admin shell, public header, footer, status indicator
+-- activity/               # Email activity feed (list, filters, stats, CSV export)
+-- agenda/                 # Mobile agenda (12 components): shell, page, day panel, event row,
|                           # event detail, day picker, filter sheet, menu drawer, top bar, yesterday strip
+-- events/                 # Desktop events page (agenda + month views, mini-month, edit dialog, feedback)
+-- settings/               # Settings tab components
+-- admin/                  # Admin page components
+-- alerts/                 # Backfill progress + page-level banners
+-- tour/                   # First-time-user tour (definitions, provider, callout, spotlight)
+-- wizard/                 # Setup wizard steps
+-- ui/                     # shadcn/ui primitives
```

Mobile/desktop split: `/events` renders `AgendaMobileShell` when `useIsNarrowViewport()` is true, otherwise the desktop `EventsPage`. The agenda uses Embla Carousel for day swiping, Vaul for sheets, and self-hosted fonts (Atkinson Hyperlegible, Inter). Design tokens live on `:root` (prefixed `--agenda-*`) because Vaul/Radix portals render outside scoped classes.

## Database (Prisma)

25 models, 6 enums, 34 migrations.

| Model | Purpose |
|-------|---------|
| `User` | Account, auth, wizard state, delivery prefs, timezone, `accountStatus`, activity timestamps, `householdId` |
| `Account` / `Session` / `VerificationToken` | NextAuth + verification |
| `EmailConnection` | Gmail OAuth (encrypted tokens, history cursor, status) |
| `Parent` / `Child` | Family context (child fields PII-encrypted) |
| `IgnoredActivity` / `PriorityActivity` / `SenderRule` / `AllowedSender` | Filtering |
| `ForwardingAddress` | Destinations (PII-encrypted, SHA-256 emailHash for uniqueness) |
| `SystemConfig` | Singleton: all admin settings (AI, prompts, worker, branding, retention, lifecycle toggle) |
| `ProcessedEmail` | Per-email AI result, summary, links, topic, tokens, feedback, delivery status |
| `ProcessedEmailDailyStats` | Aggregated daily per-user stats |
| `ExtractedEvent` | Events (actionable, isTodo, `deletedAt` soft delete, `sourceEmails` JSON, child many-to-many) |
| `BriefDelivery` | Brief tracking with Resend webhook delivery status |
| `AdminAlert` | Dashboard alerts with dedup keys |
| `AICallLog` | Encrypted prompt/response audit log with plaintext query metadata |
| `DiagnosticRun` / `DiagnosticFinding` | Anomaly detection runs and findings |
| `FeedbackSnapshot` / `UserFeedback` | Opt-in encrypted snapshots; categorized form feedback |
| `Household` / `HouseholdInvite` | Household (primaryUserId owner) + invite tokens |

Enums: `Role`, `ConnectionStatus`, `EmailProvider`, `SummaryStyle`, `FeedbackCategory`, `AccountStatus` (ACTIVE/WARNING/DEACTIVATED).

## Key Patterns & Conventions

1. **Dynamic imports for Node builtins**: tRPC routers must not top-level import `crypto`, `fs`, or heavy SDKs; use `await import()` inside handlers.
2. **PII encryption**: encrypt on write, decrypt on read; centralized in `pii-encryption.ts`.
3. **Config from DB**: everything in SystemConfig with a 60s cache; `.env` holds only infra secrets.
4. **HMAC tokens with purpose enforcement** for all one-click links and OAuth state.
5. **User scoping**: every protected query filters by `ctx.userId`; household middleware resolves member -> primary.
6. **Zod everywhere**: tRPC inputs and AI responses.
7. **Provider cache isolation**: AI SDK instances cached in `provider-cache.ts` to keep the admin bundle light.
8. **Resend throttling**: 600ms promise-chain throttle.
9. **Timing-safe comparisons** on access codes and token validation.
10. **Soft delete for events**: user deletions set `deletedAt`; dedup respects it.

## Testing

- **Unit tests** (`src/__tests__/`, Vitest): mocked Prisma/logger/encryption; covers auth, middleware, routers, AI providers, poll scheduler, lifecycle job, system config. Custom HTML reporter in `tests/reporters/`.
- **AI pipeline tests** (`tests/attachment-pipeline/`): standalone runner calling the real AI API against fixture datasets (attachments, prompt injection, text-only) in `_github_excluded/test-fixtures/`, comparing decisions to expected outcomes and rendering HTML reports.

## Deployment

Railway, two services from separate Dockerfiles (web with `/api/health` check and pre-deploy `prisma migrate deploy`; worker via `RAILWAY_DOCKERFILE_PATH`). Railway auto-deploys from GitHub pushes. Version is `major.minor.build` where build = git commit count written to `build-number` by a pre-commit hook (Railway builds exclude `.git`).
