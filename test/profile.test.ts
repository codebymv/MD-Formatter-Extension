import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatLocally } from "../src/formatter/localFormatter";
import {
  MAX_SAVED_PROFILES,
  createProfile,
  normalizeFormatSelection,
  normalizeProfiles,
  parseSectionList,
  removeProfile,
  resolveFormatGuide,
  selectionToValue,
  upsertProfile,
  valueToSelection,
} from "../src/formatter/profile";
import { PRESETS, SavedProfile } from "../src/formatter/types";

describe("profile helpers", () => {
  it("parses section lists, deduping and stripping markdown hashes", () => {
    assert.deepEqual(
      parseSectionList("## Summary\nWhat Changed\n\nsummary\nTest Plan\n"),
      ["Summary", "What Changed", "Test Plan"],
    );
  });

  it("creates a named profile from a built-in with optional custom sections", () => {
    const profile = createProfile({
      name: "  Platform services ",
      basedOn: "feature",
      sections: ["Summary", "Backend", "Rollout", "Test Plan"],
      id: "p_fixed",
    });
    assert.ok(profile);
    assert.equal(profile?.id, "p_fixed");
    assert.equal(profile?.name, "Platform services");
    assert.equal(profile?.basedOn, "feature");
    assert.deepEqual(profile?.sections, ["Summary", "Backend", "Rollout", "Test Plan"]);
  });

  it("rejects empty names and falls back to basedOn sections", () => {
    assert.equal(createProfile({ name: "   ", basedOn: "standard" }), null);
    const cloned = createProfile({ name: "Clone", basedOn: "bugfix" });
    assert.deepEqual(cloned?.sections, PRESETS.bugfix.sections);
  });

  it("normalizes stored profiles and upserts / removes by id", () => {
    const a = createProfile({ name: "A", basedOn: "standard", id: "p_a" })!;
    const b = createProfile({ name: "B", basedOn: "feature", id: "p_b" })!;
    let list = normalizeProfiles([a, { id: "bad" }, b, a]);
    assert.equal(list.length, 2);

    list = upsertProfile(list, {
      ...a,
      name: "A renamed",
      sections: ["Summary", "Notes"],
    });
    assert.equal(list.find((p) => p.id === "p_a")?.name, "A renamed");

    list = removeProfile(list, "p_a");
    assert.deepEqual(
      list.map((p) => p.id),
      ["p_b"],
    );
  });

  it("caps the number of saved profiles on insert", () => {
    let list: SavedProfile[] = [];
    for (let i = 0; i < MAX_SAVED_PROFILES; i++) {
      list = upsertProfile(
        list,
        createProfile({ name: `P${i}`, basedOn: "standard", id: `p_${i}` })!,
      );
    }
    assert.equal(list.length, MAX_SAVED_PROFILES);
    const blocked = upsertProfile(
      list,
      createProfile({ name: "Overflow", basedOn: "standard", id: "p_overflow" })!,
    );
    assert.equal(blocked.length, MAX_SAVED_PROFILES);
    assert.equal(
      blocked.some((p) => p.id === "p_overflow"),
      false,
    );
  });

  it("encodes selection values and resolves guides with fallback", () => {
    const profile = createProfile({
      name: "Infra",
      basedOn: "release",
      sections: ["Summary", "Deploy Impact", "Rollback"],
      id: "p_infra",
    })!;
    assert.equal(selectionToValue({ kind: "profile", id: "p_infra" }), "profile:p_infra");
    assert.deepEqual(valueToSelection("profile:p_infra"), {
      kind: "profile",
      id: "p_infra",
    });
    assert.deepEqual(valueToSelection("feature"), { kind: "preset", id: "feature" });

    const hit = resolveFormatGuide({ kind: "profile", id: "p_infra" }, [profile]);
    assert.equal(hit.guide.label, "Infra");
    assert.deepEqual(hit.guide.sections, ["Summary", "Deploy Impact", "Rollback"]);

    const miss = resolveFormatGuide({ kind: "profile", id: "missing" }, [profile]);
    assert.deepEqual(miss.selection, { kind: "preset", id: "standard" });
    assert.equal(miss.guide.label, PRESETS.standard.label);

    assert.deepEqual(
      normalizeFormatSelection({ kind: "profile", id: "missing" }, [profile]),
      { kind: "preset", id: "standard" },
    );
  });

  it("applies a saved profile's custom section order offline", () => {
    const profile = createProfile({
      name: "Ops",
      basedOn: "standard",
      sections: ["Summary", "Deploy Impact", "What Changed"],
      id: "p_ops",
    })!;
    const input = `What Changed
touched the cron
Deploy Impact
needs a bounce
Summary
ops tweak
`;
    const out = formatLocally(input, {
      label: profile.name,
      sections: profile.sections,
    });
    const summaryAt = out.indexOf("## Summary");
    const deployAt = out.indexOf("## Deploy Impact");
    const changedAt = out.indexOf("## What Changed");
    assert.ok(summaryAt >= 0 && deployAt > summaryAt && changedAt > deployAt);
  });
});
