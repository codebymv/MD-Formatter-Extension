import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatPrDescription } from "../src/formatter/formatPrDescription";
import { PopupFormatSession } from "../src/popup/popupFormatSession";

describe("PopupFormatSession", () => {
  it("starts a job and cancels it via AbortSignal", () => {
    const session = new PopupFormatSession();
    const signal = session.start();
    assert.equal(session.active, true);
    assert.equal(signal.aborted, false);

    assert.equal(session.cancel(), true);
    assert.equal(signal.aborted, true);
    assert.equal(session.active, false);
    assert.equal(session.cancel(), false);
  });

  it("replacing start() aborts the previous controller", () => {
    const session = new PopupFormatSession();
    const first = session.start();
    const second = session.start();
    assert.equal(first.aborted, true);
    assert.equal(second.aborted, false);
    assert.equal(session.active, true);
    session.finish();
    assert.equal(session.active, false);
    assert.equal(second.aborted, false);
  });

  it("cancels an in-flight streamed format the way the popup Cancel button does", async () => {
    const session = new PopupFormatSession();
    const signal = session.start();

    const fetchImpl: typeof fetch = async (_url, init) => {
      const fetchSignal = init?.signal;
      return new Response(
        new ReadableStream<Uint8Array>({
          start(streamController) {
            const encoder = new TextEncoder();
            streamController.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  choices: [{ delta: { content: "## Summary\n" } }],
                })}\n\n`,
              ),
            );
            const onAbort = () => {
              streamController.error(
                fetchSignal?.reason ??
                  new DOMException("The operation was aborted.", "AbortError"),
              );
            };
            if (fetchSignal?.aborted) {
              onAbort();
              return;
            }
            fetchSignal?.addEventListener("abort", onAbort, { once: true });
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
      { fetchImpl, signal },
    );

    await new Promise((r) => setTimeout(r, 10));
    assert.equal(session.cancel(), true);

    await assert.rejects(pending, (err: unknown) => {
      assert.ok(
        (err instanceof DOMException && err.name === "AbortError") ||
          (err instanceof Error && err.name === "AbortError"),
      );
      return true;
    });
    assert.equal(session.active, false);
  });
});
