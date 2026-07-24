/**
 * Line-oriented before/after diff for Markdown preview.
 * Pure — no DOM / chrome APIs — so unit tests and UI can share it.
 */

export type DiffLine =
  | { kind: "equal"; text: string }
  | { kind: "add"; text: string }
  | { kind: "remove"; text: string };

export interface DiffSummary {
  added: number;
  removed: number;
  unchanged: number;
  /** True when before and after are not identical (ignoring trailing EOF newline only). */
  changed: boolean;
}

function splitLines(text: string): string[] {
  if (text.length === 0) return [];
  // Preserve empty trailing line semantics: "a\n" → ["a", ""]
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
}

/**
 * Classic LCS line diff. Fine for PR-description sizes (typically ≪ 1k lines).
 */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = splitLines(before);
  const b = splitLines(after);
  const n = a.length;
  const m = b.length;

  // dp[i][j] = LCS length of a[i..] and b[j..]
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  );
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      if (a[i] === b[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ kind: "equal", text: a[i]! });
      i += 1;
      j += 1;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      out.push({ kind: "remove", text: a[i]! });
      i += 1;
    } else {
      out.push({ kind: "add", text: b[j]! });
      j += 1;
    }
  }
  while (i < n) {
    out.push({ kind: "remove", text: a[i]! });
    i += 1;
  }
  while (j < m) {
    out.push({ kind: "add", text: b[j]! });
    j += 1;
  }
  return out;
}

export function summarizeDiff(lines: DiffLine[]): DiffSummary {
  let added = 0;
  let removed = 0;
  let unchanged = 0;
  for (const line of lines) {
    if (line.kind === "add") added += 1;
    else if (line.kind === "remove") removed += 1;
    else unchanged += 1;
  }
  return {
    added,
    removed,
    unchanged,
    changed: added > 0 || removed > 0,
  };
}

/** Left/right cell kinds for a side-by-side (column) row. */
export type SideBySideCellKind = "equal" | "add" | "remove" | "blank";

export interface SideBySideCell {
  kind: SideBySideCellKind;
  text: string;
}

export interface SideBySideRow {
  left: SideBySideCell;
  right: SideBySideCell;
}

/**
 * Pair a unified DiffLine[] into left (before) / right (after) columns.
 * Consecutive non-equal hunks are zipped; the shorter side gets blank cells.
 */
export function toSideBySide(lines: DiffLine[]): SideBySideRow[] {
  const rows: SideBySideRow[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.kind === "equal") {
      rows.push({
        left: { kind: "equal", text: line.text },
        right: { kind: "equal", text: line.text },
      });
      i += 1;
      continue;
    }

    const removes: string[] = [];
    const adds: string[] = [];
    while (i < lines.length && lines[i]!.kind !== "equal") {
      const cur = lines[i]!;
      if (cur.kind === "remove") removes.push(cur.text);
      else adds.push(cur.text);
      i += 1;
    }

    const n = Math.max(removes.length, adds.length);
    for (let k = 0; k < n; k += 1) {
      const leftText = removes[k];
      const rightText = adds[k];
      rows.push({
        left:
          leftText !== undefined
            ? { kind: "remove", text: leftText }
            : { kind: "blank", text: "" },
        right:
          rightText !== undefined
            ? { kind: "add", text: rightText }
            : { kind: "blank", text: "" },
      });
    }
  }
  return rows;
}

export function diffSummary(before: string, after: string): DiffSummary {
  return summarizeDiff(diffLines(before, after));
}

/** Normalize for "already formatted" checks (trim trailing whitespace per line + EOF). */
export function normalizeMarkdown(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n+$/g, "");
}

export function markdownChanged(before: string, after: string): boolean {
  return normalizeMarkdown(before) !== normalizeMarkdown(after);
}
