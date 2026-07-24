/**
 * Pure helpers for in-page Format stream progress / request ids.
 * No chrome.* or DOM — unit-test friendly.
 */

/** Compact button label while an in-page Format stream is running. */
export function formatStreamProgressLabel(charCount: number): string {
  if (!Number.isFinite(charCount) || charCount <= 0) return "Formatting…";
  if (charCount < 1000) return `Formatting… ${Math.floor(charCount)} chars`;
  if (charCount < 10_000) {
    const k = (charCount / 1000).toFixed(1);
    return `Formatting… ${k}k chars`;
  }
  return `Formatting… ${Math.floor(charCount / 1000)}k chars`;
}

/** Opaque id so progress / cancel messages match one in-flight Format. */
export function createFormatRequestId(): string {
  const rand =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `fmt-${rand}`;
}
