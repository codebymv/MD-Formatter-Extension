export type DiffPreviewLayout = "unified" | "columns";

const STORAGE_KEY = "diffLayout";
export const DEFAULT_DIFF_LAYOUT: DiffPreviewLayout = "columns";

/**
 * Persisted Columns / Unified diff-preview preference
 * (popup ↔ content-script Format preview). Falls back to in-memory when
 * `chrome.storage` is unavailable (dev preview / unit tests).
 */

let memoryFallback: DiffPreviewLayout | null = null;

function hasChromeStorage(): boolean {
  return (
    typeof chrome !== "undefined" &&
    !!chrome.storage &&
    !!chrome.storage.local
  );
}

export function isDiffPreviewLayout(value: unknown): value is DiffPreviewLayout {
  return value === "unified" || value === "columns";
}

export async function loadDiffLayout(): Promise<DiffPreviewLayout> {
  if (!hasChromeStorage()) {
    return memoryFallback ?? DEFAULT_DIFF_LAYOUT;
  }
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const raw = stored?.[STORAGE_KEY];
  return isDiffPreviewLayout(raw) ? raw : DEFAULT_DIFF_LAYOUT;
}

export async function saveDiffLayout(layout: DiffPreviewLayout): Promise<void> {
  const normalized = isDiffPreviewLayout(layout) ? layout : DEFAULT_DIFF_LAYOUT;
  if (!hasChromeStorage()) {
    memoryFallback = normalized;
    return;
  }
  await chrome.storage.local.set({ [STORAGE_KEY]: normalized });
}
