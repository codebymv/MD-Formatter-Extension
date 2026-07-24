import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  QUIZ_SYSTEM_PROMPT,
  buildQuizUserPrompt,
  clampQuestionCount,
  formatQuizMarkdown,
  generateReleaseQuiz,
  parseQuizMarkdown,
} from "../src/formatter/releaseQuiz";
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

const SAMPLE_QUIZ = `1. What does the cancel button abort?
A: The in-flight Format request via AbortSignal.

2. Which preset skips the API key?
A: Ollama (local).

3. Where is stream progress shown in-page?
A: On the toolbar as a character count.`;

describe("releaseQuiz helpers", () => {
  it("clamps question count to 3–8", () => {
    assert.equal(clampQuestionCount(1), 3);
    assert.equal(clampQuestionCount(5), 5);
    assert.equal(clampQuestionCount(99), 8);
    assert.equal(clampQuestionCount(Number.NaN), 5);
  });

  it("builds a user prompt that includes the raw description and count", () => {
    const prompt = buildQuizUserPrompt("Summary\ncancel in flight", 4);
    assert.match(prompt, /exactly 4 quiz questions/i);
    assert.match(prompt, /cancel in flight/);
    assert.match(QUIZ_SYSTEM_PROMPT, /Do not invent/i);
  });

  it("parses numbered Q/A Markdown and round-trips format", () => {
    const items = parseQuizMarkdown(`\`\`\`markdown\n${SAMPLE_QUIZ}\n\`\`\``);
    assert.equal(items.length, 3);
    assert.equal(items[0].question, "What does the cancel button abort?");
    assert.match(items[0].answer, /AbortSignal/);
    assert.equal(items[1].question, "Which preset skips the API key?");
    assert.equal(formatQuizMarkdown(items), SAMPLE_QUIZ);
  });

  it("accepts Answer: labels and ignores unparseable blocks", () => {
    const items = parseQuizMarkdown(`Preamble noise

1. First question?
Answer: First answer.

garbage line

2. Second?
A: Second answer.`);
    assert.deepEqual(items, [
      { question: "First question?", answer: "First answer." },
      { question: "Second?", answer: "Second answer." },
    ]);
  });
});

describe("generateReleaseQuiz", () => {
  it("rejects empty input", async () => {
    await assert.rejects(
      () =>
        generateReleaseQuiz("  ", {
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
        generateReleaseQuiz("Summary\nnotes", {
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

  it("streams via mocked SSE, parses items, and normalizes Markdown", async () => {
    const progressive: string[] = [];
    const fenced = `\`\`\`markdown\n${SAMPLE_QUIZ}\n\`\`\``;
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
          (m) => m.role === "user" && /exactly 3 quiz questions/i.test(m.content),
        ),
      );
      return new Response(sseBody([deltaEvent(mid), deltaEvent(rest), "data: [DONE]\n\n"]), {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    };

    const result = await generateReleaseQuiz(
      "Summary\nCancel aborts Format. Ollama needs no key. Toolbar shows char count.",
      {
        apiKey: "sk-test",
        model: "gpt-4.1-mini",
        baseUrl: "https://api.openai.com/v1",
        endpointPreset: "openai",
      },
      {
        fetchImpl,
        questionCount: 3,
        onChunk: (acc) => progressive.push(acc),
      },
    );

    assert.equal(result.items.length, 3);
    assert.equal(result.markdown, SAMPLE_QUIZ);
    assert.ok(progressive.length >= 2);
    assert.equal(progressive[progressive.length - 1], SAMPLE_QUIZ);
  });

  it("throws when the mocked model returns unparseable prose", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(
        sseBody([deltaEvent("Here is a fun quiz without structure."), "data: [DONE]\n\n"]),
        {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        },
      );

    await assert.rejects(
      () =>
        generateReleaseQuiz(
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
        assert.match(err.message, /could not be parsed/i);
        return true;
      },
    );
  });

  it("aborts an in-flight quiz when the signal fires", async () => {
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
                  choices: [{ delta: { content: "1. " } }],
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

    const pending = generateReleaseQuiz(
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
