import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  extractChatDeltaContent,
  parseSseDataBlock,
  readSseJsonStream,
  streamChatCompletion,
} from "../src/formatter/sseChatStream";
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

function jsonDelta(content: string): string {
  return JSON.stringify({
    id: "chatcmpl-test",
    object: "chat.completion.chunk",
    choices: [{ index: 0, delta: { content }, finish_reason: null }],
  });
}

describe("extractChatDeltaContent", () => {
  it("reads choices[0].delta.content and ignores empty / role-only deltas", () => {
    assert.equal(
      extractChatDeltaContent({
        choices: [{ delta: { content: "## Summary" } }],
      }),
      "## Summary",
    );
    assert.equal(extractChatDeltaContent({ choices: [{ delta: { role: "assistant" } }] }), "");
    assert.equal(extractChatDeltaContent({ choices: [] }), "");
    assert.equal(extractChatDeltaContent(null), "");
  });
});

describe("parseSseDataBlock", () => {
  it("parses JSON data lines and [DONE]", () => {
    const parsed = parseSseDataBlock(`data: ${jsonDelta("Hi")}`);
    assert.ok(parsed && !parsed.done);
    if (parsed && !parsed.done) {
      assert.equal(extractChatDeltaContent(parsed.data), "Hi");
    }
    assert.deepEqual(parseSseDataBlock("data: [DONE]"), { done: true });
    assert.equal(parseSseDataBlock(": keep-alive"), null);
  });

  it("throws FormatterError on malformed JSON", () => {
    assert.throws(
      () => parseSseDataBlock("data: {not-json"),
      (err: unknown) => err instanceof FormatterError,
    );
  });
});

describe("readSseJsonStream", () => {
  it("yields payloads across chunk boundaries until [DONE]", async () => {
    // Split mid-event to prove buffering works offline.
    const partA = `data: ${jsonDelta("Hello")}\n\ndata: ${jsonDelta(" ")}`;
    const partB = `\n\ndata: ${jsonDelta("world")}\n\ndata: [DONE]\n\n`;
    const received: string[] = [];
    for await (const payload of readSseJsonStream(sseBody([partA, partB]))) {
      received.push(extractChatDeltaContent(payload));
    }
    assert.deepEqual(received, ["Hello", " ", "world"]);
  });
});

describe("streamChatCompletion", () => {
  it("POSTs stream:true and accumulates deltas via onDelta (mocked fetch)", async () => {
    const deltas: string[] = [];
    const snapshots: string[] = [];
    let requestBody: unknown;

    const fetchImpl: typeof fetch = async (_url, init) => {
      requestBody = JSON.parse(String(init?.body));
      const body = sseBody([
        `data: ${jsonDelta("## ")}\n\n`,
        `data: ${jsonDelta("Summary")}\n\n`,
        `data: ${jsonDelta("\n\nShip it.")}\n\n`,
        "data: [DONE]\n\n",
      ]);
      return new Response(body, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    };

    const text = await streamChatCompletion({
      baseUrl: "http://localhost:11434/v1/",
      apiKey: "",
      model: "llama3.2",
      messages: [{ role: "user", content: "format me" }],
      fetchImpl,
      onDelta: (delta, accumulated) => {
        deltas.push(delta);
        snapshots.push(accumulated);
      },
    });

    assert.equal(text, "## Summary\n\nShip it.");
    assert.deepEqual(deltas, ["## ", "Summary", "\n\nShip it."]);
    assert.deepEqual(snapshots, ["## ", "## Summary", "## Summary\n\nShip it."]);
    assert.equal((requestBody as { stream?: boolean }).stream, true);
    assert.equal((requestBody as { model?: string }).model, "llama3.2");
  });

  it("maps 401 to a friendly FormatterError", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify({ error: { message: "bad key" } }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });

    await assert.rejects(
      () =>
        streamChatCompletion({
          baseUrl: "https://api.openai.com/v1",
          apiKey: "sk-bad",
          model: "gpt-4.1-mini",
          messages: [{ role: "user", content: "x" }],
          fetchImpl,
        }),
      (err: unknown) => {
        assert.ok(err instanceof FormatterError);
        assert.match(err.message, /unauthorized|API key/i);
        return true;
      },
    );
  });

  it("rejects an empty streamed completion", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(sseBody(["data: [DONE]\n\n"]), {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });

    await assert.rejects(
      () =>
        streamChatCompletion({
          baseUrl: "http://127.0.0.1:11434/v1",
          apiKey: "",
          model: "llama3.2",
          messages: [{ role: "user", content: "x" }],
          fetchImpl,
        }),
      (err: unknown) => {
        assert.ok(err instanceof FormatterError);
        assert.match(err.message, /empty/i);
        return true;
      },
    );
  });

  it("surfaces AbortError when the stream signal is aborted mid-read", async () => {
    const ac = new AbortController();
    const fetchImpl: typeof fetch = async (_url, init) => {
      const signal = init?.signal;
      return new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            controller.enqueue(
              new TextEncoder().encode(`data: ${jsonDelta("partial")}\n\n`),
            );
            // Hang until abort so the consumer is mid-stream.
            return new Promise<void>((_resolve, reject) => {
              const fail = () =>
                reject(
                  signal?.reason ??
                    new DOMException("The operation was aborted.", "AbortError"),
                );
              if (signal?.aborted) {
                fail();
                return;
              }
              signal?.addEventListener("abort", fail, { once: true });
            });
          },
        }),
        {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        },
      );
    };

    const pending = streamChatCompletion({
      baseUrl: "http://localhost:11434/v1",
      apiKey: "",
      model: "llama3.2",
      messages: [{ role: "user", content: "x" }],
      fetchImpl,
      signal: ac.signal,
    });

    await new Promise((r) => setTimeout(r, 10));
    ac.abort();

    await assert.rejects(pending, (err: unknown) => {
      assert.ok(
        (err instanceof DOMException && err.name === "AbortError") ||
          (err instanceof Error && err.name === "AbortError"),
      );
      return true;
    });
  });
});
