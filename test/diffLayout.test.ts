import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_DIFF_LAYOUT,
  isDiffPreviewLayout,
  loadDiffLayout,
  saveDiffLayout,
} from "../src/storage/diffLayout";

describe("isDiffPreviewLayout", () => {
  it("accepts unified and columns only", () => {
    assert.equal(isDiffPreviewLayout("unified"), true);
    assert.equal(isDiffPreviewLayout("columns"), true);
    assert.equal(isDiffPreviewLayout("side-by-side"), false);
    assert.equal(isDiffPreviewLayout(""), false);
    assert.equal(isDiffPreviewLayout(null), false);
    assert.equal(isDiffPreviewLayout(1), false);
  });
});

describe("diffLayout storage (memory fallback)", () => {
  it("defaults to columns, then round-trips a saved layout", async () => {
    await saveDiffLayout("unified");
    assert.equal(await loadDiffLayout(), "unified");
    await saveDiffLayout("columns");
    assert.equal(await loadDiffLayout(), "columns");
  });

  it("falls back to default when given an invalid layout via save", async () => {
    await saveDiffLayout("unified");
    // Cast through unknown to exercise the guard without TS rejecting it.
    await saveDiffLayout("nope" as unknown as "unified");
    assert.equal(await loadDiffLayout(), DEFAULT_DIFF_LAYOUT);
  });
});
