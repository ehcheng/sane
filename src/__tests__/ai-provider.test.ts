import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCreate = vi.fn();
let lastConstructorArgs: any = null;

// Mock OpenAI SDK — must use a class so `new OpenAI(...)` works
vi.mock("openai", () => {
  return {
    default: class MockOpenAI {
      chat = { completions: { create: mockCreate } };
      constructor(config: any) {
        lastConstructorArgs = config;
      }
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

import { OpenAIProvider, type AIProviderConfig } from "@/server/ai/provider";

beforeEach(() => {
  vi.clearAllMocks();
  lastConstructorArgs = null;
});

describe("OpenAIProvider constructor", () => {
  it("passes apiKey and baseURL to OpenAI client", () => {
    const config: AIProviderConfig = {
      apiKey: "sk-test-123",
      model: "gpt-4.1",
      baseURL: "https://api.x.ai/v1",
      providerName: "grok",
    };

    new OpenAIProvider(config);

    expect(lastConstructorArgs).toEqual({
      apiKey: "sk-test-123",
      baseURL: "https://api.x.ai/v1",
      timeout: 60_000,
    });
  });

  it("omits baseURL when not provided", () => {
    const config: AIProviderConfig = {
      apiKey: "sk-test",
      model: "gpt-4.1",
    };

    new OpenAIProvider(config);

    expect(lastConstructorArgs).toEqual({
      apiKey: "sk-test",
      baseURL: undefined,
      timeout: 60_000,
    });
  });
});

describe("OpenAIProvider.analyzeEmail", () => {
  it("returns correct result with provider and model from config", async () => {
    const config: AIProviderConfig = {
      apiKey: "sk-test",
      model: "gpt-4.1",
      providerName: "grok",
    };

    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              send: true,
              subject: "Test Subject",
              summary: "Test summary",
              children: ["Alice"],
            }),
          },
        },
      ],
      usage: { prompt_tokens: 100, completion_tokens: 50 },
    });

    const provider = new OpenAIProvider(config);
    const result = await provider.analyzeEmail("test prompt");

    expect(result.provider).toBe("grok");
    expect(result.model).toBe("gpt-4.1");
    expect(result.send).toBe(true);
    expect(result.subject).toBe("Test Subject");
    expect(result.tokensInput).toBe(100);
    expect(result.tokensOutput).toBe(50);
  });

  it("uses openai as default provider name in results", async () => {
    const config: AIProviderConfig = {
      apiKey: "sk-test",
      model: "gpt-4.1",
    };

    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({ send: false }),
          },
        },
      ],
      usage: { prompt_tokens: 50, completion_tokens: 20 },
    });

    const provider = new OpenAIProvider(config);
    const result = await provider.analyzeEmail("test prompt");

    expect(result.provider).toBe("openai");
  });
});
