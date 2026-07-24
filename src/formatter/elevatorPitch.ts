/**
 * "Elevator pitch" — model-backed short pitch from a PR / release description.
 * Requires a configured chat endpoint (no offline heuristic).
 * Pure helpers + injectable fetch so unit tests never need a live model.
 */

import { shouldUseApi } from "./endpointPresets";
import { stripCodeFenceWrapper } from "./formatPrDescription";
import { streamChatCompletion } from "./sseChatStream";
import { FormatterError, Settings } from "./types";
import { loadSettings } from "../storage/settings";

export interface GenerateElevatorPitchOptions {
  onChunk?: (accumulated: string) => void;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  /** Soft target sentence count (clamped 2–4). Prompt guidance only. */
  sentenceCount?: number;
}

export const PITCH_SYSTEM_PROMPT = `You are a product communications coach.

Given a pull-request or release description, write a short elevator pitch a teammate could say aloud in about 30 seconds.

Rules:
- Use ONLY facts present in the input. Do not invent features, files, routes, tests, or outcomes.
- Prefer concrete outcomes (what changed, why it matters, who benefits) over vague hype.
- Return plain prose only — no headings, bullets, numbered lists, preamble, or closing commentary.
- Aim for 2–4 short sentences. No quotes around the whole pitch.`;

export function clampPitchSentenceCount(n: number): number {
  if (!Number.isFinite(n)) return 3;
  return Math.min(4, Math.max(2, Math.round(n)));
}

export function buildPitchUserPrompt(input: string, sentenceCount = 3): string {
  const n = clampPitchSentenceCount(sentenceCount);
  return `Write an elevator pitch of about ${n} sentences for this release / PR description.

Raw description:
${input.trim()}`;
}

/**
 * Normalize model output into a single pitch paragraph.
 * Strips outer fences, leading labels, and collapses excess whitespace.
 */
export function normalizeElevatorPitch(text: string): string {
  let body = stripCodeFenceWrapper(text).replace(/\r\n/g, "\n").trim();
  if (!body) return "";

  body = body.replace(
    /^(?:elevator\s+pitch|pitch)\s*[:\-–—]\s*/i,
    "",
  );
  // Drop surrounding quotes if the whole answer is quoted.
  if (
    (body.startsWith('"') && body.endsWith('"')) ||
    (body.startsWith("'") && body.endsWith("'"))
  ) {
    body = body.slice(1, -1).trim();
  }

  return body
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Rough sentence count for validation / tests (splits on . ! ?). */
export function countPitchSentences(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  const parts = trimmed
    .split(/(?<=[.!?])\s+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  return parts.length;
}

/**
 * Generate an elevator pitch via the configured OpenAI-compatible endpoint.
 * Throws FormatterError when no model endpoint is configured (offline-only).
 */
export async function generateElevatorPitch(
  input: string,
  settings?: Settings,
  options?: GenerateElevatorPitchOptions,
): Promise<{ markdown: string; sentenceCount: number }> {
  if (!input || !input.trim()) {
    throw new FormatterError("Paste a PR description first — the input is empty.");
  }

  const resolved = settings ?? (await loadSettings());
  if (!shouldUseApi(resolved)) {
    throw new FormatterError(
      "Elevator pitch needs a model endpoint. Open Settings and add an API key, or pick the Ollama preset.",
    );
  }

  const sentenceCount = clampPitchSentenceCount(options?.sentenceCount ?? 3);
  const content = await streamChatCompletion({
    baseUrl: resolved.baseUrl,
    apiKey: resolved.apiKey,
    model: resolved.model,
    temperature: 0.4,
    signal: options?.signal,
    fetchImpl: options?.fetchImpl,
    onDelta: (_delta, accumulated) => {
      options?.onChunk?.(accumulated);
    },
    messages: [
      { role: "system", content: PITCH_SYSTEM_PROMPT },
      { role: "user", content: buildPitchUserPrompt(input, sentenceCount) },
    ],
  });

  const markdown = normalizeElevatorPitch(content);
  if (!markdown || markdown.length < 20) {
    throw new FormatterError(
      "The model returned a pitch that was empty or too short. Try again, or check the model output.",
    );
  }

  if (markdown !== content.trim()) {
    options?.onChunk?.(markdown);
  }
  return { markdown, sentenceCount: countPitchSentences(markdown) };
}
