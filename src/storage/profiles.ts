import {
  FormatGuide,
  FormatSelection,
  FormatPreset,
  PRESETS,
  SavedProfile,
} from "../formatter/types";
import {
  isFormatPreset,
  normalizeFormatSelection,
  normalizeProfiles,
  removeProfile,
  resolveFormatGuide,
  upsertProfile,
} from "../formatter/profile";
import { loadPreset, savePreset } from "./preset";

const PROFILES_KEY = "profiles";
const SELECTION_KEY = "formatSelection";

/**
 * Saved formatting profiles + layout selection persistence.
 * Falls back to in-memory when `chrome.storage` is unavailable (dev / tests).
 */

let memoryProfiles: SavedProfile[] | null = null;
let memorySelection: FormatSelection | null = null;

function hasChromeStorage(): boolean {
  return (
    typeof chrome !== "undefined" &&
    !!chrome.storage &&
    !!chrome.storage.local
  );
}

export async function loadProfiles(): Promise<SavedProfile[]> {
  if (!hasChromeStorage()) {
    return normalizeProfiles(memoryProfiles ?? []);
  }
  const stored = await chrome.storage.local.get(PROFILES_KEY);
  return normalizeProfiles(stored?.[PROFILES_KEY]);
}

export async function saveProfiles(profiles: SavedProfile[]): Promise<void> {
  const normalized = normalizeProfiles(profiles);
  if (!hasChromeStorage()) {
    memoryProfiles = normalized;
    return;
  }
  await chrome.storage.local.set({ [PROFILES_KEY]: normalized });
}

export async function saveProfile(profile: SavedProfile): Promise<SavedProfile[]> {
  const current = await loadProfiles();
  const next = upsertProfile(current, profile);
  await saveProfiles(next);
  return next;
}

export async function deleteProfile(id: string): Promise<SavedProfile[]> {
  const current = await loadProfiles();
  const next = removeProfile(current, id);
  await saveProfiles(next);

  const selection = await loadFormatSelection(next);
  if (selection.kind === "profile" && selection.id === id) {
    await saveFormatSelection({ kind: "preset", id: "standard" });
  }
  return next;
}

export async function loadFormatSelection(
  profiles?: SavedProfile[],
): Promise<FormatSelection> {
  const list = profiles ?? (await loadProfiles());

  if (!hasChromeStorage()) {
    if (memorySelection) {
      return normalizeFormatSelection(memorySelection, list);
    }
    const preset = await loadPreset();
    return { kind: "preset", id: preset };
  }

  const stored = await chrome.storage.local.get(SELECTION_KEY);
  if (stored?.[SELECTION_KEY] != null) {
    return normalizeFormatSelection(stored[SELECTION_KEY], list);
  }

  // Backward compat: older builds only persisted the built-in preset key.
  const preset = await loadPreset();
  return { kind: "preset", id: isFormatPreset(preset) ? preset : "standard" };
}

export async function saveFormatSelection(selection: FormatSelection): Promise<void> {
  const profiles = await loadProfiles();
  const normalized = normalizeFormatSelection(selection, profiles);

  if (!hasChromeStorage()) {
    memorySelection = normalized;
  } else {
    await chrome.storage.local.set({ [SELECTION_KEY]: normalized });
  }

  // Keep the legacy preset key aligned when a built-in is active so older
  // listeners / code paths stay consistent.
  if (normalized.kind === "preset") {
    await savePreset(normalized.id);
  } else {
    const profile = profiles.find((p) => p.id === normalized.id);
    const basedOn: FormatPreset =
      profile && profile.basedOn in PRESETS ? profile.basedOn : "standard";
    await savePreset(basedOn);
  }
}

/** Resolve the guide the formatter should use right now. */
export async function loadActiveFormatGuide(): Promise<{
  guide: FormatGuide;
  selection: FormatSelection;
  profiles: SavedProfile[];
}> {
  const profiles = await loadProfiles();
  const selection = await loadFormatSelection(profiles);
  const resolved = resolveFormatGuide(selection, profiles);
  if (
    resolved.selection.kind !== selection.kind ||
    resolved.selection.id !== selection.id
  ) {
    await saveFormatSelection(resolved.selection);
  }
  return { ...resolved, profiles };
}
