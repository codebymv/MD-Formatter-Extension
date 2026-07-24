/**
 * In-page before/after (line diff) preview panel for Format Markdown.
 * Pure DOM helpers — unit-testable with linkedom; no chrome.* calls.
 */

import {
  DiffLine,
  SideBySideRow,
  diffLines,
  summarizeDiff,
  toSideBySide,
} from "../diff/lineDiff";
import {
  DEFAULT_DIFF_LAYOUT,
  DiffPreviewLayout,
} from "../storage/diffLayout";

export const PREVIEW_PANEL_CLASS = "md-formatter-preview";
export const PREVIEW_APPLY_CLASS = "md-formatter-preview__apply";
export const PREVIEW_DISMISS_CLASS = "md-formatter-preview__dismiss";
export const PREVIEW_BODY_CLASS = "md-formatter-preview__body";
export const PREVIEW_LAYOUT_UNIFIED_CLASS = "md-formatter-preview__layout-unified";
export const PREVIEW_LAYOUT_COLUMNS_CLASS = "md-formatter-preview__layout-columns";

export type { DiffPreviewLayout };

export interface DiffPreviewHandlers {
  onApply: (markdown: string) => void | Promise<void>;
  onDismiss?: () => void | Promise<void>;
  /** Fired when the user toggles Columns / Unified. */
  onLayoutChange?: (layout: DiffPreviewLayout) => void | Promise<void>;
}

export interface DiffPreviewMountOptions extends DiffPreviewHandlers {
  before: string;
  after: string;
  /** Default: "columns" (side-by-side). */
  layout?: DiffPreviewLayout;
}

function lineClass(kind: DiffLine["kind"]): string {
  if (kind === "add") return "md-formatter-preview__line md-formatter-preview__line--add";
  if (kind === "remove") {
    return "md-formatter-preview__line md-formatter-preview__line--remove";
  }
  return "md-formatter-preview__line md-formatter-preview__line--equal";
}

function linePrefix(kind: DiffLine["kind"]): string {
  if (kind === "add") return "+";
  if (kind === "remove") return "-";
  return " ";
}

function cellClass(side: "left" | "right", kind: SideBySideRow["left"]["kind"]): string {
  return `md-formatter-preview__cell md-formatter-preview__cell--${side} md-formatter-preview__cell--${kind}`;
}

function renderUnified(doc: Document, lines: DiffLine[]): HTMLElement {
  const body = doc.createElement("pre");
  body.className = PREVIEW_BODY_CLASS;
  body.setAttribute("data-diff-layout", "unified");
  body.setAttribute("aria-label", "Format Markdown diff preview");

  for (const line of lines) {
    const row = doc.createElement("div");
    row.className = lineClass(line.kind);
    row.setAttribute("data-diff-kind", line.kind);
    const prefix = doc.createElement("span");
    prefix.className = "md-formatter-preview__prefix";
    prefix.textContent = linePrefix(line.kind);
    const text = doc.createElement("span");
    text.className = "md-formatter-preview__text";
    text.textContent = line.text.length > 0 ? line.text : " ";
    row.appendChild(prefix);
    row.appendChild(text);
    body.appendChild(row);
  }
  return body;
}

function renderColumns(doc: Document, rows: SideBySideRow[]): HTMLElement {
  const body = doc.createElement("div");
  body.className = `${PREVIEW_BODY_CLASS} md-formatter-preview__body--columns`;
  body.setAttribute("data-diff-layout", "columns");
  body.setAttribute("aria-label", "Format Markdown side-by-side diff preview");

  const head = doc.createElement("div");
  head.className = "md-formatter-preview__col-head";
  head.setAttribute("aria-hidden", "true");
  const headLeft = doc.createElement("span");
  headLeft.className = "md-formatter-preview__col-label";
  headLeft.textContent = "Before";
  const headRight = doc.createElement("span");
  headRight.className = "md-formatter-preview__col-label";
  headRight.textContent = "After";
  head.appendChild(headLeft);
  head.appendChild(headRight);
  body.appendChild(head);

  for (const pair of rows) {
    const row = doc.createElement("div");
    row.className = "md-formatter-preview__row";
    row.setAttribute("data-diff-left", pair.left.kind);
    row.setAttribute("data-diff-right", pair.right.kind);

    const left = doc.createElement("div");
    left.className = cellClass("left", pair.left.kind);
    left.textContent = pair.left.text.length > 0 ? pair.left.text : " ";

    const right = doc.createElement("div");
    right.className = cellClass("right", pair.right.kind);
    right.textContent = pair.right.text.length > 0 ? pair.right.text : " ";

    row.appendChild(left);
    row.appendChild(right);
    body.appendChild(row);
  }
  return body;
}

function setLayoutToggleState(
  unifiedBtn: HTMLButtonElement,
  columnsBtn: HTMLButtonElement,
  layout: DiffPreviewLayout,
): void {
  const isColumns = layout === "columns";
  unifiedBtn.setAttribute("aria-pressed", isColumns ? "false" : "true");
  columnsBtn.setAttribute("aria-pressed", isColumns ? "true" : "false");
  unifiedBtn.classList.toggle("md-formatter-preview__layout-btn--active", !isColumns);
  columnsBtn.classList.toggle("md-formatter-preview__layout-btn--active", isColumns);
}

