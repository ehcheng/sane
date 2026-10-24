# SANE: School Alerts, Notices & Essentials

> **Archived.** SANE ran as a small private beta and was shut down in October 2026. The code is published as-is, for learning, under the MIT license. It is not maintained, and no hosted instance exists.

AI-powered school email filter. Connects to a parent's Gmail, analyzes incoming school emails with AI, and forwards only the actionable ones (events, deadlines, schedule changes) to the addresses you choose, with a clean summary on top.

> Deeper documentation: [docs/PRODUCT.md](docs/PRODUCT.md) (product functionality, users, constraints) and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) (full technical reference).

## What It Does

1. **You describe your family.** Children's names, grades, teachers, plus parent/guardian names for household context.
2. **You connect your school Gmail.** Read-only OAuth access. SANE never sends from your account.
3. **AI reads every email.** Each message is analyzed for actionable content. Boring stuff is quietly skipped.
4. **You get the highlights.** Actionable emails are summarized and forwarded to whoever needs to know: your partner, the grandparents, the nanny.
5. **Calendar events are extracted.** Dates, times, locations, and details are pulled from emails automatically, with .ics download and Google Calendar links. Events from multiple emails about the same topic are intelligently merged.
6. **Historical backfill.** When you connect Gmail, the last 2 weeks of emails are automatically processed to seed your calendar with upcoming events.

## Architecture

```
Browser  -->  Next.js 14 (App Router)  -->  tRPC API  -->  PostgreSQL
                                                              |
                                              BullMQ Worker --+
                                                |
                                    +-----------+-----------+
                                 Gmail API     AI API     Resend API
```

Two processes run in production:

