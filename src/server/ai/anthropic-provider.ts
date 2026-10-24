import Anthropic from "@anthropic-ai/sdk";
import { parseAIResponse } from "./response-parser";
import logger from "@/lib/logger";
import type { AIProvider, AIProviderConfig, AIAnalysisResult, AITextResult } from "./provider";
import type { ImageAttachment, PdfAttachment } from "@/server/attachments/types";
import { ANALYZE_MAX_TOKENS, GENERATE_TEXT_MAX_TOKENS } from "./constants";

const TAG = "anthropic-provider";

export class AnthropicProvider implements AIProvider {
  readonly providerName = "anthropic";
  readonly modelName: string;
  private client: Anthropic;
  private model: string;

  constructor(config: AIProviderConfig) {
    this.client = new Anthropic({ apiKey: config.apiKey, timeout: 60_000 });
    this.model = config.model;
    this.modelName = config.model;
  }

  async analyzeEmail(prompt: string, images?: ImageAttachment[], _pdfAttachments?: PdfAttachment[]): Promise<AIAnalysisResult> {
    logger.debug(TAG, `Calling ${this.model}, prompt length=${prompt.length} chars, images=${images?.length ?? 0}`);
    logger.aiPrompt(TAG, prompt);

    const start = Date.now();

    // Build content: text-only or multimodal with images
    const content: Anthropic.Messages.ContentBlockParam[] =
      images && images.length > 0
        ? [
            { type: "text" as const, text: prompt },
            ...images.map((img) => ({
              type: "image" as const,
              source: {
                type: "base64" as const,
                media_type: img.mediaType,
                data: img.data,
              },
            })),
          ]
        : [{ type: "text" as const, text: prompt }];

    // Anthropic doesn't support response_format: json_object,
    // so we instruct JSON in the prompt via the system message.
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: ANALYZE_MAX_TOKENS,
      system:
        'You must respond with valid JSON only. No markdown, no code fences, no extra text. Just the JSON object.',
      messages: [{ role: "user", content }],
      temperature: 0.2,
    });

    const latencyMs = Date.now() - start;

    if (response.stop_reason === "max_tokens") {
      logger.warn(TAG, `Response truncated (stop_reason=max_tokens) after ${latencyMs}ms, output tokens=${response.usage.output_tokens}`);
      throw new Error(`AI response truncated: output exceeded ${ANALYZE_MAX_TOKENS} max_tokens (stop_reason=max_tokens)`);
    }

    const rawContent =
      response.content[0]?.type === "text" ? response.content[0].text : null;
    if (!rawContent) {
      throw new Error("Anthropic returned empty response");
    }

    logger.debug(
      TAG,
      `Response received in ${latencyMs}ms, tokens: in=${response.usage.input_tokens} out=${response.usage.output_tokens}`
    );

    let parsed: ReturnType<typeof parseAIResponse>;
    try {
      parsed = parseAIResponse(rawContent);
    } catch {
      // Retry once with JSON guidance (with backoff)
      logger.info(TAG, "First response was not valid JSON. Retrying with guidance after 2s backoff...");
      await new Promise((resolve) => setTimeout(resolve, 2000));

      const retryStart = Date.now();
      const retryResponse = await this.client.messages.create({
        model: this.model,
        max_tokens: ANALYZE_MAX_TOKENS,
        system:
          'You must respond with valid JSON only. No markdown, no code fences, no extra text.',
        messages: [
          { role: "user", content: prompt },
          { role: "assistant", content: rawContent },
          {
            role: "user",
            content:
              'Your previous response was not valid JSON. Please respond with valid JSON matching this schema: { "send": boolean, "subject": string or null, "summary": string or null, "children": array of child names or null }',
          },
        ],
        temperature: 0,
      });

      const retryLatency = Date.now() - retryStart;

      if (retryResponse.stop_reason === "max_tokens") {
        throw new Error(`AI response truncated on retry: output exceeded ${ANALYZE_MAX_TOKENS} max_tokens`);
      }

      const retryContent =
        retryResponse.content[0]?.type === "text"
          ? retryResponse.content[0].text
          : null;
      if (!retryContent) {
        throw new Error("Anthropic returned empty response on retry");
      }

      logger.debug(TAG, `Retry response received in ${retryLatency}ms`);

      parsed = parseAIResponse(retryContent);
      logger.aiResponse(TAG, retryContent, parsed);

      const totalLatency = latencyMs + retryLatency;
      const inputTokens =
        response.usage.input_tokens + retryResponse.usage.input_tokens;
      const outputTokens =
        response.usage.output_tokens + retryResponse.usage.output_tokens;

      return {
        ...parsed,
        tokensInput: inputTokens,
        tokensOutput: outputTokens,
        latencyMs: totalLatency,
        provider: "anthropic",
        model: this.model,
      };
    }

    logger.aiResponse(TAG, rawContent, parsed);

    return {
      ...parsed,
      tokensInput: response.usage.input_tokens,
      tokensOutput: response.usage.output_tokens,
      latencyMs,
      provider: "anthropic",
      model: this.model,
    };
  }

  async generateText(prompt: string): Promise<AITextResult> {
    logger.debug(TAG, `generateText: Calling ${this.model}, prompt length=${prompt.length} chars`);
    const start = Date.now();

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: GENERATE_TEXT_MAX_TOKENS,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
    });

    const latencyMs = Date.now() - start;

    if (response.stop_reason === "max_tokens") {
      logger.warn(TAG, `generateText: Response truncated (stop_reason=max_tokens) after ${latencyMs}ms`);
      throw new Error(`AI response truncated: output exceeded ${GENERATE_TEXT_MAX_TOKENS} max_tokens`);
    }

    const text = response.content[0]?.type === "text" ? response.content[0].text : "";

    logger.debug(TAG, `generateText: Response in ${latencyMs}ms, tokens: in=${response.usage.input_tokens} out=${response.usage.output_tokens}`);

    return {
      text,
      tokensInput: response.usage.input_tokens,
      tokensOutput: response.usage.output_tokens,
      latencyMs,
    };
  }
}
