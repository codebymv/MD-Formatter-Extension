/**
 * Pure helpers for named formatting profiles. No chrome APIs — safe for unit tests.
 */

import {
  FormatGuide,
  FormatPreset,
  FormatSelection,
  PRESETS,
  SavedProfile,
} from "./types";

export const PROFILE_VALUE_PREFIX = "profile:" as const;
export const MAX_PROFILE_NAME_LENGTH = 48;
export const MAX_PROFILE_SECTIONS = 24;
export const MAX_SAVED_PROFILES = 20;

export function isFormatPreset(value: unknown): value is FormatPreset {
  return typeof value === "string" && value in PRESETS;
}

export function guideFromPreset(preset: FormatPreset): FormatGuide {
  const meta = PRESETS[preset];
  return { label: meta.label, sections: [...meta.sections] };
}

export function guideFromProfile(profile: SavedProfile): FormatGuide {
  return { label: profile.name, sections: [...profile.sections] };
}

export function sanitizeProfileName(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.replace(/\s+/g, " ").trim().slice(0, MAX_PROFILE_NAME_LENGTH);
}

/** Parse a section list from a textarea (one heading per line). */
export function parseSectionList(raw: unknown): string[] {
  if (typeof raw !== "string") return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const heading = line.replace(/^#+\s*/, "").trim();
    if (!heading) continue;
    const key = heading.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(heading);
    if (out.length >= MAX_PROFILE_SECTIONS) break;
  }
  return out;
}

export function serializeSectionList(sections: string[]): string {
  return sections.join("\n");
}

export function newProfileId(): string {
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createProfile(input: {
  name: string;
  basedOn: FormatPreset;
  sections?: string[];
  id?: string;
}): SavedProfile | null {
  const name = sanitizeProfileName(input.name);
  if (!name) return null;
  const basedOn = isFormatPreset(input.basedOn) ? input.basedOn : "standard";
  const sections =
    input.sections && input.sections.length > 0
      ? parseSectionList(input.sections.join("\n"))
      : [...PRESETS[basedOn].sections];
  if (sections.length === 0) return null;
  return {
    id: input.id && input.id.trim() ? input.id.trim() : newProfileId(),
    name,
    basedOn,
    sections,
  };
}

export function normalizeProfile(raw: unknown): SavedProfile | null {
  if (!raw || typeof raw !== "object") return null;
  const v = raw as Record<string, unknown>;
  const basedOn = isFormatPreset(v.basedOn) ? v.basedOn : "standard";
  const sections = Array.isArray(v.sections)
    ? parseSectionList(v.sections.filter((s) => typeof s === "string").join("\n"))
    : [];
  return createProfile({
    id: typeof v.id === "string" ? v.id : undefined,
    name: typeof v.name === "string" ? v.name : "",
    basedOn,
    sections: sections.length > 0 ? sections : [...PRESETS[basedOn].sections],
  });
}

export function normalizeProfiles(raw: unknown): SavedProfile[] {
  if (!Array.isArray(raw)) return [];
  const out: SavedProfile[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const profile = normalizeProfile(item);
    if (!profile || seen.has(profile.id)) continue;
    seen.add(profile.id);
    out.push(profile);
    if (out.length >= MAX_SAVED_PROFILES) break;
  }
  return out;
}

/** Insert or replace by id. Enforces MAX_SAVED_PROFILES for new inserts. */
export function upsertProfile(
  profiles: SavedProfile[],
  profile: SavedProfile,
): SavedProfile[] {
  const normalized = normalizeProfile(profile);
  if (!normalized) return [...profiles];
  const index = profiles.findIndex((p) => p.id === normalized.id);
  if (index >= 0) {
    const next = [...profiles];
    next[index] = normalized;
    return next;
  }
  if (profiles.length >= MAX_SAVED_PROFILES) return [...profiles];
  return [...profiles, normalized];
}

export function removeProfile(profiles: SavedProfile[], id: string): SavedProfile[] {
  return profiles.filter((p) => p.id !== id);
}

export function findProfile(
  profiles: SavedProfile[],
  id: string,
): SavedProfile | undefined {
  return profiles.find((p) => p.id === id);
}

export function selectionToValue(selection: FormatSelection): string {
  return selection.kind === "preset"
    ? selection.id
    : `${PROFILE_VALUE_PREFIX}${selection.id}`;
}

export function valueToSelection(value: string): FormatSelection | null {
  if (isFormatPreset(value)) return { kind: "preset", id: value };
  if (value.startsWith(PROFILE_VALUE_PREFIX)) {
    const id = value.slice(PROFILE_VALUE_PREFIX.length);
    if (id) return { kind: "profile", id };
  }
  return null;
}

/**
 * Resolve the active selection against saved profiles. Falls back to the
 * built-in preset (or standard) when a profile id is missing.
 */
export function resolveFormatGuide(
  selection: FormatSelection,
  profiles: SavedProfile[],
): { guide: FormatGuide; selection: FormatSelection } {
  if (selection.kind === "profile") {
    const profile = findProfile(profiles, selection.id);
    if (profile) {
      return { guide: guideFromProfile(profile), selection };
    }
    return {
      guide: guideFromPreset("standard"),
      selection: { kind: "preset", id: "standard" },
    };
  }
  const preset = isFormatPreset(selection.id) ? selection.id : "standard";
  return {
    guide: guideFromPreset(preset),
    selection: { kind: "preset", id: preset },
  };
}

export function normalizeFormatSelection(
  raw: unknown,
  profiles: SavedProfile[],
): FormatSelection {
  if (raw && typeof raw === "object") {
    const v = raw as Record<string, unknown>;
    if (v.kind === "profile" && typeof v.id === "string") {
      if (findProfile(profiles, v.id)) return { kind: "profile", id: v.id };
      return { kind: "preset", id: "standard" };
    }
    if (v.kind === "preset" && isFormatPreset(v.id)) {
      return { kind: "preset", id: v.id };
    }
  }
  if (isFormatPreset(raw)) return { kind: "preset", id: raw };
  return { kind: "preset", id: "standard" };
}