- **Web**: Next.js standalone server (UI + tRPC API)
- **Worker**: BullMQ job processor (polls Gmail, runs AI analysis, sends forwards, sends digest briefs, runs the user lifecycle job and daily admin diagnostics). Per-user Redis mutex prevents concurrent processing; poll jobs run at higher priority than backfills.

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 14 (App Router, standalone output) |
| Language | TypeScript (strict mode) |
| API | tRPC v11 + React Query v5 |
| Database | PostgreSQL 16 via Prisma ORM |
| Job Queue | BullMQ + Redis 7 |
| Auth | NextAuth v5 (JWT strategy, credentials provider) |
| AI | OpenAI, Anthropic, Google Gemini, or Grok (admin-configurable via UI) |
| Email Sending | [Resend](https://resend.com) + React Email templates |
| Gmail Access | Google APIs (OAuth2, Gmail API v1) |
| Attachments | pdf-parse (PDF), mammoth (DOCX), sharp (images) |
| Encryption | AES-256-GCM for tokens, API keys, PII, and feedback snapshots at rest |
| UI | Tailwind CSS + shadcn/ui (Radix primitives); Embla Carousel + Vaul for the mobile agenda |
| Error Tracking | Sentry (web, worker, and edge runtimes) |
| Container | Docker multi-stage (separate web and worker targets) |

## External Service Dependencies

| Service | Purpose | Sign Up |
|---|---|---|
| **Google Cloud** | OAuth2 app credentials + Gmail API access | [console.cloud.google.com](https://console.cloud.google.com/apis/credentials) |
| **OpenAI / Anthropic / Google / xAI** | AI email analysis (admin-configurable) | Provider-specific |
| **Resend** | Transactional email delivery (forwards + digests) | [resend.com](https://resend.com) |

Google Cloud setup requires:
1. Create an OAuth2 client (Web application type)
2. Enable the **Gmail API**
3. Add `https://localhost:3000/api/gmail/callback` as an authorized redirect URI (adjust for production)
4. For production, complete OAuth consent screen verification

## Prerequisites

- Node.js 20+
- PostgreSQL 16
- Redis 7
- npm

Or just Docker + Docker Compose.

## Quick Start

### 1. Infrastructure (Docker Compose)

```bash
docker compose up -d
```

Starts PostgreSQL on `:5432` and Redis on `:6379`.

### 2. Environment

```bash
cp .env.example .env
```

Fill in the required values in `.env`:

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection string |
| `NEXTAUTH_URL` | App base URL (`https://localhost:3000`) |
| `NEXTAUTH_SECRET` | Generate: `openssl rand -base64 32` |
| `GOOGLE_CLIENT_ID` | Google OAuth2 client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth2 client secret |
| `GOOGLE_REDIRECT_URI` | OAuth callback URL |
| `ENCRYPTION_KEY` | AES-256 key (64 hex chars). Generate: `openssl rand -hex 32` |

All other settings (AI provider/model/key, Resend, worker schedule, prompts, branding, debug) are configured via **Admin > Settings** in the web UI and stored encrypted in the database. Factory defaults are defined in `app.config.defaults.ts`.

### 3. Install & Migrate

```bash
npm install
npx prisma migrate dev
```

### 4. Seed (optional)

```bash
npx tsx prisma/seed.ts
```

Creates the default `SystemConfig` row. No user accounts are created; the admin account is set up via the web UI on first launch.

### 5. First-Run Admin Setup

On a fresh deployment with no users, visiting the app redirects to `/setup-admin` where you create the admin account with your own email and password.

### 6. Run

Recommended: starts both web and worker with automatic log routing:

```bash
npm run dev:all        # starts both; tails logs
npm run dev:stop       # stops both processes
```

Output goes to `logs/next.log` and `logs/worker.log` with live tailing.

Or run individually in separate terminals:

```bash
npm run dev            # Web server only (HTTPS)
npm run worker:dev     # Background worker only
```

App is at [https://localhost:3000](https://localhost:3000).

## Git Hooks

A **pre-commit hook** auto-updates the `build-number` file with the current git commit count. This is required because Railway's Docker builds exclude `.git`, so `next.config.js` reads this file to determine the app version (`major.minor.build`).

After cloning, install the hook:

```bash
cp hooks/pre-commit .git/hooks/pre-commit
chmod +x .git/hooks/pre-commit
```

### Versioning

The app version follows `major.minor.build` format:

- **major.minor**: Set manually in `package.json`
- **build**: Git commit count, auto-incremented by the pre-commit hook

The version is displayed in Settings and exposed via `NEXT_PUBLIC_APP_VERSION`.

## How It Works

1. **Setup Wizard** (3 steps): User creates an account, adds parents and children (name, grade, class, teachers), connects Gmail via OAuth, and sets forwarding addresses.

2. **Historical Backfill**: Immediately after Gmail is connected, a backfill job processes up to 50 emails from the last 14 days through the AI pipeline. This seeds the calendar with upcoming events before regular polling begins. Progress is shown live in the UI.

3. **Polling**: The worker runs a `poll-scheduler` job every N minutes during configurable active hours (respects per-user timezone). For each user with an active Gmail connection, completed setup, and monitoring enabled, it enqueues a `process-user-emails` job.

4. **Email Processing**: Each job:
   - Obtains a valid Gmail access token (auto-refreshing if expired)
   - On first poll, seeds the Gmail history cursor so only future messages are processed
   - Fetches new messages via Gmail History API (incremental sync)
   - Deduplicates against previously processed messages
   - Applies sender rules (always-forward / never-forward) before AI analysis
   - Applies email source filtering (all senders vs. allowed-only list for shared inboxes)
   - Processes attachments: extracts text from PDFs and DOCX files, resizes images for vision analysis
   - Builds an AI prompt with family context (parents, children, priority activities, ignored activities)
   - Sends the email to the configured AI model for structured analysis
   - Assigns a topic slug for grouping related emails across sessions
   - Extracts calendar events (dates, times, locations, details, to-dos) with semantic deduplication and detail merging across emails
   - Marks events as actionable or informational
   - Records the result with token usage and latency metrics
   - If actionable: routes based on delivery settings (immediate forward, daily brief, and/or weekly brief)

5. **Delivery Modes** (independent toggles, can all be enabled simultaneously):
   - **Individual Forwarding**: each actionable email is forwarded immediately via Resend
   - **Daily Brief**: emails from the last 24 hours sent as a digest once per day at the user's chosen hour, with upcoming events
   - **Weekly Brief**: comprehensive digest with AI narrative summary, action items, and upcoming school week events

6. **Topic Grouping**: The AI assigns a topic slug to each email (e.g. `spring-field-trip`, `lunch-menu`). Related emails are grouped in briefs, and forwarded messages show links to prior emails on the same topic.

7. **Event Extraction**: Calendar events are extracted from every relevant email, not just forwarded ones. Events include dates, times, locations, details, child assignment, and to-do flags. When multiple emails reference the same event, they are merged: titles are upgraded to the most descriptive version, details are combined, and child assignments are unioned.

8. **Feedback Loop**: Users can rate AI decisions on both emails and events via thumbs up/down buttons. Patterns in feedback generate automatic suggestions (e.g., "create a sender rule to always forward from X"). With opt-in consent, feedback snapshots are encrypted and stored for future AI improvement analysis.

9. **Token Security**: Gmail OAuth tokens are encrypted with AES-256-GCM before storage. Tokens are refreshed automatically; if refresh fails, the connection is marked `NEEDS_REAUTH` and the user is prompted to reconnect.

10. **Households (beta)**: One primary owner + up to 5 members share a single Gmail stream. Shared data (events, children, processed emails, filtering rules) is keyed to the primary; each member keeps their own forwarding addresses, delivery settings, calendar tokens, and timezone. HMAC-signed invite flow with 7-day expiry.

11. **Account Lifecycle**: After 30 school days with no activity (web login, ICS feed access, or email processing), a user enters a 14-day warning window with 3 escalating emails, then deactivation (monitoring paused, data preserved). Summer (June 16 - Aug 14) is excluded from inactivity counting. Any activity reactivates. Gated by a global `lifecycleEnforcementEnabled` admin toggle (default off = observe-only).

## Features

### First-Time Tour
- Per-page guided tours after wizard completion introduce key features on the Events and Emails pages
- Contextual welcome message adapts based on delivery settings
- Non-intrusive Radix Popover callouts with highlight ring, skip button, no forced navigation
- Tour completion is stored in the database and syncs across devices

### Households (Beta)
- One primary (owner) + up to 5 members per household
- Members share the primary's email stream, events, children, and filtering rules
- Each member keeps independent forwarding addresses, delivery settings, and calendar subscription
- Invite by email (HMAC-signed token, 7-day expiry, one-time accept); leave/remove/dissolve flows
- Dedicated email templates: invite, departure, primary-deactivation notice

### Mobile Agenda View
- Auto-activates at `/events` on narrow viewports (desktop keeps the dual-view calendar)
- Swipe-first day-by-day carousel (Embla), bottom-sheet event details and filters (Vaul)
- 12 dedicated components under `src/components/agenda/`; self-hosted Atkinson Hyperlegible + Inter fonts
- Shares event editing and summary parsing with the desktop views

### Events Page
- **Dual-view calendar**: agenda (scrollable list) and month (grid) views, with user-selectable default
- **Mini-month sidebar**: click any date to jump directly to it in the agenda
- **Smart event display**: child color badges, to-do markers, actionable indicators
- **Source email linking**: click through from any event to its source email(s) in the email log
- **Event actions**: inline editing, deletion (soft delete: a deleted event will not reappear if a later email mentions it again), .ics download, Google Calendar links
- **iCal subscription feed**: subscribable URL with LOCATION and DESCRIPTION fields, filterable to actionable events only
- **Multi-source tracking**: events merged from multiple emails show all sources
- **Actionable filter toggle**: show all events or just actionable ones (auto-hidden when all events are already actionable)
- **Event feedback**: thumbs up/down on individual events

### Email Log
- Searchable, sortable infinite-scroll list of all processed emails
- Forward/skip badges, delivery status tracking (delivered, bounced, delayed)
- AI reasoning expandable ("Why this decision")
- Thumbs up/down feedback with one-click links in forwarded emails
- Force-forward button for skipped emails
- CSV export with filters
- Lifetime statistics: processed, forwarded, skipped, delivered, bounced

### User Settings

Organized into 7 tabs: Family, Delivery, Email Setup, Events Setup, Email Log, Privacy, Account.

- **Account**: profile, password change (min 12 chars), email change with verification, account deletion with password confirmation
- **Delivery**: summary style (concise / standard / detailed), individual forwarding toggle, daily/weekly brief schedule and scope, AI improvement opt-in
- **Family**: manage parents (name, relationship) and children (name, pronouns, grade, class, teachers, notes)
- **Filters**: email source filter (all vs. allowed-only), priority activities (always forward), ignored activities (always skip), per-sender rules (always/never forward), brutal mode (strict mandatory-only filtering)
- **Forwarding**: manage forwarding addresses with verification, activation/pause, test emails
- **Gmail**: connection management, reconnect, disconnect, account type (dedicated/shared)
- **Events Setup**: default view preference, calendar subscription, actionable events filter
- **Salient Links**: AI extracts actionable links (sign-ups, payments, RSVPs) from emails and displays them in summaries

### Admin Dashboard
- **Global monitoring toggle**: master on/off for all email processing
- **System health**: Redis status, worker heartbeat, job queue stats (waiting, active, delayed, completed, failed)
- **Usage stats**: total users, connections, emails processed/forwarded/delivered/bounced
- **Feedback analytics**: 3-tab layout with email AI feedback, event AI feedback, and user-submitted feedback
- **Sender rule stats**: rule counts by type
- **Token usage and cost table**: 30-day daily breakdown with configurable cost-per-million rates
- **Alert banner**: critical system issues shown at the top of the dashboard

### Admin Daily Report & Diagnostics (Insights)

A single daily admin email merges a system heartbeat (users and connections, 24h processing stats, brief delivery, DB/Redis/worker health, open alerts) with automated anomaly detection: 7 diagnostic checks run against the database, findings are stored, and a downloadable markdown context file is generated, structured for Claude Code root cause analysis. The email header reads "Action Required" or "All Systems Normal". Diagnostics can also be run on demand from the Insights page.

**Diagnostic Checks:**

| # | Category | What it detects | Severity logic |
|---|----------|-----------------|----------------|
| 1 | `brief_gap` | Users with daily briefs enabled but no successful `BriefDelivery` in 3 days. Same check for weekly briefs with a 7-day window. | >50% of enabled users affected = critical, otherwise warning |
| 2 | `stale_connection` | Users with an active Gmail connection (`EmailConnection.status = ACTIVE`) but zero `ProcessedEmail` records in 3 days. Indicates polling or token issues. | >50% of active connections = critical, otherwise warning |
| 3 | `ai_failure_spike` | AI call failure rate (24h) compared to 7-day baseline. Catches provider outages, invalid API keys, model changes. | >20% absolute failure rate = critical; >10% or >2x baseline = warning |
| 4 | `bounce_spike` | Forwarded email bounce rate (24h) compared to 7-day baseline. Catches invalid forwarding addresses or Resend domain issues. | >10% absolute bounce rate = critical; >2x baseline = warning |
| 5 | `pending_brief` | `BriefDelivery` records with `status=sent` but `deliveryStatus=pending` for over 24 hours. Indicates Resend webhooks may not be reaching the app. | Always warning |
| 6 | `gmail_quota` | Users paused due to Gmail API daily quota exhaustion (in-memory tracker). | Always info (auto-resolves at midnight UTC) |
| 7 | `ai_latency` | Average AI call duration (24h) vs 7-day baseline. Catches provider slowdowns or model changes. | >5x baseline = critical; >3x baseline = warning |

**Context file:** Each run generates a markdown file with system state, findings, affected users, metrics, relevant code paths, and investigation steps. Designed to be fed directly to Claude Code for automated root cause analysis.

**Admin UI (Insights page):**
- Status card showing last run time, overdue warning (>36h), 7-day run streak
- "Run Now" button to trigger diagnostics on demand (with live progress polling)
- Run history table with expandable findings per run
- Download button for the Claude Code context file

**Schedule:** Runs automatically every 24 hours as part of the merged admin heartbeat job. Old runs are cleaned up by data retention (same period as AI call logs, default 30 days).

### Admin User Management
- Responsive table (desktop) and card (mobile) views
- Lifecycle indicators: color-coded status (active / warning countdown / deactivated) with per-signal activity dates (web login, email processing, ICS feed access) and progress toward the inactivity threshold
- Household annotations: "Household manager (N members)" or "Member of X's household"
- Gmail reauth warnings with amber-highlighted rows
- Per-user monitoring toggle
- Admin actions: change email, reset password, force daily/weekly brief, clear and backfill, manual deactivate/reactivate, delete user
- Separated action groups for clarity

### Admin Settings
- **System**: global monitoring toggle, lifecycle enforcement toggle, display features (e.g. show email summary bullets in event views)
- **AI Configuration**: provider (OpenAI/Anthropic/Gemini/Grok), model, vision model, API key (encrypted), test button to verify connectivity
- **Token Cost Estimation**: configurable input/output cost per million tokens
- **Prompt Instructions**: customizable system, relevance, summary, response format, no-send, event extraction, and brief summary prompts (shows customized vs. default state)
- **Email (Resend)**: from address, API key, webhook secret, custom footer
- **Worker & Scheduler**: poll interval, active hours, timezone, data retention periods
- **Branding**: app name, tagline, public URL (used on public pages and emails), broadcast message
- **Access Control**: optional signup access code for early-access gating
- **Debug & Logging**: debug mode, show debug UI, log directory
- **Debug Actions** (when debug UI enabled): Check Now, Force N (1-10), Daily/Weekly Brief, Seed Events (backfill), Simulate Reauth

### Email Templates (React Email)
- **Forwarded email**: branded header, AI summary, child badge, salient links, related emails from same topic, attachment list, original message, feedback links, custom footer
- **Daily brief**: AI-generated summary, per-email digest, upcoming events (configurable lookahead)
- **Weekly brief**: AI narrative summary with action items, email digest grouped by topic, upcoming school week events
- **Lifecycle**: inactivity warning (3-stage countdown), deactivation, reactivation, household-deactivation notice
- **Household**: invite, departure notification
- **Admin**: daily heartbeat + diagnostics report
- **Other**: verification, password reset, test, reauth notification, monitoring started/stopped, quota-paused

### Public Pages
- Landing page with admin-configurable branding
- About, FAQ, Privacy Policy, Terms of Service, Contact form

## Resend Webhook Setup

To track email delivery status (delivered, bounced, delayed, spam complaints), configure a webhook in your Resend dashboard:

- **URL:** `https://<your-domain>/api/webhooks/resend`
- **Events:** `email.delivered`, `email.bounced`, `email.complained`, `email.delivery_delayed`
- **Signing secret:** Set in Admin > Settings > Email to enable Svix HMAC signature verification

## Scripts

| Script | Description |
|---|---|
| `npm run dev:all` | Start web + worker; logs to files |
| `npm run dev:stop` | Stop both dev processes |
| `npm run dev` | Start Next.js dev server (HTTPS) |
| `npm run build` | Production build |
| `npm run start` | Start production server |
| `npm run worker:dev` | Start worker with hot reload |
| `npm run worker:start` | Start worker (production) |
| `npm run db:migrate` | Run Prisma migrations |
| `npm run db:push` | Push schema to DB (no migration) |
| `npm run db:seed` | Seed default SystemConfig |
| `npm run db:studio` | Open Prisma Studio GUI |
| `npm run test` | Run unit tests (Vitest) |
| `npm run test:watch` | Run unit tests in watch mode |
| `npm run test:all` | Run unit + pipeline tests |
| `npm run test:pipeline` | Run AI pipeline test against fixture dataset |

## Testing

### Unit Tests (Vitest)

```bash
npm test              # run all tests once
npm run test:watch    # run in watch mode
npm run test:all      # run unit tests + pipeline tests sequentially
```

Unit tests live in `src/__tests__/` and use Vitest with mocked Prisma, logger, and encryption. Custom HTML reporter generates timestamped test reports.

### AI Pipeline Test

A standalone test runner that exercises the full extraction, prompt, AI, parse, and compare pipeline against email fixtures with expected outcomes. No database or running server required: it calls the real AI API.

```bash
# Run a specific dataset
npm run test:pipeline -- _github_excluded/test-fixtures/03_sample_emails

# Run with custom output directory
npm run test:pipeline -- _github_excluded/test-fixtures/03_sample_emails --output /path/to/results
```

**Setup:**

1. Place test fixtures in `_github_excluded/test-fixtures/` (gitignored). Each dataset has `sample-emails.json` + `expected-outcomes.json`, with shared user config in `sane-test-fixture.json`.
2. Create `tests/attachment-pipeline/.env` with `AI_API_KEY` and optionally `AI_PROVIDER`, `AI_MODEL`, `AI_VISION_MODEL`.

**What it does:**

- Resolves date tokens in fixture emails to concrete dates (relative to current time)
- Builds the same AI prompt the production worker uses
- Calls the real AI API and parses the structured response
- Compares AI decisions (send/skip, child assignment) against expected outcomes
- Renders forwarded email HTML for visual inspection
- Produces a timestamped HTML report + JSON summary in `<dataset>/results/`

**Datasets:**

| Dataset | Emails | Purpose |
|---------|--------|---------|
| `01_sample_emails_with_attachments/` | 15 | PDF, DOCX, image attachments |
| `02_prompt_injection_email_samples/` | 5 | Adversarial injection attacks |
| `03_sample_emails/` | 25 | Text-only emails, no attachments |

See `_github_excluded/test-fixtures/README.md` for full fixture authoring guide and date token reference.

## Docker (Production)

Two Dockerfiles produce separate images for web and worker:

```bash
# Build
docker build -t sane-web .                        # uses Dockerfile (web target)
docker build -f Dockerfile.worker -t sane-worker . # uses Dockerfile.worker

# Run (pass env vars)
docker run -p 3000:3000 --env-file .env sane-web
docker run --env-file .env sane-worker
```

Both images run as non-root users. Run `npx prisma migrate deploy` before starting (or use the `preDeployCommand` in `railway.json`).

### Railway Deployment

- **Web service**: uses `Dockerfile` + health check at `/api/health`, pre-deploy migrations via `npx prisma migrate deploy`
- **Worker service**: uses `Dockerfile.worker` via `RAILWAY_DOCKERFILE_PATH=Dockerfile.worker`
- **Required env vars:** `DATABASE_URL`, `REDIS_URL`, `NEXTAUTH_URL`, `NEXTAUTH_SECRET`, `ENCRYPTION_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`
- **Worker-specific:** `RAILWAY_DEPLOYMENT_DRAINING_SECONDS=30` (enables 25s graceful shutdown)

## Project Structure

```
src/
  app/(admin)/            # Admin pages (overview, users, emails, feedback, ai-logs, insights, settings)
  app/(app)/              # Authenticated pages (settings, events, setup wizard, feedback, account)
  app/(auth)/             # Login, signup, setup-admin, forgot/reset password, unsubscribe
  app/api/                # API routes (auth, gmail, household, webhooks, health, feedback, events, calendar)
  components/
    activity/             # Activity feed (list, item, stats, CSV export)
    admin/                # Admin page components
    agenda/               # Mobile agenda view (12 components: shell, day panel, event detail, sheets)
    alerts/               # Banners (backfill progress, page-level alerts)
    events/               # Desktop events page (agenda, month, mini-month, create/edit dialog)
    layout/               # App shell, admin shell, public header, footer
    settings/             # Settings shell + per-section components
    tour/                 # FTU tour system (definitions, provider, callout, spotlight)
    ui/                   # shadcn/ui primitives
    wizard/               # Setup wizard steps (family, gmail, forwarding)
  lib/                    # Shared utilities, validators, logger, rate limiter, encryption,
                          # HMAC tokens, school-year calendar, AI call logger
  server/
    ai/                   # AI providers, prompt builder, response parser, provider cache
    alerts/               # Admin alert creation
    attachments/          # PDF, DOCX, image extraction and processing
    auth.ts               # NextAuth config (JWT, 7-day sessions)
    config/               # Centralized config loader (DB + defaults, 60s cache)
    db/                   # Prisma client singleton
    email/                # Resend sender + React Email templates
    email-providers/      # Email provider abstraction (Gmail client, token manager)
    trpc/                 # tRPC router setup (14 routers)
  worker/
    index.ts              # BullMQ worker entry, job router, graceful shutdown (25s drain)
    queue.ts              # Redis connection + BullMQ queue
    jobs/                 # poll-scheduler, process-user-emails, send-brief, manual-forward,
                          # attachment-forward, data-retention-cleanup, flush-queued-brief,
                          # user-lifecycle, admin-heartbeat, diagnostic-checks, manual-diagnostics
docs/
  PRODUCT.md              # Product functionality, users, constraints (for planning)
  ARCHITECTURE.md         # Full technical reference
prisma/
  schema.prisma           # Data model (25 models, 6 enums)
  seed.ts                 # SystemConfig seeder
  migrations/             # Prisma migrations (34)
tests/
  attachment-pipeline/    # Standalone AI pipeline test runner
  lib/                    # Test utilities
  reporters/              # Custom Vitest HTML reporter
scripts/
  dev.sh                  # dev:all / dev:stop orchestrator
  db-backup.sh            # PostgreSQL backup utility
  *.ts                    # One-off migration/backfill scripts
content/
  about.md               # User-facing about page
  privacy.md             # Privacy policy
  terms.md               # Terms of service
```

## Privacy & Security

- All credentials and tokens encrypted with AES-256-GCM at rest
- PII encryption at rest for all child fields (name, grade, class, teachers) and forwarding addresses
- Gmail tokens auto-refresh; revoked tokens trigger reauth flow
- Email content is processed in real time. Originals are never stored (only metadata and AI summaries)
- Feedback snapshots are opt-in only, encrypted, with configurable retention and cascade-delete on account removal
- HTTP security headers: CSP, HSTS (2-year, preload), X-Frame-Options DENY, X-Content-Type-Options, Permissions-Policy
- In-memory sliding-window rate limiting on all auth endpoints and token-based API routes
- HMAC-signed tokens for OAuth state, feedback, unsubscribe, and sender rule links
- Timing-safe comparisons on all sensitive checks (access codes, tokens)
- JWT sessions capped at 7 days
- Password minimum 12 characters, max length validation
- Password confirmation required for account deletion
- Child ownership validation on event mutations (IDOR protection)
- Gmail API quota tracking with automatic pause on exhaustion

## License

Private.
