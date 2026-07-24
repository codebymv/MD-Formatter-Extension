import { guideFromPreset } from "./profile";
import { FormatGuide, FormatPreset } from "./types";

/**
 * Builds the system + user prompt sent to the model. Kept separate from the
 * transport so it can be unit-tested and reused by a future content script.
 */

export const SYSTEM_PROMPT = `You are a technical release-note and pull-request-description formatter.

Your task is to transform the user's unstructured PR description into clean Markdown.

Rules:
- Preserve all factual details.
- Do not invent features, tests, files, routes, or results.
- Use proper Markdown headings.
- Use bullets for lists.
- Use tables for Area/Change, Surface/Action, PR/Title, or similar mappings.
- Use inline code for file names, routes, functions, commands, config keys, props, env vars, and status values.
- Use fenced code blocks for JSON, shell commands, multiline routes, file lists, and examples.
- Keep the tone professional and concise.
- Do not wrap the final answer in commentary.
- Return only the formatted Markdown.`;

function styleGuidance(guide: FormatGuide): string {
  const headings = guide.sections.map((s) => `## ${s}`).join("\n");
  return `${guide.label}\n\nPrefer this section structure when the input supports it (omit any section that has no relevant content; add others if the input clearly warrants them):\n\n${headings}`;
}

export function buildUserPrompt(
  input: string,
  style: FormatPreset | FormatGuide,
): string {
  const guide = typeof style === "string" ? guideFromPreset(style) : style;
  return `Preset:
${styleGuidance(guide)}

Raw PR description:
${input}`;
}
