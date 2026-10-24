import { describe, it, expect, vi, beforeEach } from "vitest";

const mockMessagesCreate = vi.fn();

// Mock Anthropic SDK
vi.mock("@anthropic-ai/sdk", () => {
  return {
    default: class MockAnthropic {
      messages = { create: mockMessagesCreate };
      constructor() {}
    },
  };
});

// Mock logger
vi.mock("@/lib/logger", () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    aiPrompt: vi.fn(),
    aiResponse: vi.fn(),
  },
}));

import { AnthropicProvider } from "@/server/ai/anthropic-provider";
import type { AIProviderConfig } from "@/server/ai/provider";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AnthropicProvider.analyzeEmail", () => {
  const config: AIProviderConfig = {
    apiKey: "sk-ant-test",
    model: "claude-sonnet-4-5-20250929",
  };

  it("returns correct result with anthropic provider name", async () => {
    mockMessagesCreate.mockResolvedValue({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            send: true,
            subject: "School Event",
            summary: "There's a school event on Friday.",
            children: ["Bob"],
          }),
        },
      ],
      usage: { input_tokens: 200, output_tokens: 80 },
    });

    const provider = new AnthropicProvider(config);
    const result = await provider.analyzeEmail("test prompt");

    expect(result.provider).toBe("anthropic");
    expect(result.model).toBe("claude-sonnet-4-5-20250929");
    expect(result.send).toBe(true);
    expect(result.subject).toBe("School Event");
    expect(result.tokensInput).toBe(200);
    expect(result.tokensOutput).toBe(80);
  });

  it("handles send=false response", async () => {
    mockMessagesCreate.mockResolvedValue({
      content: [{ type: "text", text: JSON.stringify({ send: false }) }],
      usage: { input_tokens: 100, output_tokens: 20 },
    });

    const provider = new AnthropicProvider(config);
    const result = await provider.analyzeEmail("test prompt");

    expect(result.send).toBe(false);
    expect(result.provider).toBe("anthropic");
  });

  it("retries on invalid JSON and accumulates tokens", async () => {
    // First call returns invalid JSON
    mockMessagesCreate
      .mockResolvedValueOnce({
        content: [{ type: "text", text: "Not valid JSON at all" }],
        usage: { input_tokens: 100, output_tokens: 30 },
      })
      // Retry returns valid JSON
      .mockResolvedValueOnce({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              send: true,
              subject: "Retry Subject",
              summary: "Retry summary",
            }),
          },
        ],
        usage: { input_tokens: 150, output_tokens: 40 },
      });

    const provider = new AnthropicProvider(config);
    const result = await provider.analyzeEmail("test prompt");

    expect(result.send).toBe(true);
    expect(result.subject).toBe("Retry Subject");
    expect(result.tokensInput).toBe(250); // 100 + 150
    expect(result.tokensOutput).toBe(70); // 30 + 40
    expect(mockMessagesCreate).toHaveBeenCalledTimes(2);
  });

  it("throws when Anthropic returns empty content", async () => {
    mockMessagesCreate.mockResolvedValue({
      content: [],
      usage: { input_tokens: 0, output_tokens: 0 },
    });

    const provider = new AnthropicProvider(config);
    await expect(provider.analyzeEmail("test")).rejects.toThrow(
      "Anthropic returned empty response"
    );
  });
});
