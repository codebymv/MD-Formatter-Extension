import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatPrDescription,
  stripCodeFenceWrapper,
} from "../src/formatter/formatPrDescription";
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

describe("formatPrDescription", () => {
  it("rejects empty input with a friendly FormatterError", async () => {
    await assert.rejects(
      () =>
        formatPrDescription("   ", "standard", {
          apiKey: "",
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

  it("uses the offline formatter when no API key is set and honors preset order", async () => {
    const input = `Backend
new handler
Summary
offline path
`;
    const chunks: string[] = [];
    const out = await formatPrDescription(
      input,
      "feature",
      {
        apiKey: "",
        model: "gpt-4.1-mini",
        baseUrl: "https://api.openai.com/v1",
        endpointPreset: "openai",
      },
      { onChunk: (acc) => chunks.push(acc) },
    );
    assert.ok(out.indexOf("## Summary") < out.indexOf("## Backend"));
    assert.deepEqual(chunks, [out]);
  });

  it("streams API completions via mocked SSE fetch and unwraps a final fence", async () => {
    const progressive: string[] = [];
    const fenced = "```markdown\n## Summary\n\nStreamed.\n```";
    // Emit the fenced answer in two deltas.
    const mid = fenced.slice(0, 12);
    const rest = fenced.slice(12);

    const fetchImpl: typeof fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { stream?: boolean };
      assert.equal(body.stream, true);
      return new Response(sseBody([deltaEvent(mid), deltaEvent(rest), "data: [DONE]\n\n"]), {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    };

    const out = await formatPrDescription(
      "Summary\nrough notes",
      "standard",
      {
        apiKey: "sk-test",
        model: "gpt-4.1-mini",
        baseUrl: "https://api.openai.com/v1",
        endpointPreset: "openai",
      },
      {
        fetchImpl,
        onChunk: (acc) => progressive.push(acc),
      },
    );

    assert.equal(out, "## Summary\n\nStreamed.");
    assert.equal(stripCodeFenceWrapper(fenced), out);
    assert.ok(progressive.length >= 2);
    assert.equal(progressive[progressive.length - 1], out);
  });

  it("aborts an in-flight streamed format when the signal fires", async () => {
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
                  choices: [{ delta: { content: "## " } }],
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
            // Leave the stream open until abort — simulates a slow model.
          },
        }),
        {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        },
      );
    };

    const pending = formatPrDescription(
      "Summary\nrough notes",
      "standard",
      {
        apiKey: "sk-test",
        model: "gpt-4.1-mini",
        baseUrl: "https://api.openai.com/v1",
        endpointPreset: "openai",
      },
      { fetchImpl, signal: controller.signal },
    );

    // Let the first chunk land, then cancel mid-flight.
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

