import { FormatPreset, FormatterError, Settings } from "./types";
import { SYSTEM_PROMPT, buildUserPrompt } from "./prompt";
import { formatLocally } from "./localFormatter";
import { loadSettings } from "../storage/settings";

/**
 * Formatter abstraction. Two backends:
 *   1. OpenAI-compatible chat completion (used when an API key is configured).
 *   2. Local heuristic formatter (used for development / no key).
 *
 * The public signature matches the spec. `settings` is optional; when omitted,
 * it is loaded from storage so callers (popup, future content script) can stay
 * simple.
 */
export async function formatPrDescription(
  input: string,
  preset: FormatPreset,
  settings?: Settings,
): Promise<string> {
  if (!input || !input.trim()) {
    throw new FormatterError("Paste a PR description first — the input is empty.");
  }

  const resolved = settings ?? (await loadSettings());

  if (!resolved.apiKey) {
    // No key: use the offline heuristic formatter rather than erroring out, so
    // the extension is usable immediately.
    return formatLocally(input);
  }

  return formatViaApi(input, preset, resolved);
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string };
}

async function formatViaApi(
  input: string,
  preset: FormatPreset,
  settings: Settings,
): Promise<string> {
  const url = `${settings.baseUrl.replace(/\/+$/, "")}/chat/completions`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${settings.apiKey}`,
      },
      body: JSON.stringify({
        model: settings.model,
        temperature: 0.2,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildUserPrompt(input, preset) },
        ],
      }),
    });
  } catch (err) {
    // Network failure / CORS / bad base URL.
    throw new FormatterError(
      `Could not reach the model endpoint at ${settings.baseUrl}. Check the Base URL and your connection.`,
    );
  }

  if (!response.ok) {
    let detail = "";
    try {
      const body = (await response.json()) as ChatCompletionResponse;
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
        `Model or endpoint not found (404). Check the Model name (\`${settings.model}\`) and Base URL.`,
      );
    }
    if (response.status === 429) {
      throw new FormatterError("Rate limited by the API (429). Wait a moment and try again.");
    }
    throw new FormatterError(
      `The API request failed (${response.status}).${detail ? ` ${detail}` : ""}`,
    );
  }

  let data: ChatCompletionResponse;
  try {
    data = (await response.json()) as ChatCompletionResponse;
  } catch {
    throw new FormatterError("The API returned a response that could not be parsed.");
  }

  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new FormatterError("The model returned an empty response. Try again.");
  }

  return stripCodeFenceWrapper(content);
}

/**
 * Some models wrap the whole answer in a ```markdown fence despite being told
 * not to. Unwrap that single outer fence if present so users get raw Markdown.
 */
function stripCodeFenceWrapper(text: string): string {
  const fenceMatch = text.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/);
  return fenceMatch ? fenceMatch[1].trim() : text;
}
