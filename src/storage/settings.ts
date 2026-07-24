import {
  DEFAULT_ENDPOINT_PRESET,
  isEndpointPresetId,
  normalizeBaseUrl,
} from "../formatter/endpointPresets";
import { DEFAULT_SETTINGS, Settings } from "../formatter/types";

const STORAGE_KEY = "settings";

/**
 * Settings persistence over `chrome.storage.local`. Falls back to an in-memory
 * store when run outside the extension context (e.g. a plain Vite dev preview),
 * so the UI still works for development.
 */

let memoryFallback: Settings | null = null;

function hasChromeStorage(): boolean {
  return (
    typeof chrome !== "undefined" &&
    !!chrome.storage &&
    !!chrome.storage.local
  );
}

function normalizeSettings(raw: Partial<Settings>): Settings {
  const endpointPreset = isEndpointPresetId(raw.endpointPreset)
    ? raw.endpointPreset
    : DEFAULT_ENDPOINT_PRESET;
  return {
    apiKey: typeof raw.apiKey === "string" ? raw.apiKey.trim() : DEFAULT_SETTINGS.apiKey,
    model:
      typeof raw.model === "string" && raw.model.trim()
        ? raw.model.trim()
        : DEFAULT_SETTINGS.model,
    baseUrl: normalizeBaseUrl(
      typeof raw.baseUrl === "string" ? raw.baseUrl : "",
      DEFAULT_SETTINGS.baseUrl,
    ),
    endpointPreset,
  };
}

export async function loadSettings(): Promise<Settings> {
  if (!hasChromeStorage()) {
    return normalizeSettings(memoryFallback ?? {});
  }
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const raw = (stored?.[STORAGE_KEY] ?? {}) as Partial<Settings>;
  return normalizeSettings(raw);
}

export async function saveSettings(settings: Settings): Promise<void> {
  const normalized = normalizeSettings(settings);
  if (!hasChromeStorage()) {
    memoryFallback = normalized;
    return;
  }
  await chrome.storage.local.set({ [STORAGE_KEY]: normalized });
}
