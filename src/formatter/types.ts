// Shared types for the formatter and storage layers.

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

export interface Settings {
  apiKey: string;
  model: string;
  baseUrl: string;
}

export const DEFAULT_SETTINGS: Settings = {
  apiKey: "",
  model: "gpt-4.1-mini",
  baseUrl: "https://api.openai.com/v1",
};

/** Raised by the formatter for user-facing, friendly error messages. */
export class FormatterError extends Error {}
