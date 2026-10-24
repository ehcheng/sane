import { aiResponseSchema, type AIResponse } from "@/lib/validators";

export function parseAIResponse(raw: string): AIResponse {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      `AI response is not valid JSON: ${raw.substring(0, 200)}`
    );
  }

  // Normalize common GPT quirks before validation.
  // GPT sometimes returns subject/summary as arrays of bullet points.
  if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    if (Array.isArray(obj.subject)) {
      obj.subject = obj.subject.join(" ");
    }
    if (Array.isArray(obj.summary)) {
      obj.summary = obj.summary.join("\n");
    }
    // Default `relevant` to true if missing (backward compat with older prompts)
    if (obj.relevant === undefined || obj.relevant === null) {
      obj.relevant = true;
    }
  }

  const result = aiResponseSchema.safeParse(parsed);

  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(`AI response failed schema validation: ${issues}`);
  }

  const response = result.data;

  // Enforce invariant: send=true implies relevant=true
  if (response.send && !response.relevant) {
    response.relevant = true;
  }

  // Filter events with invalid dates (allow isTodo events through)
  // Sanitize endDate: null out if invalid or before start date
  if (response.events) {
    response.events = response.events.filter(
      (e) => e.isTodo || !isNaN(new Date(e.date).getTime())
    );
    for (const e of response.events) {
      if (e.endDate) {
        const endMs = new Date(e.endDate).getTime();
        const startMs = new Date(e.date).getTime();
        if (isNaN(endMs) || (!isNaN(startMs) && endMs < startMs)) {
          e.endDate = null;
        }
      }
    }
    if (response.events.length === 0) {
      response.events = null;
    }
  }

  // Filter links with invalid URLs
  if (response.links) {
    response.links = response.links.filter((l) => {
      try {
        new URL(l.url);
        return true;
      } catch {
        return false;
      }
    });
    if (response.links.length === 0) {
      response.links = null;
    }
  }

  // If send=true, subject and summary must be non-empty strings
  if (response.send) {
    if (!response.subject || response.subject.trim().length === 0) {
      throw new Error(
        "AI response has send=true but subject is missing or empty"
      );
    }
    if (!response.summary || response.summary.trim().length === 0) {
      throw new Error(
        "AI response has send=true but summary is missing or empty"
      );
    }
  }

  return response;
}
