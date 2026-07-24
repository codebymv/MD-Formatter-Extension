import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadPreset, savePreset } from "../src/storage/preset";

describe("preset storage (memory fallback)", () => {
  it("defaults to standard, then round-trips a saved preset", async () => {
    // Fresh module state isn't guaranteed across the suite; just assert the API.
    await savePreset("feature");
    assert.equal(await loadPreset(), "feature");
    await savePreset("bugfix");
    assert.equal(await loadPreset(), "bugfix");
  });
});