/** Remove any existing preview panel under `root`. */
export function dismissDiffPreviewPanel(root: ParentNode = document): void {
  const existing = root.querySelectorAll(`.${PREVIEW_PANEL_CLASS}`);
  for (const el of Array.from(existing)) {
    el.remove();
  }
}

/**
 * Mount a before/after line-diff panel immediately after `anchor`
 * (typically the toolbar). Replaces any prior panel under the same parent.
 */
export function mountDiffPreviewPanel(
  anchor: HTMLElement,
  options: DiffPreviewMountOptions,
): HTMLElement {
  const parent = anchor.parentElement;
  if (!parent) {
    throw new Error("Diff preview anchor has no parent element");
  }

  dismissDiffPreviewPanel(parent);

  const doc = anchor.ownerDocument;
  const lines = diffLines(options.before, options.after);
  const summary = summarizeDiff(lines);
  const sideRows = toSideBySide(lines);
  let layout: DiffPreviewLayout = options.layout ?? DEFAULT_DIFF_LAYOUT;

  const panel = doc.createElement("div");
  panel.className = PREVIEW_PANEL_CLASS;
  panel.setAttribute("role", "region");
  panel.setAttribute("aria-label", "Format Markdown preview");
  panel.setAttribute("data-diff-layout", layout);

  const header = doc.createElement("div");
  header.className = "md-formatter-preview__header";

  const title = doc.createElement("span");
  title.className = "md-formatter-preview__title";
  title.textContent = summary.changed
    ? `Preview (+${summary.added} / −${summary.removed})`
    : "Preview (no changes)";

  const layoutGroup = doc.createElement("div");
  layoutGroup.className = "md-formatter-preview__layout";
  layoutGroup.setAttribute("role", "group");
  layoutGroup.setAttribute("aria-label", "Diff layout");

  const unifiedBtn = doc.createElement("button");
  unifiedBtn.type = "button";
  unifiedBtn.className = `${PREVIEW_LAYOUT_UNIFIED_CLASS} md-formatter-preview__layout-btn`;
  unifiedBtn.textContent = "Unified";
  unifiedBtn.setAttribute("aria-label", "Show unified diff");

  const columnsBtn = doc.createElement("button");
  columnsBtn.type = "button";
  columnsBtn.className = `${PREVIEW_LAYOUT_COLUMNS_CLASS} md-formatter-preview__layout-btn`;
  columnsBtn.textContent = "Columns";
  columnsBtn.setAttribute("aria-label", "Show side-by-side columns diff");

  setLayoutToggleState(unifiedBtn, columnsBtn, layout);

  const actions = doc.createElement("div");
  actions.className = "md-formatter-preview__actions";

  const dismissBtn = doc.createElement("button");
  dismissBtn.type = "button";
  dismissBtn.className = PREVIEW_DISMISS_CLASS;
  dismissBtn.textContent = "Dismiss";
  dismissBtn.setAttribute("aria-label", "Dismiss format preview");
  dismissBtn.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    panel.remove();
    void options.onDismiss?.();
  });

  const applyBtn = doc.createElement("button");
  applyBtn.type = "button";
  applyBtn.className = PREVIEW_APPLY_CLASS;
  applyBtn.textContent = "Apply";
  applyBtn.setAttribute("aria-label", "Apply formatted Markdown");
  applyBtn.disabled = !summary.changed;
  applyBtn.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    // Real browsers skip click on disabled buttons; linkedom may still fire.
    if (applyBtn.disabled || !summary.changed) return;
    panel.remove();
    void options.onApply(options.after);
  });

  let body =
    layout === "columns" ? renderColumns(doc, sideRows) : renderUnified(doc, lines);

  const swapBody = (next: DiffPreviewLayout): void => {
    if (next === layout) return;
    layout = next;
    panel.setAttribute("data-diff-layout", layout);
    setLayoutToggleState(unifiedBtn, columnsBtn, layout);
    const nextBody =
      layout === "columns" ? renderColumns(doc, sideRows) : renderUnified(doc, lines);
    body.replaceWith(nextBody);
    body = nextBody;
    void options.onLayoutChange?.(layout);
  };

  unifiedBtn.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    swapBody("unified");
  });
  columnsBtn.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    swapBody("columns");
  });

  layoutGroup.appendChild(unifiedBtn);
  layoutGroup.appendChild(columnsBtn);
  actions.appendChild(layoutGroup);
  actions.appendChild(dismissBtn);
  actions.appendChild(applyBtn);
  header.appendChild(title);
  header.appendChild(actions);
  panel.appendChild(header);
  panel.appendChild(body);

  // Prefer inserting after the toolbar (anchor), before the editor surface.
  if (anchor.nextSibling) {
    parent.insertBefore(panel, anchor.nextSibling);
  } else {
    parent.appendChild(panel);
  }

  return panel;
}

export function findDiffPreviewPanel(
  root: ParentNode = document,
): HTMLElement | null {
  const el = root.querySelector(`.${PREVIEW_PANEL_CLASS}`);
  return el instanceof HTMLElement ? el : null;
}
