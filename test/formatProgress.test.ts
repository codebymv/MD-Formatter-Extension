import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createFormatRequestId,
  formatStreamProgressLabel,
} from "../src/content/formatProgress";

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

describe("createFormatRequestId", () => {
  it("returns a non-empty fmt- prefixed id", () => {
    const id = createFormatRequestId();
    assert.match(id, /^fmt-/);
    assert.notEqual(createFormatRequestId(), id);
  });
});
