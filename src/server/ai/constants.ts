/** Max output tokens for structured email analysis (JSON response) */
export const ANALYZE_MAX_TOKENS = 16_384;

/** Max output tokens for free-form text generation (briefs, dedup, merge) */
export const GENERATE_TEXT_MAX_TOKENS = 32_768;

/** Max characters of email body to include in analysis prompt */
export const EMAIL_BODY_MAX_CHARS = 50_000;

/** Max characters for attached document text per attachment */
export const DOC_TEXT_MAX_CHARS = 30_000;

/** Max total characters for weekly brief prompt (all email bodies combined) */
export const WEEKLY_BRIEF_PROMPT_MAX_CHARS = 200_000;
