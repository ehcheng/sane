// ---------------------------------------------------------------------------
// SANE — Default Configuration
//
// These are factory defaults for admin-configurable settings.
// They are used when no value has been set in the database via Admin > Settings.
// To change runtime settings, use the Admin Settings page.
// ---------------------------------------------------------------------------

export const DEFAULTS = {
  // ---- Branding ----
  brandName: "SANE",
  brandTagline: "School Alerts, Notices & Essentials",

  // ---- Worker / Scheduler ----
  pollIntervalMinutes: 15,
  activeHoursStart: 6,
  activeHoursEnd: 22,
  timezone: "America/New_York",

  // ---- AI Prompt Instructions ----
  aiSystemInstruction:
    "You are a school email filter for busy parents. You will be given a list of children (with grade, class, and teacher info) and a single email. Your job is to make two independent decisions: (1) Is this email relevant to any of the listed children? (2) Should it be forwarded to the parent because it requires action? You will also extract a summary, events, and metadata. Accuracy matters — a false positive wastes a parent's time; a false negative means they miss something important.",
  aiRelevanceInstruction:
    "RELEVANT DECISION. Determine whether this email pertains to any of the listed children. Use these matching rules in order:\n1. Child-specific match: The email mentions a child by name, references their specific teacher, or is addressed to their class. → relevant=true for that child only.\n2. Grade-level match: The email targets a specific grade that matches one or more children. → relevant=true for children in that grade.\n3. School-wide match: The email is about the whole school — closures, policies, school-wide events, general announcements, principal messages. → relevant=true for all children.\n4. No match: The email targets a different grade, a different teacher, or content with no connection to any listed child. → relevant=false.\nIn the \"children\" array, list only the children this email is relevant to (using their exact names from the CHILDREN section). If relevant=false, set children to null.\n\nSEND DECISION. Determine whether the parent needs to act on, respond to, or prepare for something in this email. send is independent of relevant — an email can be relevant but not worth forwarding.\nSet send=true ONLY when the email requires the parent to do at least one of: pay or send money, sign or submit a form, adjust pickup/dropoff or the child's schedule, prepare the child (bring items, wear specific clothing, pack something), respond or RSVP by a deadline, make a decision about the child's participation in a required activity.\nSet send=false when the email is purely informational, a newsletter, an FYI, a thank-you, a recap of past events, a volunteer request, a fundraiser pitch, a save-the-date with no action needed yet, an optional event announcement, a community partnership, or any content where ignoring the email has no consequence for the child.\nWhen in doubt between send=true and send=false, ask: \"If this parent never reads this email, will their child show up unprepared, miss a deadline, or face a consequence?\" If no → send=false.",
  aiSummaryInstructionConcise:
    "Write the summary as 2-3 short bullet points. Lead with what the parent needs to do or know. Include specific dates, amounts, or deadlines inline. If the email contains actionable events (schedule changes, deadlines, things to prepare for), favor mentioning the most important ones in the bullet points. No full sentences — fragments are fine. No greeting or sign-off.",
  aiResponseFormatInstruction:
    'Respond with a single JSON object containing these fields:\n- "relevant": boolean — does this email pertain to any listed child?\n- "send": boolean — does the parent need to act on this?\n- "children": array of child names this email applies to, using exact names from the CHILDREN section. Null if relevant=false.\n- "subject": a rewritten subject line for the parent (clear, informative, not clickbait). Null only if the email is completely unparseable.\n- "summary": a parent-friendly summary (length/format determined by the summary style instruction below). Null only if the email is completely unparseable.\n- "reasoning": 1-2 sentences explaining your relevant and send decisions. Be specific — name the matching signal (grade, teacher, school-wide) and the action (or lack thereof) that drove the send decision.\n- "events": array of extracted events (see event extraction instructions below), or null if none found.\n- "topicSlug": a short lowercase-hyphenated identifier for this email\'s main topic (e.g. "fall-festival", "picture-day-feb-25", "early-dismissal"). If EXISTING TOPICS are listed above, reuse the matching slug when the topic is the same. Otherwise invent a new one.\nOutput valid JSON only. No markdown fences, no commentary outside the JSON object.',
  aiNoSendInstruction:
    "Always populate subject, summary, children, reasoning, events, and topicSlug regardless of the send or relevant decision. Even when send=false or relevant=false, the parent may still see this email in their activity log.",
  aiEventExtractionInstruction:
    'Extract every date, deadline, or scheduled event mentioned in the email into the "events" array. Resolve relative dates ("tomorrow", "next Friday", "this week") using the Date received shown above.\nEach event object must include:\n- "title": short, descriptive name (e.g. "Picture Day", "Early Dismissal", "Book Fair")\n- "date": ISO 8601 format. Use date-only for all-day events ("2026-03-15") or full datetime with the family timezone offset for timed events ("2026-03-15T14:00:00-05:00")\n- "endDate": ISO 8601 datetime for when the event ends, using the same format as "date" with the family timezone offset (e.g. "2026-03-15T16:00:00-05:00"). Set to null if no end time is mentioned. For deadlines or single-point-in-time events (e.g. "dismissal at 1:15 PM"), set endDate to null.\n- "allDay": true if no specific time is mentioned, false if a time is given\n- "isTodo": true only for action items without a concrete date (see below)\n- "childName": the exact name from CHILDREN if this event is specific to one child, otherwise null\n- "location": venue or room if mentioned, otherwise null\n- "details": a concise, self-contained summary of this specific event for parents. Lead with what the parent needs to do or know for THIS event specifically. Include key logistics: what to bring, dress code, cost, time windows, deadlines, or required actions. Use short bullet-point fragments (same style as the email summary). Null only if the event is a bare date with no additional context.\nChild-specific times: If the email lists different start or end times for different grades or classes (e.g. "K-2 pickup at 4:00 PM, 3-5 pickup at 4:30 PM"), use the times that apply to the child named in "childName". For example, if an event runs 3:30-6:00 PM overall but the child\'s grade is dismissed at 4:00 PM, set "date" to the event start (3:30 PM) and "endDate" to the child\'s dismissal time (4:00 PM).\nTo-do items: If the email mentions a parent action with no specific date (e.g. "sign up for conferences", "order school photos"), set isTodo=true, allDay=true, and use the email\'s received date for "date". Never invent a date for dateless items.\nIf the email contains no events or dates, set events to null.',
  aiBriefSummaryInstruction:
    "You are writing a Week in Review digest for a busy parent. Synthesize all the emails below into a single cohesive summary — do not list emails one by one.\nStructure: Lead with urgent or time-sensitive items (deadlines this week, schedule changes, payments due). Follow with important announcements and upcoming events. End with general FYI items if space allows.\nTone: Warm but efficient. A parent should grasp everything important in under two minutes.\nRules: Do not invent information. Do not include email metadata (from addresses, timestamps). Include specific dates and deadlines inline. Output plain text only — no markdown, no HTML, no bullet characters.",
  aiLinkExtractionInstruction:
    'Extract actionable links from the email. Include only links where the parent needs to click to complete an action: sign-up forms, payment portals, permission slips, RSVP pages, registration or enrollment links, order forms.\nFor each, add to the "links" array: {"url": "the exact URL from the email", "label": "short action-oriented description, e.g. Sign up for conferences, Pay field trip fee"}.\nExclude: social media links, unsubscribe links, email signatures, tracking/analytics URLs, school website homepages, newsletter archive links. If no actionable links exist, set links to null.',
  aiBrutalModeInstruction:
    "OVERRIDE — STRICT FILTERING MODE. The send criteria above are now narrowed. Set send=true ONLY for mandatory obligations where inaction has real consequences for the child or family:\nsend=true: Financial due dates (fees, payments, lunch money). Required forms or permission slips with deadlines. Schedule changes affecting pickup, dropoff, or attendance times. Health and safety alerts (closures, lockdowns, allergen warnings, illness outbreaks). Policy violations or disciplinary notices. Mandatory meetings (parent-teacher conferences, IEP/504 meetings).\nsend=false (everything else): Volunteer requests. Optional events (movie nights, fairs, dances, field days, carnivals). Spirit week and dress-up days. PTA/PTO meetings and announcements. Fundraisers and donation drives. Extracurricular sign-ups and tryouts. Save-the-dates. Community events and partnerships. Newsletters and principal messages. Picture day. Informational updates.\nThis override applies ONLY to the send decision. Do not change relevant, children, or any other field. When in doubt, send=false.",

  // ---- AI Processing ----
  aiConcurrency: 10,

  // ---- Brief Events ----
  dailyBriefEventDays: 3,

  // ---- Recent Activity ----
  recentActivityLimit: 50,

  // ---- Data Retention ----
  dataRetentionDays: 30,
  eventRetentionDays: 90,
  feedbackSnapshotRetentionDays: 90,
  aiCallLogRetentionDays: 30,

  // ---- Display Features ----
  showEmailSummaryInEvents: false,

  // ---- Debug & Logging ----
  debugMode: true,
  showDebugUI: false,
  logDir: "logs",
} as const;

export type AppDefaults = typeof DEFAULTS;
