/**
 * OpenAI-compatible chat.completions streaming (SSE).
 * Parsing is pure / injectable-fetch friendly so unit tests never need a live model.
 */

import { FormatterError } from "./types";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface StreamChatCompletionArgs {
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  signal?: AbortSignal;
  /** Called with each content delta and the full text so far. */
  onDelta?: (delta: string, accumulated: string) => void;
  /** Injectable for tests (defaults to global fetch). */
  fetchImpl?: typeof fetch;
}

/**
 * Pull assistant text from a streamed chat.completions JSON payload
 * (`choices[0].delta.content`). Ignores role-only / empty deltas.
 */
export function extractChatDeltaContent(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return "";
  const first = choices[0];
  if (!first || typeof first !== "object") return "";
  const delta = (first as { delta?: unknown }).delta;
  if (!delta || typeof delta !== "object") return "";
  const content = (delta as { content?: unknown }).content;
  return typeof content === "string" ? content : "";
}

/**
 * Parse one SSE event block (text between blank lines). Returns:
 * - `{ done: true }` for `data: [DONE]`
 * - `{ done: false, data }` for JSON payloads
 * - `null` when the block has no usable `data:` line
 */
export function parseSseDataBlock(
  block: string,
): { done: true } | { done: false; data: unknown } | null {
  const dataLines: string[] = [];
  for (const rawLine of block.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (!line || line.startsWith(":")) continue; // comments / keep-alives
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart());
    }
  }
  if (dataLines.length === 0) return null;
  const joined = dataLines.join("\n");
  if (joined === "[DONE]") return { done: true };
  try {
    return { done: false, data: JSON.parse(joined) as unknown };
  } catch {
    throw new FormatterError("The API returned a streamed chunk that could not be parsed.");
  }
}

/**
 * Yield parsed JSON objects from an OpenAI-style SSE body until `[DONE]`.
 */
export async function* readSseJsonStream(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      if (signal?.aborted) {
        throw new DOMException("The operation was aborted.", "AbortError");
      }
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE events are delimited by a blank line.
      let sep: number;
      while ((sep = findEventBoundary(buffer)) !== -1) {
        const block = buffer.slice(0, sep);
        buffer = buffer.slice(sep).replace(/^\r?\n\r?\n/, "");
        const parsed = parseSseDataBlock(block);
        if (!parsed) continue;
        if (parsed.done) return;
        yield parsed.data;
      }
    }

    // Flush trailing bytes (some servers omit the final blank line before close).
    buffer += decoder.decode();
    if (buffer.trim()) {
      const parsed = parseSseDataBlock(buffer);
      if (parsed && !parsed.done) yield parsed.data;
    }
  } finally {
    reader.releaseLock();
  }
}

function findEventBoundary(buffer: string): number {
  const lf = buffer.indexOf("\n\n");
  const crlf = buffer.indexOf("\r\n\r\n");
  if (lf === -1) return crlf;
  if (crlf === -1) return lf;
  return Math.min(lf, crlf);
}

/**
 * POST `{baseUrl}/chat/completions` with `stream: true` and accumulate deltas.
 * Maps common HTTP failures to FormatterError (same tone as the non-stream path).
 */
export async function streamChatCompletion(args: StreamChatCompletionArgs): Promise<string> {
  const base = args.baseUrl.replace(/\/+$/, "");
  const url = `${base}/chat/completions`;
  const fetchImpl = args.fetchImpl ?? fetch;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "text/event-stream",
  };
  if (args.apiKey.trim()) {
    headers.Authorization = `Bearer ${args.apiKey.trim()}`;
  }

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: args.model,
        temperature: args.temperature ?? 0.2,
        stream: true,
        messages: args.messages,
      }),
      signal: args.signal,
    });
  } catch (err) {
    if (isAbortError(err)) throw err;
    throw new FormatterError(
      `Could not reach the model endpoint at ${args.baseUrl}. Check the Base URL and your connection.`,
    );
  }

  if (!response.ok) {
    await throwFriendlyHttpError(response, args.model);
  }

  if (!response.body) {
    throw new FormatterError("The API returned an empty stream body.");
  }

  let accumulated = "";
  for await (const payload of readSseJsonStream(response.body, args.signal)) {
    // Surface mid-stream API errors when present on the payload.
    const errMsg = readPayloadError(payload);
    if (errMsg) {
      throw new FormatterError(errMsg);
    }
    const delta = extractChatDeltaContent(payload);
    if (!delta) continue;
    accumulated += delta;
    args.onDelta?.(delta, accumulated);
  }

  if (!accumulated.trim()) {
    throw new FormatterError("The model returned an empty response. Try again.");
  }

  return accumulated;
}

function readPayloadError(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const error = (payload as { error?: { message?: unknown } }).error;
  if (!error || typeof error !== "object") return null;
  const message = error.message;
  return typeof message === "string" && message.trim() ? message.trim() : null;
}

async function throwFriendlyHttpError(response: Response, model: string): Promise<never> {
  let detail = "";
  try {
    const body = (await response.json()) as { error?: { message?: string } };
    detail = body?.error?.message ?? "";
  } catch {
    // ignore JSON parse failures
  }
  if (response.status === 401 || response.status === 403) {
    throw new FormatterError(
      "The API rejected your key (unauthorized). Double-check the API key in Settings.",
    );
  }
  if (response.status === 404) {
    throw new FormatterError(
      `Model or endpoint not found (404). Check the Model name (\`${model}\`) and Base URL.`,
    );
  }
  if (response.status === 429) {
    throw new FormatterError("Rate limited by the API (429). Wait a moment and try again.");
  }
  throw new FormatterError(
    `The API request failed (${response.status}).${detail ? ` ${detail}` : ""}`,
  );
}

function isAbortError(err: unknown): boolean {
  return (
    (err instanceof DOMException && err.name === "AbortError") ||
    (err instanceof Error && err.name === "AbortError")
  );
}
