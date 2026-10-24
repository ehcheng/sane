import OpenAI from "openai";
import { parseAIResponse } from "./response-parser";
import { prisma } from "@/server/db/prisma";
import { AnthropicProvider } from "./anthropic-provider";
import type { ImageAttachment, PdfAttachment } from "@/server/attachments/types";
import logger from "@/lib/logger";
import { ANALYZE_MAX_TOKENS, GENERATE_TEXT_MAX_TOKENS } from "./constants";

const TAG = "ai-provider";

export interface AIAnalysisResult {
  relevant: boolean;
  send: boolean;
  subject?: string | null;
  summary?: string | null;
  children?: string[] | null;
  reasoning?: string | null;
  events?: { title: string; date: string; endDate?: string | null; allDay?: boolean; isTodo?: boolean; childName?: string | null; location?: string | null; details?: string | null }[] | null;
  links?: { url: string; label: string }[] | null;
  topicSlug?: string | null;
  tokensInput: number;
  tokensOutput: number;
  latencyMs: number;
  provider: string;
  model: string;
}

export interface AITextResult {
  text: string;
  tokensInput: number;
  tokensOutput: number;
  latencyMs: number;
}

export interface AIProvider {
  readonly providerName: string;
  readonly modelName: string;
  analyzeEmail(prompt: string, images?: ImageAttachment[], pdfAttachments?: PdfAttachment[]): Promise<AIAnalysisResult>;
  generateText(prompt: string): Promise<AITextResult>;
}

export interface AIProviderConfig {
  apiKey: string;
  model: string;
  baseURL?: string;
  providerName?: string;
}

export class OpenAIProvider implements AIProvider {
  private client: OpenAI;
  private model: string;
  readonly providerName: string;
  readonly modelName: string;

  constructor(config: AIProviderConfig) {
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
      timeout: 60_000,
    });
    this.model = config.model;
    this.modelName = config.model;
    this.providerName = config.providerName ?? "openai";
  }

  async analyzeEmail(prompt: string, images?: ImageAttachment[], pdfAttachments?: PdfAttachment[]): Promise<AIAnalysisResult> {
    const pdfCount = this.providerName === "gemini" ? (pdfAttachments?.length ?? 0) : 0;
    logger.debug(TAG, `Calling ${this.model}, prompt length=${prompt.length} chars, images=${images?.length ?? 0}, nativePDFs=${pdfCount}`);
    logger.aiPrompt(TAG, prompt);

    const start = Date.now();

    // Build content parts: text + images + native PDFs (Gemini only)
    const content: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
      { type: "text" as const, text: prompt },
    ];

    if (images && images.length > 0) {
      for (const img of images) {
        content.push({
          type: "image_url" as const,
          image_url: {
            url: `data:${img.mediaType};base64,${img.data}`,
            detail: "auto" as const,
          },
        });
      }
    }

    // Native PDF content parts — Gemini only (translates image_url data URLs to inlineData)
    if (this.providerName === "gemini" && pdfAttachments && pdfAttachments.length > 0) {
      for (const pdf of pdfAttachments) {
        content.push({
          type: "image_url" as const,
          image_url: {
            url: `data:application/pdf;base64,${pdf.data}`,
          },
        });
      }
    }

    let response = await this.client.chat.completions.create({
      model: this.model,
      messages: [{ role: "user", content }],
      response_format: { type: "json_object" },
      temperature: 0.2,
      max_tokens: ANALYZE_MAX_TOKENS,
    });

    const latencyMs = Date.now() - start;

    const finishReason = response.choices[0]?.finish_reason;
    if (finishReason === "length") {
      logger.warn(TAG, `Response truncated (finish_reason=length) after ${latencyMs}ms, output tokens=${response.usage?.completion_tokens ?? "?"}`);
      throw new Error(`AI response truncated: output exceeded ${ANALYZE_MAX_TOKENS} max_tokens (finish_reason=length)`);
    }

    const rawContent = response.choices[0]?.message?.content;
    if (!rawContent) {
      throw new Error("OpenAI returned empty response");
    }

    logger.debug(
      TAG,
      `Response received in ${latencyMs}ms, tokens: in=${response.usage?.prompt_tokens ?? "?"} out=${response.usage?.completion_tokens ?? "?"}`
    );

    let parsed: ReturnType<typeof parseAIResponse>;
    try {
      parsed = parseAIResponse(rawContent);
    } catch {
      // Retry once with a JSON guidance addendum (with backoff)
      logger.info(TAG, "First response was not valid JSON. Retrying with guidance after 2s backoff...");
      await new Promise((resolve) => setTimeout(resolve, 2000));

      const retryStart = Date.now();
      response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          { role: "user", content: prompt },
          {
            role: "assistant",
            content: rawContent,
          },
          {
            role: "user",
            content:
              'Your previous response was not valid JSON. Please respond with valid JSON matching this schema: { "relevant": boolean, "send": boolean, "subject": string or null, "summary": string or null, "children": array of child names or null, "topicSlug": string or null }',
          },
        ],
        response_format: { type: "json_object" },
        temperature: 0,
        max_tokens: ANALYZE_MAX_TOKENS,
      });

      const retryLatency = Date.now() - retryStart;

      if (response.choices[0]?.finish_reason === "length") {
        throw new Error(`AI response truncated on retry: output exceeded ${ANALYZE_MAX_TOKENS} max_tokens`);
      }

      const retryContent = response.choices[0]?.message?.content;
      if (!retryContent) {
        throw new Error("OpenAI returned empty response on retry");
      }

      logger.debug(TAG, `Retry response received in ${retryLatency}ms`);

      parsed = parseAIResponse(retryContent);
      logger.aiResponse(TAG, retryContent, parsed);

      // Accumulate total latency including retry
      const totalLatency = latencyMs + retryLatency;

      const inputTokens =
        (response.usage?.prompt_tokens ?? 0) +
        (response.usage?.prompt_tokens ?? 0);
      const outputTokens =
        (response.usage?.completion_tokens ?? 0) +
        (response.usage?.completion_tokens ?? 0);

      return {
        ...parsed,
        tokensInput: inputTokens,
        tokensOutput: outputTokens,
        latencyMs: totalLatency,
        provider: this.providerName,
        model: this.model,
      };
    }

    logger.aiResponse(TAG, rawContent, parsed);

    return {
      ...parsed,
      tokensInput: response.usage?.prompt_tokens ?? 0,
      tokensOutput: response.usage?.completion_tokens ?? 0,
      latencyMs,
      provider: this.providerName,
      model: this.model,
    };
  }

  async generateText(prompt: string): Promise<AITextResult> {
    logger.debug(TAG, `generateText: Calling ${this.model}, prompt length=${prompt.length} chars`);
    const start = Date.now();

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      max_tokens: GENERATE_TEXT_MAX_TOKENS,
    });

    const latencyMs = Date.now() - start;

    if (response.choices[0]?.finish_reason === "length") {
      logger.warn(TAG, `generateText: Response truncated (finish_reason=length) after ${latencyMs}ms`);
      throw new Error(`AI response truncated: output exceeded ${GENERATE_TEXT_MAX_TOKENS} max_tokens (finish_reason=length)`);
    }

    const text = response.choices[0]?.message?.content ?? "";

    logger.debug(TAG, `generateText: Response in ${latencyMs}ms, tokens: in=${response.usage?.prompt_tokens ?? "?"} out=${response.usage?.completion_tokens ?? "?"}`);

    return {
      text,
      tokensInput: response.usage?.prompt_tokens ?? 0,
      tokensOutput: response.usage?.completion_tokens ?? 0,
      latencyMs,
    };
  }
}

