import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CANCEL_FORMAT_PR_DESCRIPTION,
  FORMAT_PR_DESCRIPTION,
  FORMAT_PR_PROGRESS,
  GENERATE_PR_ARTIFACT,
  isCancelFormatPrDescriptionRequest,
  isCancelledFormatResponse,
  isFormatPrDescriptionRequest,
  isFormatPrProgressMessage,
  isGeneratePrArtifactRequest,
  isPrArtifactKind,
} from "../src/messaging/protocol";

describe("isFormatPrDescriptionRequest", () => {
  it("accepts a well-formed content-script message with requestId", () => {
    assert.equal(
      isFormatPrDescriptionRequest({
        type: FORMAT_PR_DESCRIPTION,
        input: "Summary\nhello",
        requestId: "fmt-1",
      }),
      true,
    );
  });

  it("rejects unrelated or malformed payloads", () => {
    assert.equal(isFormatPrDescriptionRequest(null), false);
    assert.equal(isFormatPrDescriptionRequest({ type: "other", input: "x" }), false);
    assert.equal(
      isFormatPrDescriptionRequest({ type: FORMAT_PR_DESCRIPTION, input: 12 }),
      false,
    );
    assert.equal(
      isFormatPrDescriptionRequest({
        type: FORMAT_PR_DESCRIPTION,
        input: "ok",
        requestId: "",
      }),
      false,
    );
  });
});

describe("isGeneratePrArtifactRequest", () => {
  it("accepts quiz and pitch generate messages", () => {
    assert.equal(isPrArtifactKind("quiz"), true);
    assert.equal(isPrArtifactKind("pitch"), true);
    assert.equal(isPrArtifactKind("format"), false);
    assert.equal(
      isGeneratePrArtifactRequest({
        type: GENERATE_PR_ARTIFACT,
        kind: "quiz",
        input: "Release notes",
        requestId: "quiz-1",
      }),
      true,
    );
    assert.equal(
      isGeneratePrArtifactRequest({
        type: GENERATE_PR_ARTIFACT,
        kind: "pitch",
        input: "Release notes",
        requestId: "pitch-1",
      }),
      true,
    );
  });

  it("rejects malformed generate payloads", () => {
    assert.equal(isGeneratePrArtifactRequest(null), false);
    assert.equal(
      isGeneratePrArtifactRequest({
        type: GENERATE_PR_ARTIFACT,
        kind: "format",
        input: "x",
        requestId: "x",
      }),
      false,
    );
    assert.equal(
      isGeneratePrArtifactRequest({
        type: GENERATE_PR_ARTIFACT,
        kind: "quiz",
        input: "x",
        requestId: "",
      }),
      false,
    );
  });
});

describe("cancel + progress protocol", () => {
  it("accepts cancel and progress messages", () => {
    assert.equal(
      isCancelFormatPrDescriptionRequest({
        type: CANCEL_FORMAT_PR_DESCRIPTION,
        requestId: "fmt-1",
      }),
      true,
    );
    assert.equal(
      isFormatPrProgressMessage({
        type: FORMAT_PR_PROGRESS,
        requestId: "fmt-1",
        accumulatedChars: 120,
      }),
      true,
    );
    assert.equal(
      isFormatPrProgressMessage({
        type: FORMAT_PR_PROGRESS,
        requestId: "fmt-1",
        accumulatedChars: Number.NaN,
      }),
      false,
    );
  });

  it("detects cancelled format responses", () => {
    assert.equal(isCancelledFormatResponse({ ok: false, cancelled: true }), true);
    assert.equal(isCancelledFormatResponse({ ok: false, error: "nope" }), false);
    assert.equal(isCancelledFormatResponse({ ok: true, markdown: "x" }), false);
  });
});
