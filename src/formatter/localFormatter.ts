
/**
 * A deterministic, no-network heuristic formatter used when no API key is
 * configured. It is intentionally conservative: it never invents content, it
 * only restructures and lightly marks up what the author already wrote.
 *
 * It is not as smart as the model path, but it makes the extension fully
 * usable for development and for users who haven't configured a key yet.
 */

import { guideFromPreset } from "./profile";
import { FormatGuide, FormatPreset, PRESETS } from "./types";

// Headings we recognize when an author types a bare section label on its own
// line (e.g. "Backend"). Maps a lowercased label to its canonical Title Case.
const KNOWN_HEADINGS = new Map<string, string>(
  [
    "Summary",
    "Overview",
    "What Changed",
    "Changes",
    "Background",
    "Motivation",
    "Context",
    "Root Cause",
    "Backend",
    "Frontend",
    "API",
    "API / Contracts",
    "Contracts",
    "Database",
    "Configuration",
    "Config",
    "Infrastructure",
    "Migration",
    "Test Plan",
    "Testing",
    "Tests",
    "Automated Verification",
    "Verification",
    "Included Changes",
    "Deploy Impact",
    "Release Notes",
    "Notes",
    "Screenshots",
    "Breaking Changes",
    "Security",
    "Performance",
  ].map((h) => [h.toLowerCase(), h]),
);

/**
 * Synonym groups. When a heading matches any member and the active preset
 * prefers another member of the same group, rewrite to that preferred name.
 * Never invents sections — only renames what the author already wrote.
 */
const HEADING_ALIAS_GROUPS: string[][] = [
  ["Summary", "Overview"],
  ["What Changed", "Changes"],
  ["Root Cause", "Background", "Motivation", "Context"],
  ["Configuration", "Config"],
  ["Test Plan", "Testing", "Tests"],
  ["Automated Verification", "Verification"],
];

// Inline technical tokens that read better in backticks. Conservative: only
// wraps tokens that are clearly code-ish and not already inside backticks.
const INLINE_PATTERNS: RegExp[] = [
  // HTTP routes: GET /foo/bar, POST /admin/x
  /\b(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+\/[^\s`]+/g,
  // Bare paths/routes starting with a slash: /api/v1/users
  /(?<![`\w/])\/[A-Za-z0-9._\-]+(?:\/[A-Za-z0-9._\-:{}]+)+/g,
  // SCREAMING_SNAKE env vars / config keys: FORGEJO_PAT, API_BASE_URL
  /(?<![`\w])[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+(?![`\w])/g,
  // File names with common code extensions
  /(?<![`\w/])[A-Za-z0-9._\-]+\.(?:tsx?|jsx?|json|ya?ml|css|scss|html|md|py|go|rs|java|rb|sh|sql|env|toml|lock)\b/g,
  // npm/yarn/pnpm/git/docker commands
  /\b(?:npm|npx|yarn|pnpm|git|docker|kubectl|make)\s+[a-z][\w:-]*(?:\s+[\w.:@/-]+)?/g,
];

const CODE_FENCE = "```";

interface Block {
  heading?: string;
  lines: string[];
}

function isProbablyHeading(line: string): { canonical: string } | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 40) return null;
  // Already a markdown heading.
  if (/^#{1,6}\s+/.test(trimmed)) {
    return { canonical: trimmed.replace(/^#{1,6}\s+/, "").trim() };
  }
  // Trailing-colon labels: "Backend:" or "Test plan:"
  const noColon = trimmed.replace(/:$/, "").trim();
  const known = KNOWN_HEADINGS.get(noColon.toLowerCase());
  if (known) return { canonical: known };
  // A short Title-ish line with no terminal punctuation, sitting alone, is a
  // likely heading — but only if it has at most 4 words to avoid eating prose.
  if (
    /:$/.test(trimmed) &&
    noColon.split(/\s+/).length <= 5 &&
    !/[.!?]$/.test(noColon)
  ) {
    return { canonical: toTitleCase(noColon) };
  }
  return null;
}

function toTitleCase(s: string): string {
  return s
    .split(/\s+/)
    .map((w) => (w.length <= 2 ? w : w[0].toUpperCase() + w.slice(1)))
    .join(" ");
}

function markInline(text: string): string {
  // Apply each pattern only to segments that are NOT already inside backticks,
  // so wider matches (e.g. `POST /x`) aren't re-wrapped by narrower ones (`/x`).
  let segments: string[] = [text];
  for (const re of INLINE_PATTERNS) {
    const next: string[] = [];
    for (const seg of segments) {
      if (seg.startsWith("`") && seg.endsWith("`")) {
        next.push(seg); // already code — leave untouched
        continue;
      }
      let lastIndex = 0;
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(seg)) !== null) {
        if (m.index > lastIndex) next.push(seg.slice(lastIndex, m.index));
        next.push(`\`${m[0].trim()}\``);
        lastIndex = m.index + m[0].length;
        if (m[0].length === 0) re.lastIndex++; // guard against zero-width
      }
      if (lastIndex < seg.length) next.push(seg.slice(lastIndex));
    }
    segments = next;
  }
  return segments.join("");
}

// Section labels whose bodies are prose paragraphs, not bullet lists.
const PROSE_HEADINGS = new Set(
  ["Summary", "Overview", "Background", "Motivation", "Context", "Root Cause"].map((h) =>
    h.toLowerCase(),
  ),
);

function splitIntoBlocks(input: string): Block[] {
  const lines = input.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let current: Block = { lines: [] };
  let inFence = false;

  for (const raw of lines) {
    if (raw.trim().startsWith(CODE_FENCE)) {
      inFence = !inFence;
      current.lines.push(raw);
      continue;
    }
    if (inFence) {
      current.lines.push(raw);
      continue;
    }
    const heading = isProbablyHeading(raw);
    if (heading) {
      if (current.heading || current.lines.some((l) => l.trim())) {
        blocks.push(current);
      }
      current = { heading: heading.canonical, lines: [] };
    } else {
      current.lines.push(raw);
    }
  }
  if (current.heading || current.lines.some((l) => l.trim())) {
    blocks.push(current);
  }
  return blocks;
}

function renderBody(lines: string[], bulletize: boolean): string {
  const out: string[] = [];
  let inFence = false;
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    if (line.trim().startsWith(CODE_FENCE)) {
      inFence = !inFence;
      out.push(line);
      continue;
    }
    if (inFence) {
      out.push(line);
      continue;
    }
    if (!line.trim()) {
      out.push("");
      continue;
    }
    // Existing list/quote markers are preserved as-is.
    if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
      out.push(markInline(line));
      continue;
    }
    const marked = markInline(line.trim());
    out.push(bulletize ? `- ${marked}` : marked);
  }
  // Collapse 3+ blank lines down to one.
  return out
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// A section's body reads as a bullet list when it has 2+ content lines and the
// heading isn't a prose section like Summary.
function shouldBulletize(heading: string | undefined, lines: string[]): boolean {
  if (heading && PROSE_HEADINGS.has(heading.toLowerCase())) return false;
  const contentLines = lines.filter(
    (l) => l.trim() && !l.trim().startsWith(CODE_FENCE),
  );
  return contentLines.length >= 2;
}

