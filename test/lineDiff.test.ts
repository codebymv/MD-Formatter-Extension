import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  diffLines,
  diffSummary,
  markdownChanged,
  normalizeMarkdown,
  summarizeDiff,
  toSideBySide,
} from "../src/diff/lineDiff";

describe("diffLines", () => {
  it("returns equal lines when texts match", () => {
    const lines = diffLines("a\nb", "a\nb");
    assert.deepEqual(lines, [
      { kind: "equal", text: "a" },
      { kind: "equal", text: "b" },
    ]);
    assert.equal(summarizeDiff(lines).changed, false);
  });

  it("marks added and removed lines for a typical format change", () => {
    const before = "Summary\nAdds endpoint\nBackend\nnew route";
    const after = "## Summary\n\nAdds endpoint\n\n## Backend\n\n- new route";
    const lines = diffLines(before, after);
    const kinds = lines.map((l) => l.kind);

    assert.ok(kinds.includes("remove"));
    assert.ok(kinds.includes("add"));
    assert.ok(lines.some((l) => l.kind === "equal" && l.text === "Adds endpoint"));

    const summary = summarizeDiff(lines);
    assert.equal(summary.changed, true);
    assert.ok(summary.added > 0);
    assert.ok(summary.removed > 0);
  });

  it("handles empty before (all adds)", () => {
    const lines = diffLines("", "hello\nworld");
    assert.deepEqual(lines, [
      { kind: "add", text: "hello" },
      { kind: "add", text: "world" },
    ]);
  });

  it("handles empty after (all removes)", () => {
    const lines = diffLines("hello\nworld", "");
    assert.deepEqual(lines, [
      { kind: "remove", text: "hello" },
      { kind: "remove", text: "world" },
    ]);
  });

  it("normalizes CRLF before comparing lines", () => {
    const lines = diffLines("a\r\nb", "a\nb");
    assert.deepEqual(lines, [
      { kind: "equal", text: "a" },
      { kind: "equal", text: "b" },
    ]);
  });

  it("preserves empty line slots", () => {
    const lines = diffLines("a\n\nb", "a\nb");
    assert.ok(lines.some((l) => l.kind === "remove" && l.text === ""));
    assert.ok(lines.some((l) => l.kind === "equal" && l.text === "a"));
    assert.ok(lines.some((l) => l.kind === "equal" && l.text === "b"));
  });
});

describe("diffSummary / markdownChanged", () => {
  it("summarizes via convenience helper", () => {
    const summary = diffSummary("a", "b");
    assert.equal(summary.changed, true);
    assert.equal(summary.added, 1);
    assert.equal(summary.removed, 1);
  });

  it("treats trailing blank lines as unchanged for markdownChanged", () => {
    assert.equal(markdownChanged("hello\n\n", "hello"), false);
    assert.equal(normalizeMarkdown("hello  \n"), "hello");
    assert.equal(markdownChanged("hello", "hello!"), true);
  });
});

describe("toSideBySide", () => {
  it("mirrors equal lines on both columns", () => {
    const rows = toSideBySide(diffLines("a\nb", "a\nb"));
    assert.deepEqual(rows, [
      {
        left: { kind: "equal", text: "a" },
        right: { kind: "equal", text: "a" },
      },
      {
        left: { kind: "equal", text: "b" },
        right: { kind: "equal", text: "b" },
      },
    ]);
  });

  it("zips a replace into one before/after row", () => {
    const rows = toSideBySide(diffLines("old", "new"));
    assert.deepEqual(rows, [
      {
        left: { kind: "remove", text: "old" },
        right: { kind: "add", text: "new" },
      },
    ]);
  });

  it("pads the shorter side with blank cells", () => {
    const rows = toSideBySide([
      { kind: "remove", text: "a" },
      { kind: "remove", text: "b" },
      { kind: "add", text: "x" },
    ]);
    assert.deepEqual(rows, [
      {
        left: { kind: "remove", text: "a" },
        right: { kind: "add", text: "x" },
      },
      {
        left: { kind: "remove", text: "b" },
        right: { kind: "blank", text: "" },
      },
    ]);
  });

  it("keeps equal anchors around a change hunk", () => {
    const rows = toSideBySide(diffLines("keep\nold\nkeep", "keep\nnew\nkeep"));
    assert.deepEqual(rows, [
      {
        left: { kind: "equal", text: "keep" },
        right: { kind: "equal", text: "keep" },
      },
      {
        left: { kind: "remove", text: "old" },
        right: { kind: "add", text: "new" },
      },
      {
        left: { kind: "equal", text: "keep" },
        right: { kind: "equal", text: "keep" },
      },
    ]);
  });

  it("handles all-add and all-remove as blank opposite columns", () => {
    assert.deepEqual(toSideBySide(diffLines("", "only")), [
      {
        left: { kind: "blank", text: "" },
        right: { kind: "add", text: "only" },
      },
    ]);
    assert.deepEqual(toSideBySide(diffLines("only", "")), [
      {
        left: { kind: "remove", text: "only" },
        right: { kind: "blank", text: "" },
      },
    ]);
  });
});
