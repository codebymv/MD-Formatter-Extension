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

export async function loadSettings(): Promise<Settings> {
  if (!hasChromeStorage()) {
    return { ...DEFAULT_SETTINGS, ...(memoryFallback ?? {}) };
  }
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const raw = (stored?.[STORAGE_KEY] ?? {}) as Partial<Settings>;
  return { ...DEFAULT_SETTINGS, ...raw };
}

export async function saveSettings(settings: Settings): Promise<void> {
  const normalized: Settings = {
    apiKey: settings.apiKey.trim(),
    model: settings.model.trim() || DEFAULT_SETTINGS.model,
    baseUrl: (settings.baseUrl.trim() || DEFAULT_SETTINGS.baseUrl).replace(/\/+$/, ""),
  };
  if (!hasChromeStorage()) {
    memoryFallback = normalized;
    return;
  }
  await chrome.storage.local.set({ [STORAGE_KEY]: normalized });
}
