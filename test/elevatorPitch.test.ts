import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PITCH_SYSTEM_PROMPT,
  buildPitchUserPrompt,
  clampPitchSentenceCount,
  countPitchSentences,
  generateElevatorPitch,
  normalizeElevatorPitch,
} from "../src/formatter/elevatorPitch";
import { FormatterError } from "../src/formatter/types";

function sseBody(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(chunks[i]));
      i += 1;
    },
  });
}

function deltaEvent(content: string): string {
  return `data: ${JSON.stringify({
    choices: [{ delta: { content } }],
  })}\n\n`;
}

const SAMPLE_PITCH =
  "Cancel now aborts in-flight Format via AbortSignal so reviewers never wait on a stuck stream. Ollama works without an API key, and the toolbar shows character-count progress while tokens arrive.";

describe("elevatorPitch helpers", () => {
  it("clamps sentence count to 2–4", () => {
    assert.equal(clampPitchSentenceCount(1), 2);
    assert.equal(clampPitchSentenceCount(3), 3);
    assert.equal(clampPitchSentenceCount(99), 4);
    assert.equal(clampPitchSentenceCount(Number.NaN), 3);
  });

  it("builds a user prompt that includes the raw description and count", () => {
    const prompt = buildPitchUserPrompt("Summary\ncancel in flight", 2);
    assert.match(prompt, /about 2 sentences/i);
    assert.match(prompt, /cancel in flight/);
    assert.match(PITCH_SYSTEM_PROMPT, /Do not invent/i);
  });

  it("normalizes fences, labels, and whitespace", () => {
    const fenced = `\`\`\`markdown\nElevator pitch: ${SAMPLE_PITCH}\n\`\`\``;
    assert.equal(normalizeElevatorPitch(fenced), SAMPLE_PITCH);
    assert.equal(
      normalizeElevatorPitch(`"${SAMPLE_PITCH}"`),
      SAMPLE_PITCH,
    );
    assert.equal(countPitchSentences(SAMPLE_PITCH), 2);
  });

  it("returns empty for blank or whitespace-only input", () => {
    assert.equal(normalizeElevatorPitch("   "), "");
    assert.equal(countPitchSentences(""), 0);
  });
});

describe("generateElevatorPitch", () => {
  it("rejects empty input", async () => {
    await assert.rejects(
      () =>
        generateElevatorPitch("  ", {
          apiKey: "sk-test",
          model: "x",
          baseUrl: "http://x",
          endpointPreset: "openai",
        }),
      (err: unknown) => {
        assert.ok(err instanceof FormatterError);
        assert.match(err.message, /empty/i);
        return true;
      },
    );
  });

  it("requires a model endpoint (no offline heuristic)", async () => {
    await assert.rejects(
      () =>
        generateElevatorPitch("Summary\nnotes", {
          apiKey: "",
          model: "gpt-4.1-mini",
          baseUrl: "https://api.openai.com/v1",
          endpointPreset: "openai",
        }),
      (err: unknown) => {
        assert.ok(err instanceof FormatterError);
        assert.match(err.message, /model endpoint|API key|Ollama/i);
        return true;
      },
    );
  });

  it("streams via mocked SSE and normalizes the pitch", async () => {
    const progressive: string[] = [];
    const fenced = `\`\`\`markdown\nPitch: ${SAMPLE_PITCH}\n\`\`\``;
    const mid = fenced.slice(0, 40);
    const rest = fenced.slice(40);

    const fetchImpl: typeof fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as {
        stream?: boolean;
        messages?: { role: string; content: string }[];
      };
      assert.equal(body.stream, true);
      assert.ok(body.messages?.some((m) => m.role === "system"));
      assert.ok(
        body.messages?.some(
          (m) => m.role === "user" && /about 2 sentences/i.test(m.content),
        ),
      );
      return new Response(sseBody([deltaEvent(mid), deltaEvent(rest), "data: [DONE]\n\n"]), {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    };

    const result = await generateElevatorPitch(
      "Summary\nCancel aborts Format. Ollama needs no key. Toolbar shows char count.",
      {
        apiKey: "sk-test",
        model: "gpt-4.1-mini",
        baseUrl: "https://api.openai.com/v1",
        endpointPreset: "openai",
      },
      {
        fetchImpl,
        sentenceCount: 2,
        onChunk: (acc) => progressive.push(acc),
      },
    );

    assert.equal(result.markdown, SAMPLE_PITCH);
    assert.equal(result.sentenceCount, 2);
    assert.ok(progressive.length >= 2);
    assert.equal(progressive[progressive.length - 1], SAMPLE_PITCH);
  });

  it("throws when the mocked model returns an empty or tiny pitch", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(sseBody([deltaEvent("Too short."), "data: [DONE]\n\n"]), {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });

    await assert.rejects(
      () =>
        generateElevatorPitch(
          "Summary\nnotes",
          {
            apiKey: "",
            model: "llama3.2",
            baseUrl: "http://localhost:11434/v1",
            endpointPreset: "ollama",
          },
          { fetchImpl },
        ),
      (err: unknown) => {
        assert.ok(err instanceof FormatterError);
        assert.match(err.message, /empty or too short/i);
        return true;
      },
    );
  });

  it("aborts an in-flight pitch when the signal fires", async () => {
    const controller = new AbortController();
    const fetchImpl: typeof fetch = async (_url, init) => {
      const signal = init?.signal;
      return new Response(
        new ReadableStream<Uint8Array>({
          start(streamController) {
            const encoder = new TextEncoder();
            streamController.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  choices: [{ delta: { content: "This change " } }],
                })}\n\n`,
              ),
            );
            const onAbort = () => {
              streamController.error(
                signal?.reason ?? new DOMException("The operation was aborted.", "AbortError"),
              );
            };
            if (signal?.aborted) {
              onAbort();
              return;
            }
            signal?.addEventListener("abort", onAbort, { once: true });
          },
        }),
        {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        },
      );
    };

    const pending = generateElevatorPitch(
      "Summary\nrough notes",
      {
        apiKey: "sk-test",
        model: "gpt-4.1-mini",
        baseUrl: "https://api.openai.com/v1",
        endpointPreset: "openai",
      },
      { fetchImpl, signal: controller.signal },
    );

    await new Promise((r) => setTimeout(r, 10));
    controller.abort();

    await assert.rejects(pending, (err: unknown) => {
      assert.ok(
        (err instanceof DOMException && err.name === "AbortError") ||
          (err instanceof Error && err.name === "AbortError"),
      );
      return true;
    });
  });
});
