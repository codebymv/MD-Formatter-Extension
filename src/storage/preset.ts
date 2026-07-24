import { FormatPreset, PRESETS } from "../formatter/types";

const STORAGE_KEY = "preset";
const DEFAULT_PRESET: FormatPreset = "standard";

/**
 * Persisted formatting preset (popup selector ↔ content-script Format button).
 * Falls back to in-memory when `chrome.storage` is unavailable (dev preview).
 */

let memoryFallback: FormatPreset | null = null;

function hasChromeStorage(): boolean {
  return (
    typeof chrome !== "undefined" &&
    !!chrome.storage &&
    !!chrome.storage.local
  );
}

function isFormatPreset(value: unknown): value is FormatPreset {
  return typeof value === "string" && value in PRESETS;
}

export async function loadPreset(): Promise<FormatPreset> {
  if (!hasChromeStorage()) {
    return memoryFallback ?? DEFAULT_PRESET;
  }
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const raw = stored?.[STORAGE_KEY];
  return isFormatPreset(raw) ? raw : DEFAULT_PRESET;
}

export async function savePreset(preset: FormatPreset): Promise<void> {
  const normalized = isFormatPreset(preset) ? preset : DEFAULT_PRESET;
  if (!hasChromeStorage()) {
    memoryFallback = normalized;
    return;
  }
  await chrome.storage.local.set({ [STORAGE_KEY]: normalized });
}
