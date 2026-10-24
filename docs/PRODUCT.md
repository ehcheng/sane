# SANE: Product Documentation

> Current functionality as of alpha26 (September 2026). This document describes what the product does today, for whom, and why, as a foundation for planning the next version. Technical implementation details live in `docs/ARCHITECTURE.md`; setup instructions live in `README.md`.

## What SANE Is

SANE (School Alerts, Notices & Essentials) is an AI-powered school email filter. It connects to a parent's Gmail account (read-only), analyzes every incoming school email with an LLM, and delivers only what matters: actionable emails forwarded with clean summaries, calendar events extracted automatically, and optional daily/weekly digest briefs.

The core problem: schools bury critical information (permission slips, fee deadlines, schedule changes) in a flood of newsletters, spirit-week announcements, and fundraiser asks. Parents miss things that matter and drown in things that don't. SANE reads everything so the parent doesn't have to.

## Target Users

- **The overwhelmed primary parent.** Manages the school inbox for the family. Wants signal, not volume. Uses individual forwarding or a daily brief.
- **The secondary caregiver network.** Partner, grandparents, nanny. They don't have inbox access but need to know about pickups, events, and deadlines. They receive forwards at their own addresses without any account.
- **The two-parent household.** Both parents want their own view, settings, and delivery preferences while sharing one stream of school email. Served by the Households feature (beta).
- **The shared-inbox family.** School email arrives at a general-purpose personal inbox, not a dedicated one. Served by the allowed-senders filter (only process email from approved school senders).

## Core User Journey

### 1. Setup (3-step wizard)

- **Family**: add parents/guardians (name, relationship) and children (name, pronouns, grade, class, teachers, notes). This becomes the AI's context for relevance decisions.
- **Gmail**: connect via OAuth (read-only). User declares account type: dedicated (school-only inbox, process everything) or shared (personal inbox, process only allowed senders).
- **Forwarding**: add destination addresses with email verification. Each address can be activated/paused and test-emailed.

### 2. Historical backfill

On Gmail connect, the last 14 days of email (up to 50 messages) run through the full AI pipeline immediately, seeding the calendar with upcoming events before regular polling begins. Progress shows live in the UI.

### 3. Ongoing monitoring

A background worker polls Gmail on a configurable interval during active hours (timezone-aware per user). Each new email is:

- Deduplicated against previously processed messages
- Checked against sender rules (always/never forward) before spending AI tokens
- Filtered by allowed-senders list if the account is shared
- Analyzed by AI with full family context, including attachments (PDF, DOCX, images via vision models)
- Recorded with the AI's decision, summary, reasoning, extracted events, salient links, and topic slug

### 4. Delivery

Three independent delivery modes, any combination:

- **Individual forwarding**: actionable emails forwarded immediately with AI summary on top, child badge, salient links, related-topic links, and one-click feedback buttons.
- **Daily brief**: digest of the last 24 hours at the user's chosen hour, plus upcoming events (configurable lookahead).
- **Weekly brief**: AI-written narrative week-in-review with action items, emails grouped by topic, and the upcoming Mon-Fri school week's events.

Brief scope is user-selectable: actionable emails only, or everything processed.

### 5. Calendar

Events are extracted from every relevant email, not just forwarded ones. The events page is the product's second home surface:

- **Desktop**: dual-view calendar (agenda list + month grid) with mini-month sidebar navigation, inline editing, .ics download, Google Calendar links.
- **Mobile**: a dedicated swipe-first agenda experience (auto-activates on narrow viewports) with day-by-day carousel, filter sheet, and bottom-sheet event details.
- **Subscription feed**: a token-based iCal URL any calendar app can subscribe to, filterable to actionable events only.

Events carry: date/time or all-day flag, location, self-contained bullet details, child assignment (color-coded), to-do flag, actionable flag, and links to every source email. Deleting an event is a soft delete: the same event re-arriving in a later email will not resurrect it.

## The AI Filter (Product View)

The AI makes two independent decisions per email:

- **Relevant**: does this pertain to any listed child (child-specific, grade-level, or school-wide)?
- **Send**: does a parent need to act or know? (An email can be relevant but not worth forwarding.)

Alongside the decision it produces: a rewritten subject, a bullet-point summary, a 1-2 sentence reasoning (shown in the UI as "Why this decision"), extracted events, actionable links (sign-ups, payments, RSVPs), child assignment, and a topic slug that groups related emails across weeks.

### User-controlled filtering knobs

- **Brutal mode**: narrows forwarding to mandatory obligations only (fees, required forms, schedule changes, health/safety, discipline, mandatory meetings). Everything optional gets skipped.
- **Priority activities**: keywords (e.g. "soccer", "debate") that force forwarding even for otherwise-optional emails.
- **Ignored activities**: keywords that suppress emails and their events entirely.
- **Sender rules**: per-sender always-forward / never-forward overrides, creatable with one click from a forwarded email.
- **Summary style**: concise / standard / detailed (concise is the current default and only tuned style).

### Event intelligence

When multiple emails mention the same event, SANE merges them instead of duplicating: exact-title fast path, then AI semantic matching against same-day events. Merges upgrade the title to the most descriptive version, AI-combine the details, union the child assignments, and track every source email.

### Feedback loop

