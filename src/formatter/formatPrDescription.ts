import { shouldUseApi } from "./endpointPresets";
import { FormatGuide, FormatPreset, FormatterError, Settings } from "./types";
import { SYSTEM_PROMPT, buildUserPrompt } from "./prompt";
import { formatLocally } from "./localFormatter";
import { loadSettings } from "../storage/settings";
import { streamChatCompletion } from "./sseChatStream";

export interface FormatOptions {
  /** Progressive text while the model streams (API path only; offline fires once). */
  onChunk?: (accumulated: string) => void;
  signal?: AbortSignal;
  /** Injectable fetch for offline unit tests. */
  fetchImpl?: typeof fetch;
}

/**
 * Formatter abstraction. Two backends:
 *   1. OpenAI-compatible chat completion with SSE streaming (API key set, or a
 *      preset that does not require one — e.g. local Ollama).
 *   2. Local heuristic formatter (default / no reachable model config).
 *
 * `style` may be a built-in FormatPreset id or a resolved FormatGuide (saved
 * profile). `settings` is optional; when omitted, it is loaded from storage.
 */
export async function formatPrDescription(
  input: string,
  style: FormatPreset | FormatGuide,
  settings?: Settings,
  options?: FormatOptions,
): Promise<string> {
  if (!input || !input.trim()) {
    throw new FormatterError("Paste a PR description first — the input is empty.");
  }

  const resolved = settings ?? (await loadSettings());

  if (!shouldUseApi(resolved)) {
    // Offline heuristic formatter. Style still applies (section order +
    // synonym canonicalization) so the selector isn't a no-op.
    const markdown = formatLocally(input, style);
    options?.onChunk?.(markdown);
    return markdown;
  }

  return formatViaApiStream(input, style, resolved, options);
}

async function formatViaApiStream(
  input: string,
  style: FormatPreset | FormatGuide,
  settings: Settings,
  options?: FormatOptions,
): Promise<string> {
  const content = await streamChatCompletion({
    baseUrl: settings.baseUrl,
    apiKey: settings.apiKey,
    model: settings.model,
    temperature: 0.2,
    signal: options?.signal,
    fetchImpl: options?.fetchImpl,
    onDelta: (_delta, accumulated) => {
      options?.onChunk?.(accumulated);
    },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserPrompt(input, style) },
    ],
  });

  const markdown = stripCodeFenceWrapper(content);
  // Final pass may unwrap a fence the progressive chunks still included.
  if (markdown !== content) {
    options?.onChunk?.(markdown);
  }
  return markdown;
}

/**
 * Some models wrap the whole answer in a ```markdown fence despite being told
 * not to. Unwrap that single outer fence if present so users get raw Markdown.
 */
export function stripCodeFenceWrapper(text: string): string {
  const fenceMatch = text.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/);
  return fenceMatch ? fenceMatch[1].trim() : text;
}