// ---------------------------------------------------------------------------
// Async provider factory with 60s in-memory cache
// ---------------------------------------------------------------------------
// Cache state lives in provider-cache.ts (lightweight, no SDK deps)
// so admin router can import invalidateProviderCache without pulling
// in OpenAI/Anthropic SDKs.

import { providerCache, invalidateProviderCache } from "./provider-cache";
export { invalidateProviderCache };

const CACHE_TTL_MS = 60_000;

export async function getAIProvider(): Promise<AIProvider> {
  const cached = providerCache.entry;
  if (cached && Date.now() < cached.expiresAt) {
    return cached.provider as AIProvider;
  }

  const config = await prisma.systemConfig.findUnique({
    where: { id: "singleton" },
    select: { aiProvider: true, aiModel: true, aiApiKeyEncrypted: true },
  });

  let provider: AIProvider;

  if (!config?.aiProvider || !config.aiModel || !config.aiApiKeyEncrypted) {
    throw new Error(
      "No AI provider configured. An admin must set the AI provider, model, and API key in Admin > Settings."
    );
  }

  const { decrypt } = await import("@/lib/encryption");
  const apiKey = decrypt(config.aiApiKeyEncrypted);

  switch (config.aiProvider) {
    case "anthropic":
      provider = new AnthropicProvider({
        apiKey,
        model: config.aiModel,
      });
      break;
    case "grok":
      provider = new OpenAIProvider({
        apiKey,
        model: config.aiModel,
        baseURL: "https://api.x.ai/v1",
        providerName: "grok",
      });
      break;
    case "gemini":
      provider = new OpenAIProvider({
        apiKey,
        model: config.aiModel,
        baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
        providerName: "gemini",
      });
      break;
    case "openai":
    default:
      provider = new OpenAIProvider({
        apiKey,
        model: config.aiModel,
        providerName: "openai",
      });
      break;
  }

  logger.debug(TAG, `Using DB config: provider=${config.aiProvider} model=${config.aiModel}`);

  providerCache.entry = { provider, expiresAt: Date.now() + CACHE_TTL_MS };
  return provider;
}

/**
 * Gets a vision-capable AI provider if configured.
 * Uses the same provider type and API key as the main provider,
 * but with the vision model name from SystemConfig.aiVisionModel.
 * Returns null if no vision model is configured.
 */
export async function getVisionProvider(): Promise<AIProvider | null> {
  const config = await prisma.systemConfig.findUnique({
    where: { id: "singleton" },
    select: {
      aiProvider: true,
      aiVisionModel: true,
      aiApiKeyEncrypted: true,
    },
  });

  if (!config?.aiVisionModel || !config.aiProvider || !config.aiApiKeyEncrypted) {
    return null;
  }

  const { decrypt } = await import("@/lib/encryption");
  const apiKey = decrypt(config.aiApiKeyEncrypted);

  switch (config.aiProvider) {
    case "anthropic":
      return new AnthropicProvider({
        apiKey,
        model: config.aiVisionModel,
      });
    case "grok":
      return new OpenAIProvider({
        apiKey,
        model: config.aiVisionModel,
        baseURL: "https://api.x.ai/v1",
        providerName: "grok",
      });
    case "gemini":
      return new OpenAIProvider({
        apiKey,
        model: config.aiVisionModel,
        baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
        providerName: "gemini",
      });
    case "openai":
    default:
      return new OpenAIProvider({
        apiKey,
        model: config.aiVisionModel,
        providerName: "openai",
      });
  }
}
