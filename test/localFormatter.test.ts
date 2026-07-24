import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canonicalizeHeadingForPreset,
  formatLocally,
} from "../src/formatter/localFormatter";

describe("formatLocally", () => {
  it("formats the README sample into the documented Markdown", () => {
    const input = `Summary
Adds a new admin endpoint to report issues to Forgejo. Uses FORGEJO_PAT for auth.
Backend
new route POST /admin/forgejo/issues
protected by AuthGuard and AdminGuard
reads config key FORGEJO_BASE_URL
Frontend
added ems-report-issue-modal.tsx component
wired up a button
Test plan
ran npm run build
added ems-report-issue-modal.test.tsx
`;

    const expected = `## Summary

Adds a new admin endpoint to report issues to Forgejo. Uses \`FORGEJO_PAT\` for auth.

## Backend

- new route \`POST /admin/forgejo/issues\`
- protected by AuthGuard and AdminGuard
- reads config key \`FORGEJO_BASE_URL\`

## Frontend

- added \`ems-report-issue-modal.tsx\` component
- wired up a button

## Test Plan

- ran \`npm run build\`
- added \`ems-report-issue-modal.test.tsx\`
`;

    assert.equal(formatLocally(input, "feature"), expected);
  });

  it("wraps heading-less notes in a Summary section", () => {
    const out = formatLocally("Fixed the flaky upload retry path.");
    assert.equal(out, "## Summary\n\nFixed the flaky upload retry path.\n");
  });

  it("preserves fenced code blocks without bulletizing inside them", () => {
    const input = `Summary
Example payload:
\`\`\`json
{"ok": true}
\`\`\`
`;
    const out = formatLocally(input);
    assert.match(out, /## Summary/);
    assert.match(out, /```json\n\{"ok": true\}\n```/);
    assert.doesNotMatch(out, /- ```/);
  });

  it("reorders sections to match the active preset", () => {
    const input = `Backend
added route handler
Summary
ships the admin report flow
Test plan
ran unit tests
`;
    const out = formatLocally(input, "feature");
    const summaryAt = out.indexOf("## Summary");
    const backendAt = out.indexOf("## Backend");
    const testAt = out.indexOf("## Test Plan");
    assert.ok(summaryAt >= 0 && backendAt > summaryAt && testAt > backendAt);
  });

  it("canonicalizes Testing → Test Plan for presets that prefer Test Plan", () => {
    const input = `Testing
ran npm test
`;
    const out = formatLocally(input, "standard");
    assert.match(out, /^## Test Plan\n/m);
    assert.doesNotMatch(out, /^## Testing\n/m);
  });

  it("maps Changes → What Changed for the feature preset", () => {
    assert.equal(canonicalizeHeadingForPreset("Changes", "feature"), "What Changed");
    assert.equal(canonicalizeHeadingForPreset("Changes", "bugfix"), "Changes");
  });

  it("merges synonym sections after canonicalization", () => {
    const input = `Test plan
ran lint
Testing
ran typecheck
`;
    const out = formatLocally(input, "bugfix");
    const matches = out.match(/^## Test Plan$/gm);
    assert.equal(matches?.length, 1);
    assert.match(out, /ran lint/);
    assert.match(out, /ran typecheck/);
  });
});