Thumbs up/down on both email decisions and events, in-app and via one-click links in forwarded emails. Feedback patterns generate suggestions ("always forward from this sender?"). With explicit opt-in, encrypted feedback snapshots are retained for future AI improvement analysis.

### Prompt injection defense

School email is untrusted input to an LLM. Email bodies and attachment text are wrapped in untrusted-content tags, and an adversarial fixture dataset exists specifically to regression-test injection resistance.

## Households (Beta)

One household = one primary (owner) + up to 5 members. Designed for two-parent (and caregiver) families who want independent accounts over one email stream.

- **Shared** (keyed to the primary): the Gmail connection, processed emails, events, children, parents, sender rules, and filtering lists.
- **Per-member**: forwarding addresses, delivery settings (each member picks their own forwarding/brief mix), calendar tokens, timezone, brief schedules.
- **Invite flow**: HMAC-signed email invite, 7-day expiry, one-time accept. Joining wipes the member's standalone data (their events/children/rules) and adopts the household's.
- **Lifecycle**: leave, remove member, dissolve. Departing members reset to the setup wizard.

## Account Lifecycle (School-Year Aware)

SANE knows it is a school product: activity requirements pause automatically over summer (June 16 - August 14).

- After 30 school days with no activity (web login, ICS calendar access, or email processing, including the household primary's processing for members), a user enters **WARNING**.
- Warning triggers a 14-day countdown with 3 escalating emails (day 0, day 7, day 13).
- Any activity reactivates immediately, with a welcome-back email if returning from deactivation.
- **DEACTIVATED** pauses monitoring; data is preserved. Household members get a specific notice when their primary deactivates, since their email stream stops too.
- A global admin toggle (`lifecycleEnforcementEnabled`, default off) lets the whole system run in observe-only mode: activity tracked, no enforcement.

Why this exists: abandoned accounts burn Gmail API quota, AI tokens, and Resend sends against inboxes nobody reads.

## Admin & Operations

Built for a small operator (currently single-admin) running an alpha with real families.

- **Dashboard**: system health (DB, Redis, worker heartbeat, queue depth), usage stats, AI feedback rates, brief delivery report, 30-day token usage and estimated cost table.
- **User management**: lifecycle indicators with countdown, per-signal activity dates (web / email / ICS), household annotations, and actions: change email, reset password, force briefs, clear-and-backfill, manual deactivate/reactivate, delete.
- **Daily admin report**: one merged email combining a system heartbeat (users, processing, briefs, health, alerts) with 7 automated anomaly checks (brief gaps, stale connections, AI failure/latency spikes, bounce spikes, stuck webhooks, quota pauses). Header says "Action Required" or "All Systems Normal".
- **Insights page**: diagnostic run history, on-demand runs, and a downloadable markdown context file structured for feeding directly to Claude Code for root-cause analysis.
- **Settings**: everything is DB-backed and admin-editable at runtime, no redeploys: AI provider/model/keys (OpenAI, Anthropic, Gemini, Grok, with test button), all 9 AI prompts, email config, worker schedule, branding, access-code gating, data retention, debug tooling.
- **Error tracking**: Sentry on web, worker, and edge.

## Privacy & Trust Posture

Privacy is a product feature, not just compliance:

- Original email bodies are never stored. Only metadata, AI summaries, and decisions persist.
- All child PII and forwarding addresses are encrypted at rest (AES-256-GCM), as are OAuth tokens, API keys, and AI call logs.
- Gmail access is read-only; SANE never sends from the user's account.
- Feedback snapshots (which contain email context) are strictly opt-in, encrypted, retention-limited, and cascade-deleted with the account.
- Public privacy policy, terms, FAQ, and contact pages; signup can be gated by access code during alpha.

## Current Constraints & Known Boundaries

Honest limits of today's product, useful for next-version planning:

- **Gmail only.** The email-provider layer is abstracted, but Gmail is the only implementation. No Outlook/IMAP.
- **One school-email inbox per household.** Families with per-school or per-child inboxes can't aggregate multiple connections.
- **Global AI configuration.** One provider/model for all users; no per-user model choice or cost tiering.
- **English-first.** Prompts and summaries are not localized.
- **Push, not pull.** No way to ask questions of the accumulated data ("when is picture day?"); users consume forwards, briefs, and the calendar.
- **Reactive extraction.** Events come only from emails; no integration with school calendars, LMS platforms (ParentSquare, ClassDojo, Schoology), or SIS systems, which are where much school communication actually lives.
- **Single-region, small-scale ops.** In-memory rate limiting, single worker, per-user Redis mutex. Fine for alpha scale; not multi-instance ready.
- **Summary styles half-built.** Standard/detailed styles exist in the schema but only concise is tuned and used.
- **No native mobile app.** The mobile agenda is a responsive web experience; no push notifications.

## Signals Worth Mining for v-Next

- Feedback data (email + event thumbs, categorized form feedback) is already collected and admin-visible: a direct read on where the AI disappoints.
- Topic slugs already cluster email threads over time: raw material for thread-level or "story so far" features.
- Salient links extraction already identifies the money moments (payments, sign-ups, RSVPs): raw material for a to-do/action-tracking product surface.
- The diagnostics context file pattern (machine-generated markdown for LLM root-cause analysis) could extend to user-facing AI features over their own data.
