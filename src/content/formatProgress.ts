/**
 * Pure helpers for in-page stream progress / request ids.
 * No chrome.* or DOM — unit-test friendly.
 */

export type InPageJobKind = "format" | "quiz" | "pitch";

function progressVerb(kind: InPageJobKind): string {
  if (kind === "quiz") return "Quizzing";
  if (kind === "pitch") return "Pitching";
  return "Formatting";
}

function requestIdPrefix(kind: InPageJobKind): string {
  if (kind === "quiz") return "quiz";
  if (kind === "pitch") return "pitch";
  return "fmt";
}

/** Compact button label while an in-page model stream is running. */
export function streamProgressLabel(kind: InPageJobKind, charCount: number): string {
  const verb = progressVerb(kind);
  if (!Number.isFinite(charCount) || charCount <= 0) return `${verb}…`;
  if (charCount < 1000) return `${verb}… ${Math.floor(charCount)} chars`;
  if (charCount < 10_000) {
    const k = (charCount / 1000).toFixed(1);
    return `${verb}… ${k}k chars`;
  }
  return `${verb}… ${Math.floor(charCount / 1000)}k chars`;
}

/** Compact button label while an in-page Format stream is running. */
export function formatStreamProgressLabel(charCount: number): string {
  return streamProgressLabel("format", charCount);
}

/** Opaque id so progress / cancel messages match one in-flight job. */
export function createJobRequestId(kind: InPageJobKind = "format"): string {
  const rand =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${requestIdPrefix(kind)}-${rand}`;
}

/** Opaque id so progress / cancel messages match one in-flight Format. */
export function createFormatRequestId(): string {
  return createJobRequestId("format");
}
