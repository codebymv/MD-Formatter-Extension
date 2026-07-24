// Shared types for the formatter and storage layers.

import {
  DEFAULT_ENDPOINT_PRESET,
  EndpointPresetId,
  ENDPOINT_PRESETS,
} from "./endpointPresets";

export type { EndpointPresetId } from "./endpointPresets";
export { ENDPOINT_PRESETS, DEFAULT_ENDPOINT_PRESET, isEndpointPresetId } from "./endpointPresets";

export type FormatPreset = "standard" | "feature" | "bugfix" | "release";

export interface PresetMeta {
  id: FormatPreset;
  label: string;
  /** Section skeleton that guides (not forces) the model's output. */
  sections: string[];
}

export const PRESETS: Record<FormatPreset, PresetMeta> = {
  standard: {
    id: "standard",
    label: "Standard PR",
    sections: ["Summary", "What Changed", "Test Plan", "Automated Verification"],
  },
  feature: {
    id: "feature",
    label: "Feature PR",
    sections: [
      "Summary",
      "What Changed",
      "Backend",
      "Frontend",
      "Configuration",
      "Test Plan",
      "Automated Verification",
    ],
  },
  bugfix: {
    id: "bugfix",
    label: "Bugfix PR",
    sections: ["Summary", "Root Cause", "Changes", "Test Plan", "Automated Verification"],
  },
  release: {
    id: "release",
    label: "Release PR",
    sections: ["Summary", "Included Changes", "Deploy Impact", "Test Plan", "Release Notes"],
  },
};

/**
 * Resolved section guidance used by the offline formatter and API prompt.
 * Built-ins and saved profiles both collapse to this shape.
 */
export interface FormatGuide {
  label: string;
  sections: string[];
}

/** Named user-saved formatting profile (clone of a built-in with custom sections). */
export interface SavedProfile {
  id: string;
  name: string;
  /** Built-in the profile was cloned from (for defaults / toolbar hints). */
  basedOn: FormatPreset;
  sections: string[];
}

/** Active style selection shared by popup, toolbar, and service worker. */
export type FormatSelection =
  | { kind: "preset"; id: FormatPreset }
  | { kind: "profile"; id: string };

export interface Settings {
  apiKey: string;
  model: string;
  baseUrl: string;
  /** Built-in endpoint preset that seeded model / base URL (Custom = free-form). */
  endpointPreset: EndpointPresetId;
}

export const DEFAULT_SETTINGS: Settings = {
  apiKey: "",
  model: ENDPOINT_PRESETS.openai.model,
  baseUrl: ENDPOINT_PRESETS.openai.baseUrl,
  endpointPreset: DEFAULT_ENDPOINT_PRESET,
};

/** Raised by the formatter for user-facing, friendly error messages. */
export class FormatterError extends Error {}
