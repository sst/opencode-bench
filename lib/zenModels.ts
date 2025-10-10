import { strict as assert } from "node:assert";

import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { generateObject } from "ai";

type GenerateObjectOptions = Parameters<typeof generateObject>[0];
type SupportedModel = NonNullable<GenerateObjectOptions["model"]>;

const DEFAULT_BASE_URL = "https://opencode.ai/zen/v1";
const OPENCODE_PREFIX = "opencode/";
const API_KEY_ENV_VARS = [
  "OPENCODE_ZEN_API_KEY",
  "OPENCODE_ZEN_KEY",
  "ZEN_API_KEY",
];

type ProviderBundle = {
  openai: ReturnType<typeof createOpenAI>;
  openaiCompatible: ReturnType<typeof createOpenAICompatible>;
  anthropic: ReturnType<typeof createAnthropic>;
};

const modelCache = new Map<string, SupportedModel>();
let providers: ProviderBundle | undefined;

function resolveZenApiKey(): string {
  for (const envName of API_KEY_ENV_VARS) {
    const value = process.env[envName]?.trim();
    if (value) {
      return value;
    }
  }

  assert(
    false,
    [
      "Missing OpenCode Zen API key.",
      "Set OPENCODE_ZEN_KEY (or OPENCODE_ZEN_API_KEY) before running the CLI.",
      "See https://opencode.ai/docs/zen/ for instructions.",
    ].join(" "),
  );
}

function resolveZenBaseUrl(): string {
  const configured = process.env.OPENCODE_ZEN_BASE_URL?.trim();
  if (!configured) {
    return DEFAULT_BASE_URL;
  }

  return configured.replace(/\/+$/, "");
}

function ensureProviders(): ProviderBundle {
  if (providers) {
    return providers;
  }

  const apiKey = resolveZenApiKey();
  const baseURL = resolveZenBaseUrl();

  providers = {
    openai: createOpenAI({
      apiKey,
      baseURL,
    }),
    openaiCompatible: createOpenAICompatible({
      apiKey,
      baseURL,
      name: "opencode",
    }),
    anthropic: createAnthropic({
      apiKey,
      baseURL,
    }),
  };

  return providers;
}

function normalizeModelId(modelId: string): string {
  const trimmed = modelId.trim();
  assert(trimmed.length > 0, "Model identifier cannot be empty.");

  if (trimmed.startsWith(OPENCODE_PREFIX)) {
    return trimmed.slice(OPENCODE_PREFIX.length);
  }

  return trimmed;
}

function inferEndpoint(modelId: string): "responses" | "anthropic" | "chat" {
  const lower = modelId.toLowerCase();

  if (lower.startsWith("claude")) {
    return "anthropic";
  }

  if (lower.startsWith("gpt")) {
    return "responses";
  }

  if (
    lower.startsWith("kimi") ||
    lower.startsWith("grok") ||
    lower.startsWith("qwen")
  ) {
    return "chat";
  }

  return "responses";
}

export function getZenLanguageModel(modelId: string): SupportedModel {
  const normalized = normalizeModelId(modelId);
  const cacheKey = `zen:${normalized}`;

  if (modelCache.has(cacheKey)) {
    return modelCache.get(cacheKey)!;
  }

  const { openai, openaiCompatible, anthropic } = ensureProviders();
  const endpoint = inferEndpoint(normalized);

  let model: SupportedModel;
  switch (endpoint) {
    case "anthropic":
      model = anthropic(normalized) as unknown as SupportedModel;
      break;
    case "responses":
      model = openai.responses(normalized) as unknown as SupportedModel;
      break;
    case "chat":
    default:
      model = openaiCompatible.chatModel(
        normalized,
      ) as unknown as SupportedModel;
      break;
  }

  modelCache.set(cacheKey, model);
  return model;
}