/**
 * Rewrite a heading toward a synonym the active guide prefers, when one exists.
 */
export function canonicalizeHeading(
  heading: string,
  sections: string[],
): string {
  const preferred = new Map(sections.map((s) => [s.toLowerCase(), s]));
  const exact = preferred.get(heading.toLowerCase());
  if (exact) return exact;

  for (const group of HEADING_ALIAS_GROUPS) {
    const lower = group.map((g) => g.toLowerCase());
    if (!lower.includes(heading.toLowerCase())) continue;
    for (const name of group) {
      const match = preferred.get(name.toLowerCase());
      if (match) return match;
    }
  }
  return heading;
}

/** @deprecated Prefer canonicalizeHeading with explicit sections. */
export function canonicalizeHeadingForPreset(
  heading: string,
  preset: FormatPreset,
): string {
  return canonicalizeHeading(heading, PRESETS[preset].sections);
}

function resolveGuide(style: FormatPreset | FormatGuide): FormatGuide {
  return typeof style === "string" ? guideFromPreset(style) : style;
}

/**
 * Apply synonym rewrites, merge duplicate headings, then order sections
 * so guide-preferred headings come first (remaining keep encounter order).
 */
function applyGuide(blocks: Block[], guide: FormatGuide): Block[] {
  const normalized: Block[] = blocks.map((b) =>
    b.heading
      ? { heading: canonicalizeHeading(b.heading, guide.sections), lines: [...b.lines] }
      : { lines: [...b.lines] },
  );

  // Merge headed blocks that share a canonical title; keep first headless as-is.
  const merged: Block[] = [];
  for (const block of normalized) {
    if (!block.heading) {
      merged.push(block);
      continue;
    }
    const existing = merged.find(
      (m) => m.heading && m.heading.toLowerCase() === block.heading!.toLowerCase(),
    );
    if (existing) {
      if (existing.lines.length && block.lines.length) existing.lines.push("");
      existing.lines.push(...block.lines);
    } else {
      merged.push(block);
    }
  }

  const order = guide.sections.map((s) => s.toLowerCase());
  const leading: Block[] = [];
  const headed: Block[] = [];
  for (const block of merged) {
    if (!block.heading) {
      // Only leading (pre-first-heading) headless content is kept at front;
      // after headings appear, headless blocks shouldn't occur from the splitter.
      if (headed.length === 0) leading.push(block);
      else headed.push(block);
    } else {
      headed.push(block);
    }
  }

  const ranked: Block[] = [];
  const used = new Set<Block>();
  for (const key of order) {
    for (const block of headed) {
      if (used.has(block) || !block.heading) continue;
      if (block.heading.toLowerCase() === key) {
        ranked.push(block);
        used.add(block);
      }
    }
  }
  for (const block of headed) {
    if (!used.has(block)) ranked.push(block);
  }

  return [...leading, ...ranked];
}

export function formatLocally(
  input: string,
  style: FormatPreset | FormatGuide = "standard",
): string {
  const guide = resolveGuide(style);
  const blocks = applyGuide(splitIntoBlocks(input), guide);

  const sections: string[] = [];

  // If the author wrote no recognizable headings at all, fall back to a single
  // Summary section so output is still valid Markdown.
  const anyHeading = blocks.some((b) => b.heading);

  if (!anyHeading) {
    const allLines = blocks.flatMap((b) => b.lines);
    const body = renderBody(allLines, false);
    return `## Summary\n\n${body}\n`;
  }

  for (const block of blocks) {
    const body = renderBody(block.lines, shouldBulletize(block.heading, block.lines));
    if (block.heading) {
      sections.push(`## ${block.heading}\n\n${body}`.trimEnd());
    } else if (body) {
      // Leading content before any heading becomes the Summary.
      sections.push(`## Summary\n\n${renderBody(block.lines, false)}`);
    }
  }

  return `${sections.join("\n\n").trim()}\n`;
}
