import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FormatJobRegistry, isAbortError } from "../src/background/formatJobs";

describe("FormatJobRegistry", () => {
  it("starts a job and cancels it via AbortSignal", () => {
    const jobs = new FormatJobRegistry();
    const signal = jobs.start("req-1");
    assert.equal(signal.aborted, false);
    assert.equal(jobs.has("req-1"), true);

    assert.equal(jobs.cancel("req-1"), true);
    assert.equal(signal.aborted, true);
    assert.equal(jobs.has("req-1"), false);
    assert.equal(jobs.cancel("req-1"), false);
  });

  it("replacing the same requestId aborts the previous controller", () => {
    const jobs = new FormatJobRegistry();
    const first = jobs.start("dup");
    const second = jobs.start("dup");
    assert.equal(first.aborted, true);
    assert.equal(second.aborted, false);
    assert.equal(jobs.size, 1);
    jobs.finish("dup");
    assert.equal(jobs.size, 0);
    assert.equal(second.aborted, false);
  });
});

describe("isAbortError", () => {
  it("recognizes DOMException and Error AbortError shapes", () => {
    assert.equal(isAbortError(new DOMException("aborted", "AbortError")), true);
    const err = new Error("aborted");
    err.name = "AbortError";
    assert.equal(isAbortError(err), true);
    assert.equal(isAbortError(new Error("nope")), false);
  });
});
