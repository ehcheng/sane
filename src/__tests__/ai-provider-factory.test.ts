import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock Prisma
vi.mock("@/server/db/prisma", () => ({
  prisma: {
    systemConfig: { findUnique: vi.fn() },
  },
}));

// Mock encryption
vi.mock("@/lib/encryption", () => ({
  decrypt: vi.fn().mockReturnValue("decrypted-api-key"),
}));

// Mock OpenAI SDK
vi.mock("openai", () => ({
  default: class MockOpenAI {
    chat = { completions: { create: vi.fn() } };
    _config: any;
    constructor(config: any) {
      this._config = config;
    }
  },
}));

// Mock Anthropic SDK
vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = { create: vi.fn() };
    constructor() {}
  },
}));

// Mock logger
vi.mock("@/lib/logger", () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    aiPrompt: vi.fn(),
    aiResponse: vi.fn(),
  },
}));

import { prisma } from "@/server/db/prisma";
import { decrypt } from "@/lib/encryption";
import { getAIProvider, invalidateProviderCache } from "@/server/ai/provider";
import { OpenAIProvider } from "@/server/ai/provider";
import { AnthropicProvider } from "@/server/ai/anthropic-provider";

const mockFindUnique = vi.mocked(prisma.systemConfig.findUnique);
const mockDecrypt = vi.mocked(decrypt);

beforeEach(() => {
  vi.clearAllMocks();
  invalidateProviderCache();
});

describe("getAIProvider", () => {
  it("returns OpenAIProvider when DB has openai config", async () => {
    mockFindUnique.mockResolvedValue({
      aiProvider: "openai",
      aiModel: "gpt-4.1",
      aiApiKeyEncrypted: Buffer.from("encrypted"),
    } as any);

    const provider = await getAIProvider();
    expect(provider).toBeInstanceOf(OpenAIProvider);
    expect(mockDecrypt).toHaveBeenCalledWith(Buffer.from("encrypted"));
  });

  it("returns AnthropicProvider when DB has anthropic config", async () => {
    mockFindUnique.mockResolvedValue({
      aiProvider: "anthropic",
      aiModel: "claude-sonnet-4-5-20250929",
      aiApiKeyEncrypted: Buffer.from("encrypted"),
    } as any);

    const provider = await getAIProvider();
    expect(provider).toBeInstanceOf(AnthropicProvider);
  });

  it("returns OpenAIProvider with xAI baseURL for grok", async () => {
    mockFindUnique.mockResolvedValue({
      aiProvider: "grok",
      aiModel: "grok-3",
      aiApiKeyEncrypted: Buffer.from("encrypted"),
    } as any);

    const provider = await getAIProvider();
    expect(provider).toBeInstanceOf(OpenAIProvider);
  });

  it("falls back to .env config when DB has no AI config", async () => {
    mockFindUnique.mockResolvedValue({
      aiProvider: null,
      aiModel: null,
      aiApiKeyEncrypted: null,
    } as any);

    await expect(getAIProvider()).rejects.toThrow(
      "No AI provider configured"
    );
  });

  it("throws when no SystemConfig row exists", async () => {
    mockFindUnique.mockResolvedValue(null);

    await expect(getAIProvider()).rejects.toThrow(
      "No AI provider configured"
    );
  });

  it("caches provider for 60s", async () => {
    mockFindUnique.mockResolvedValue({
      aiProvider: "openai",
      aiModel: "gpt-4.1",
      aiApiKeyEncrypted: Buffer.from("encrypted"),
    } as any);

    const first = await getAIProvider();
    const second = await getAIProvider();

    expect(first).toBe(second); // Same instance
    expect(mockFindUnique).toHaveBeenCalledTimes(1); // Only one DB call
  });

  it("refreshes cache after invalidation", async () => {
    mockFindUnique.mockResolvedValue({
      aiProvider: "openai",
      aiModel: "gpt-4.1",
      aiApiKeyEncrypted: Buffer.from("encrypted"),
    } as any);

    const first = await getAIProvider();
    invalidateProviderCache();
    const second = await getAIProvider();

    expect(first).not.toBe(second); // Different instances
    expect(mockFindUnique).toHaveBeenCalledTimes(2);
  });

  it("throws when DB config has provider but no key", async () => {
    mockFindUnique.mockResolvedValue({
      aiProvider: "openai",
      aiModel: "gpt-4.1",
      aiApiKeyEncrypted: null,
    } as any);

    await expect(getAIProvider()).rejects.toThrow(
      "No AI provider configured"
    );
  });
});
