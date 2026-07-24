/**
 * Built-in OpenAI-compatible endpoint presets (OpenAI, Ollama, OpenRouter, Custom).
 * Pure helpers — no chrome APIs, no network. Settings persistence lives in storage/.
 */

export type EndpointPresetId = "openai" | "ollama" | "openrouter" | "custom";

export interface EndpointPresetMeta {
  id: EndpointPresetId;
  label: string;
  /** Default chat model for this endpoint. */
  model: string;
  /** OpenAI-compatible base URL (…/v1, no trailing slash). */
  baseUrl: string;
  /** When false, Format may call the endpoint with an empty API key. */
  requiresApiKey: boolean;
  /** Short settings hint shown under the endpoint picker. */
  hint: string;
}

export const ENDPOINT_PRESETS: Record<EndpointPresetId, EndpointPresetMeta> = {
  openai: {
    id: "openai",
    label: "OpenAI",
    model: "gpt-4.1-mini",
    baseUrl: "https://api.openai.com/v1",
    requiresApiKey: true,
    hint: "Uses OpenAI’s chat completions API. Paste an API key to enable the model formatter.",
  },
  ollama: {
    id: "ollama",
    label: "Ollama (local)",
    model: "llama3.2",
    baseUrl: "http://localhost:11434/v1",
    requiresApiKey: false,
    hint: "Local OpenAI-compatible endpoint. API key optional (leave blank). Pull the model with ollama pull first.",
  },
  openrouter: {
    id: "openrouter",
    label: "OpenRouter",
    model: "openai/gpt-4.1-mini",
    baseUrl: "https://openrouter.ai/api/v1",
    requiresApiKey: true,
    hint: "OpenAI-compatible proxy. Use an OpenRouter API key and any routed model id.",
  },
  custom: {
    id: "custom",
    label: "Custom",
    model: "gpt-4.1-mini",
    baseUrl: "https://api.openai.com/v1",
    requiresApiKey: true,
    hint: "Any OpenAI-compatible base URL (Azure, LM Studio, self-hosted, etc.).",
  },
};

export const DEFAULT_ENDPOINT_PRESET: EndpointPresetId = "openai";

export function isEndpointPresetId(value: unknown): value is EndpointPresetId {
  return typeof value === "string" && value in ENDPOINT_PRESETS;
}

export function normalizeBaseUrl(baseUrl: string, fallback: string): string {
  const trimmed = baseUrl.trim();
  const raw = trimmed || fallback;
  return raw.replace(/\/+$/, "");
}

/**
 * Apply a built-in endpoint preset’s model + base URL.
 * Preserves the API key. Choosing Custom does not rewrite model/baseUrl
 * (user is editing freely); other presets stamp their defaults.
 */
export function applyEndpointPreset<T extends { model: string; baseUrl: string; endpointPreset: EndpointPresetId }>(
  settings: T,
  presetId: EndpointPresetId,
): T {
  const id = isEndpointPresetId(presetId) ? presetId : DEFAULT_ENDPOINT_PRESET;
  if (id === "custom") {
    return { ...settings, endpointPreset: "custom" };
  }
  const meta = ENDPOINT_PRESETS[id];
  return {
    ...settings,
    endpointPreset: id,
    model: meta.model,
    baseUrl: meta.baseUrl,
  };
}

/** True when settings should hit the chat-completions API instead of the offline formatter. */
export function shouldUseApi(settings: {
  apiKey: string;
  endpointPreset: EndpointPresetId;
}): boolean {
  if (settings.apiKey.trim()) return true;
  const id = isEndpointPresetId(settings.endpointPreset)
    ? settings.endpointPreset
    : DEFAULT_ENDPOINT_PRESET;
  return !ENDPOINT_PRESETS[id].requiresApiKey;
}
