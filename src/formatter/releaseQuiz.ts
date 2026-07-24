/**
 * "Quiz me on this release" — model-backed Q&A generation from a PR / release
 * description. Requires a configured chat endpoint (no offline heuristic).
 * Pure helpers + injectable fetch so unit tests never need a live model.
 */

import { shouldUseApi } from "./endpointPresets";
import { stripCodeFenceWrapper } from "./formatPrDescription";
import { streamChatCompletion } from "./sseChatStream";
import { FormatterError, Settings } from "./types";
import { loadSettings } from "../storage/settings";

export interface QuizItem {
  question: string;
  answer: string;
}

export interface GenerateReleaseQuizOptions {
  onChunk?: (accumulated: string) => void;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  /** Target number of questions (clamped 3–8). */
  questionCount?: number;
}

export const QUIZ_SYSTEM_PROMPT = `You are a release-readiness coach.

Given a pull-request or release description, write a short quiz that checks whether a reader understood the change.

Rules:
- Use ONLY facts present in the input. Do not invent features, files, routes, tests, or outcomes.
- Prefer concrete questions (what changed, risk, how to verify) over vague ones.
- Return Markdown only — no preamble or closing commentary.
- Use this exact shape for every item:

1. <question>
A: <answer>

2. <question>
A: <answer>`;

export function buildQuizUserPrompt(input: string, questionCount = 5): string {
  const n = clampQuestionCount(questionCount);
  return `Write exactly ${n} quiz questions about this release / PR description.

Raw description:
${input.trim()}`;
}

export function clampQuestionCount(n: number): number {
  if (!Number.isFinite(n)) return 5;
  return Math.min(8, Math.max(3, Math.round(n)));
}

/**
 * Parse quiz Markdown into structured items.
 * Accepts numbered questions (`1. …`) and `A:` / `Answer:` answer lines.
 */
export function parseQuizMarkdown(text: string): QuizItem[] {
  const body = stripCodeFenceWrapper(text).replace(/\r\n/g, "\n").trim();
  if (!body) return [];

  const items: QuizItem[] = [];
  // Split on numbered question starts while keeping the delimiter.
  const parts = body.split(/(?=^\s*\d+\.\s+)/m).map((p) => p.trim()).filter(Boolean);

  for (const part of parts) {
    const match = part.match(
      /^\d+\.\s+([\s\S]+?)\n\s*(?:A|Answer)\s*:\s*([\s\S]+)$/i,
    );
    if (!match) continue;
    const question = match[1].replace(/\s+/g, " ").trim();
    // First answer paragraph only — drop trailing junk before the next item.
    const answer = match[2]
      .split(/\n\s*\n/)[0]
      .replace(/\s+/g, " ")
      .trim();
    if (question && answer) {
      items.push({ question, answer });
    }
  }
  return items;
}

/** Render structured quiz items back to the canonical Markdown shape. */
export function formatQuizMarkdown(items: QuizItem[]): string {
  return items
    .map((item, i) => `${i + 1}. ${item.question}\nA: ${item.answer}`)
    .join("\n\n");
}

/**
 * Generate a release quiz via the configured OpenAI-compatible endpoint.
 * Throws FormatterError when no model endpoint is configured (offline-only).
 */
export async function generateReleaseQuiz(
  input: string,
  settings?: Settings,
  options?: GenerateReleaseQuizOptions,
): Promise<{ markdown: string; items: QuizItem[] }> {
  if (!input || !input.trim()) {
    throw new FormatterError("Paste a PR description first — the input is empty.");
  }

  const resolved = settings ?? (await loadSettings());
  if (!shouldUseApi(resolved)) {
    throw new FormatterError(
      "Quiz generation needs a model endpoint. Open Settings and add an API key, or pick the Ollama preset.",
    );
  }

  const questionCount = clampQuestionCount(options?.questionCount ?? 5);
  const content = await streamChatCompletion({
    baseUrl: resolved.baseUrl,
    apiKey: resolved.apiKey,
    model: resolved.model,
    temperature: 0.3,
    signal: options?.signal,
    fetchImpl: options?.fetchImpl,
    onDelta: (_delta, accumulated) => {
      options?.onChunk?.(accumulated);
    },
    messages: [
      { role: "system", content: QUIZ_SYSTEM_PROMPT },
      { role: "user", content: buildQuizUserPrompt(input, questionCount) },
    ],
  });

  const items = parseQuizMarkdown(content);
  if (items.length === 0) {
    throw new FormatterError(
      "The model returned a quiz that could not be parsed. Try again, or check the model output format.",
    );
  }

  const markdown = formatQuizMarkdown(items);
  if (markdown !== content.trim()) {
    options?.onChunk?.(markdown);
  }
  return { markdown, items };
}
