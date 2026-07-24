/**
 * Typed message protocol between the content script and the service worker.
 * Keep this free of DOM / chrome APIs so unit tests can import it directly.
 */

export const FORMAT_PR_DESCRIPTION = "md-formatter/format-pr-description" as const;
export const CANCEL_FORMAT_PR_DESCRIPTION =
  "md-formatter/cancel-format-pr-description" as const;
export const FORMAT_PR_PROGRESS = "md-formatter/format-pr-progress" as const;

export interface FormatPrDescriptionRequest {
  type: typeof FORMAT_PR_DESCRIPTION;
  /** Raw text from the PR description editor. */
  input: string;
  /** Correlates progress / cancel with this in-flight Format. */
  requestId: string;
}

export interface CancelFormatPrDescriptionRequest {
  type: typeof CANCEL_FORMAT_PR_DESCRIPTION;
  requestId: string;
}

/** Fire-and-forget stream progress from the service worker → content script. */
export interface FormatPrProgressMessage {
  type: typeof FORMAT_PR_PROGRESS;
  requestId: string;
  /** Characters accumulated so far (SSE deltas or offline one-shot). */
  accumulatedChars: number;
}

export type FormatPrDescriptionResponse =
  | { ok: true; markdown: string }
  | { ok: false; error: string }
  | { ok: false; cancelled: true };

export type CancelFormatPrDescriptionResponse = {
  ok: true;
  /** True when a live job was aborted. */
  cancelled: boolean;
};

export function isFormatPrDescriptionRequest(
  value: unknown,
): value is FormatPrDescriptionRequest {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    v.type === FORMAT_PR_DESCRIPTION &&
    typeof v.input === "string" &&
    typeof v.requestId === "string" &&
    v.requestId.length > 0
  );
}

export function isCancelFormatPrDescriptionRequest(
  value: unknown,
): value is CancelFormatPrDescriptionRequest {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    v.type === CANCEL_FORMAT_PR_DESCRIPTION &&
    typeof v.requestId === "string" &&
    v.requestId.length > 0
  );
}

export function isFormatPrProgressMessage(
  value: unknown,
): value is FormatPrProgressMessage {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    v.type === FORMAT_PR_PROGRESS &&
    typeof v.requestId === "string" &&
    v.requestId.length > 0 &&
    typeof v.accumulatedChars === "number" &&
    Number.isFinite(v.accumulatedChars)
  );
}

export function isCancelledFormatResponse(
  value: FormatPrDescriptionResponse | null | undefined,
): boolean {
  return Boolean(value && value.ok === false && "cancelled" in value && value.cancelled);
}
