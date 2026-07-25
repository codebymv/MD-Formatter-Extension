import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createFormatRequestId,
  createJobRequestId,
  formatStreamProgressLabel,
  streamProgressLabel,
} from "../src/content/formatProgress";

describe("streamProgressLabel", () => {
  it("uses Formatting / Quizzing / Pitching verbs", () => {
    assert.equal(streamProgressLabel("format", 0), "Formatting…");
    assert.equal(streamProgressLabel("quiz", 0), "Quizzing…");
    assert.equal(streamProgressLabel("pitch", -1), "Pitching…");
  });

  it("formats char counts under and over 1k", () => {
    assert.equal(streamProgressLabel("quiz", 42), "Quizzing… 42 chars");
    assert.equal(streamProgressLabel("pitch", 1500), "Pitching… 1.5k chars");
    assert.equal(streamProgressLabel("format", 12_400), "Formatting… 12k chars");
  });
});

describe("formatStreamProgressLabel", () => {
  it("shows a plain Formatting label before any chars arrive", () => {
    assert.equal(formatStreamProgressLabel(0), "Formatting…");
    assert.equal(formatStreamProgressLabel(-1), "Formatting…");
  });

  it("formats char counts under and over 1k", () => {
    assert.equal(formatStreamProgressLabel(42), "Formatting… 42 chars");
    assert.equal(formatStreamProgressLabel(1500), "Formatting… 1.5k chars");
    assert.equal(formatStreamProgressLabel(12_400), "Formatting… 12k chars");
  });
});

describe("createJobRequestId / createFormatRequestId", () => {
  it("returns kind-prefixed opaque ids", () => {
    const formatId = createFormatRequestId();
    assert.match(formatId, /^fmt-/);
    assert.notEqual(createFormatRequestId(), formatId);

    assert.match(createJobRequestId("quiz"), /^quiz-/);
    assert.match(createJobRequestId("pitch"), /^pitch-/);
    assert.match(createJobRequestId("format"), /^fmt-/);
  });
});
