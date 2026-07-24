/**
 * DOM helpers for finding a PR / MR description editor on GitHub, Forgejo
 * (Gitea), or GitLab and mounting a "Format Markdown" control next to it.
 *
 * Supports:
 * - Classic GitHub / Forgejo / GitLab `<textarea>` bodies
 * - GitHub ProseMirror-only PR bodies (no `#pull_request_body` textarea)
 * - GitLab TipTap / Content Editor MR descriptions (ProseMirror + hidden
 *   `merge_request[description]` backing field)
 *
 * Pure enough to unit-test with linkedom — no chrome.* calls here.
 */

import {
  isFormatPreset,
  selectionToValue,
  valueToSelection,
} from "../formatter/profile";
import {
  FormatPreset,
  FormatSelection,
  PRESETS,
  SavedProfile,
} from "../formatter/types";

export const MARKER_ATTR = "data-md-formatter-bound";
export const TOOLBAR_CLASS = "md-formatter-toolbar";
export const PRESET_SELECT_CLASS = "md-formatter-preset";
export const FORMAT_BTN_CLASS = "md-formatter-btn";
export const CANCEL_BTN_CLASS = "md-formatter-cancel";

const DEFAULT_TOOLBAR_SELECTION: FormatSelection = { kind: "preset", id: "standard" };

const PRESET_OPTIONS = (Object.keys(PRESETS) as FormatPreset[]).map((id) => ({
  id,
  label: PRESETS[id].label,
}));

/** Selectors tried in order for the classic PR / MR body textarea. */
export const PR_BODY_SELECTORS = [
  // GitHub (classic textarea Markdown editor)
  "textarea#pull_request_body",
  'textarea[name="pull_request[body]"]',
  // Forgejo / Gitea — scope to PR/compare forms so we don't hit issue #content
  'form[action*="/pulls"] textarea#content',
  'form[action*="/pulls"] textarea[name="content"]',
  'form[action*="/compare"] textarea#content',
  'form[action*="/compare"] textarea[name="content"]',
  // GitLab — create / edit merge request description (classic Write textarea)
  "textarea#merge_request_description",
  'textarea[name="merge_request[description]"]',
] as const;

/**
 * ProseMirror / TipTap surfaces scoped to PR / MR description contexts only —
 * never bare `.ProseMirror` (that would bind every review/comment box).
 */
export const PR_BODY_PROSEMIRROR_SELECTORS = [
  // GitHub
  'form#new_pull_request .ProseMirror[contenteditable="true"]',
  'form[id*="pull_request"] .ProseMirror[contenteditable="true"]',
  'form[action*="/pulls"] .ProseMirror[contenteditable="true"]',
  'form[action*="/compare"] .ProseMirror[contenteditable="true"]',
  '#pull_request_body .ProseMirror[contenteditable="true"]',
  '[data-testid="pull-request-body"] .ProseMirror[contenteditable="true"]',
  '[aria-label="Pull request body"].ProseMirror[contenteditable="true"]',
  '[aria-label="Pull request body"] .ProseMirror[contenteditable="true"]',
  '.js-pull-request-description-container .ProseMirror[contenteditable="true"]',
  // GitLab TipTap Content Editor — MR description wrappers only
  '.md-content-editor-wrapper [data-testid="content-editor"] .ProseMirror[contenteditable="true"]',
  '.js-markdown-editor [data-testid="content-editor"] .ProseMirror[contenteditable="true"]',
  '[data-testid="issuable-form-description-field"] .ProseMirror[contenteditable="true"]',
  '[data-testid="content_editor_editablebox"] .ProseMirror.rte-text-box[contenteditable="true"]',
] as const;

/** Hidden / non-id form fields that still carry PR / MR markdown for submit. */
export const PR_BODY_BACKING_SELECTORS = [
  'textarea[name="pull_request[body]"]:not(#pull_request_body)',
  'input[type="hidden"][name="pull_request[body]"]',
  'input[name="pull_request[body]"]',
  // GitLab TipTap Content Editor mirrors markdown on a hidden input
  'input[type="hidden"][name="merge_request[description]"]',
  'input[name="merge_request[description]"]',
] as const;

export type PrBodyTarget =
  | { kind: "textarea"; element: HTMLTextAreaElement }
  | {
      kind: "prosemirror";
      element: HTMLElement;
      backing: HTMLTextAreaElement | HTMLInputElement | null;
    };

export function findPrDescriptionField(
  root: ParentNode = document,
): HTMLTextAreaElement | null {
  for (const selector of PR_BODY_SELECTORS) {
    const el = root.querySelector(selector);
    if (el instanceof HTMLTextAreaElement && isUsableTextarea(el)) {
      return el;
    }
  }
  return null;
}

/**
 * Resolve the best PR description editing surface.
 * Visible classic textarea wins; a hidden backing field + ProseMirror mounts on
 * the ProseMirror surface (so the button is usable and the view stays in sync).
 */
export function findPrDescriptionTarget(
  root: ParentNode = document,
): PrBodyTarget | null {
  const textarea = findPrDescriptionField(root);
  const prose = findPrProseMirror(root);

  if (textarea && prose) {
    if (isEffectivelyHidden(textarea)) {
      return { kind: "prosemirror", element: prose, backing: textarea };
    }
    return { kind: "textarea", element: textarea };
  }
  if (textarea) {
    return { kind: "textarea", element: textarea };
  }
  if (prose) {
    return {
      kind: "prosemirror",
      element: prose,
      backing: findBackingFieldNear(prose),
    };
  }
  return null;
}

function isEffectivelyHidden(el: HTMLElement): boolean {
  if (el.hasAttribute("hidden")) return true;
  if (el.getAttribute("aria-hidden") === "true") return true;
  if (el instanceof HTMLInputElement && el.type === "hidden") return true;
  const cls = typeof el.className === "string" ? el.className : String(el.className ?? "");
  if (/\b(d-none|hidden|sr-only|visually-hidden)\b/.test(cls)) return true;
  const style = el.getAttribute("style") ?? "";
  if (/display\s*:\s*none/i.test(style)) return true;
  if (/visibility\s*:\s*hidden/i.test(style)) return true;
  return false;
}

function findPrProseMirror(root: ParentNode): HTMLElement | null {
  for (const selector of PR_BODY_PROSEMIRROR_SELECTORS) {
    // GitLab TipTap selectors can match note/comment editors too — scan all
    // candidates and only accept those near an MR description backing field.
    if (isGitLabContentEditorSelector(selector)) {
      const candidates = root.querySelectorAll(selector);
      for (const el of candidates) {
        if (
          el instanceof HTMLElement &&
          isUsableProseMirror(el) &&
          hasGitlabMrBackingNear(el)
        ) {
          return el;
        }
      }
      continue;
    }

    const el = root.querySelector(selector);
    if (el instanceof HTMLElement && isUsableProseMirror(el)) {
      return el;
    }
  }

  // Backing field first (tight wrapper scope), then nearest ProseMirror.
  for (const selector of PR_BODY_BACKING_SELECTORS) {
    const backing = root.querySelector(selector);
    if (
      !(backing instanceof HTMLTextAreaElement) &&
      !(backing instanceof HTMLInputElement)
    ) {
      continue;
    }
    const prose = findProseMirrorNearBacking(backing);
    if (prose) return prose;
  }

  return null;
}

function isGitLabContentEditorSelector(selector: string): boolean {
  return (
    selector.includes("content-editor") ||
    selector.includes("content_editor_editablebox") ||
    selector.includes("issuable-form-description-field")
  );
}

function hasGitlabMrBackingNear(el: HTMLElement): boolean {
  const scope =
    el.closest(".md-content-editor-wrapper") ??
    el.closest(".js-markdown-editor") ??
    el.closest(".js-editor") ??
    el.closest("form") ??
    el.parentElement;
  if (!scope) return false;
  return Boolean(
    scope.querySelector('input[name="merge_request[description]"]') ||
      scope.querySelector('textarea[name="merge_request[description]"]'),
  );
}

function findProseMirrorNearBacking(
  backing: HTMLTextAreaElement | HTMLInputElement,
): HTMLElement | null {
  const scopes: ParentNode[] = [];
  const tight =
    backing.closest(".md-content-editor-wrapper") ??
    backing.closest(".js-markdown-editor") ??
    backing.closest(".js-editor");
  if (tight) scopes.push(tight);
  const form = backing.closest("form");
  if (form && form !== tight) scopes.push(form);
  if (backing.parentElement) scopes.push(backing.parentElement);

  const probes = [
    '[data-testid="content-editor"] .ProseMirror[contenteditable="true"]',
    '[data-testid="content_editor_editablebox"] .ProseMirror[contenteditable="true"]',
    '.ProseMirror.rte-text-box[contenteditable="true"]',
    '.ProseMirror[contenteditable="true"]',
  ] as const;

  for (const scope of scopes) {
    for (const probe of probes) {
      const prose = scope.querySelector?.(probe);
      if (prose instanceof HTMLElement && isUsableProseMirror(prose)) {
        return prose;
      }
    }
  }
  return null;
}

function findBackingFieldNear(
  prose: HTMLElement,
): HTMLTextAreaElement | HTMLInputElement | null {
  const scope =
    prose.closest(".md-content-editor-wrapper") ??
    prose.closest(".js-markdown-editor") ??
    prose.closest(".js-editor") ??
    prose.closest("form") ??
    prose.parentElement?.parentElement;
  if (!scope) return null;
  for (const selector of PR_BODY_BACKING_SELECTORS) {
    const el = scope.querySelector(selector);
    if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
      return el;
    }
  }
  // Same-name classic field that lost its #pull_request_body id
  const named = scope.querySelector('textarea[name="pull_request[body]"]');
  if (named instanceof HTMLTextAreaElement && named !== prose) {
    return named;
  }
  const gitlabNamed = scope.querySelector(
    'textarea[name="merge_request[description]"]',
  );
  if (gitlabNamed instanceof HTMLTextAreaElement && gitlabNamed !== prose) {
    return gitlabNamed;
  }
  return null;
}

function isUsableTextarea(el: HTMLTextAreaElement): boolean {
  // Skip disabled / read-only clones. Hidden Write-tab textareas (display:none
  // while Preview is open) are still accepted so the button mounts once.
  return !el.disabled && !el.readOnly;
}

function isUsableProseMirror(el: HTMLElement): boolean {
  if (el.getAttribute("contenteditable") === "false") return false;
  if (el.getAttribute("aria-readonly") === "true") return false;
  return el.classList.contains("ProseMirror");
}

export function readPrDescription(target: PrBodyTarget): string {
  if (target.kind === "textarea") {
    return target.element.value;
  }
  const fromBacking = target.backing?.value;
  if (typeof fromBacking === "string" && fromBacking.length > 0) {
    return fromBacking;
  }
  // Source-mode ProseMirror keeps markdown as visible text lines.
  return proseMirrorToMarkdown(target.element);
}

export function writePrDescription(target: PrBodyTarget, markdown: string): void {
  if (target.kind === "textarea") {
    applyFormattedText(target.element, markdown);
    return;
  }
  applyFormattedProseMirror(target.element, markdown);
  if (target.backing) {
    setBackingValue(target.backing, markdown);
  }
}

function proseMirrorToMarkdown(editor: HTMLElement): string {
  // Prefer innerText when available (preserves visual line breaks).
  const text =
    typeof editor.innerText === "string" && editor.innerText.length > 0
      ? editor.innerText
      : (editor.textContent ?? "");
  return text
    .replace(/\u00a0/g, " ")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function setBackingValue(
  field: HTMLTextAreaElement | HTMLInputElement,
  markdown: string,
): void {
  field.focus();
  field.value = markdown;
  field.dispatchEvent(new Event("input", { bubbles: true }));
  field.dispatchEvent(new Event("change", { bubbles: true }));
}

/**
 * Replace ProseMirror contents in a way the editor (and tests) can observe.
 * Prefers execCommand('insertText') so GitHub's PM plugins see a real edit;
 * falls back to rebuilding plain <p> nodes under linkedom / locked documents.
 */
export function applyFormattedProseMirror(
  editor: HTMLElement,
  markdown: string,
): void {
  editor.focus();

  const doc = editor.ownerDocument;
  const selection = doc.getSelection?.() ?? null;
  if (selection && typeof doc.createRange === "function") {
    const range = doc.createRange();
    range.selectNodeContents(editor);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  let inserted = false;
  const exec = doc.execCommand?.bind(doc);
  if (typeof exec === "function") {
    try {
      inserted = exec("insertText", false, markdown);
    } catch {
      inserted = false;
    }
  }

  if (!inserted) {
    replaceProseMirrorPlain(editor, markdown);
    const InputEvt =
      typeof InputEvent !== "undefined"
        ? InputEvent
        : (Event as unknown as typeof InputEvent);
    editor.dispatchEvent(
      new InputEvt("input", {
        bubbles: true,
        inputType: "insertText",
        data: markdown,
      }),
    );
  }
}

function replaceProseMirrorPlain(editor: HTMLElement, markdown: string): void {
  const doc = editor.ownerDocument;
  while (editor.firstChild) {
    editor.removeChild(editor.firstChild);
  }
  const lines = markdown.split("\n");
  for (const line of lines) {
    const p = doc.createElement("p");
    // ProseMirror often uses a trailing break / nbsp for empty paragraphs.
    p.textContent = line.length > 0 ? line : "\u00a0";
    editor.appendChild(p);
  }
}

export interface FormatButtonHandlers {
  onFormat: (target: PrBodyTarget, button: HTMLButtonElement) => void | Promise<void>;
  /** Active formatting preset shown in the in-page picker (default: standard). */
  preset?: FormatPreset;
  /** Active selection (built-in or saved profile). Wins over `preset` when set. */
  selection?: FormatSelection;
  /** Saved profiles listed under a "Saved profiles" optgroup. */
  profiles?: Pick<SavedProfile, "id" | "name">[];
  /** Fired when the user picks a different preset in the toolbar. */
  onPresetChange?: (preset: FormatPreset) => void | Promise<void>;
  /** Fired for any selection change (preset or saved profile). */
  onSelectionChange?: (selection: FormatSelection) => void | Promise<void>;
}

function resolveToolbarSelection(handlers: FormatButtonHandlers): FormatSelection {
  if (handlers.selection) return handlers.selection;
  if (handlers.preset && isFormatPreset(handlers.preset)) {
    return { kind: "preset", id: handlers.preset };
  }
  return DEFAULT_TOOLBAR_SELECTION;
}

export function findToolbarPresetSelect(
  root: ParentNode = document,
): HTMLSelectElement | null {
  const el = root.querySelector(`select.${PRESET_SELECT_CLASS}`);
  return el instanceof HTMLSelectElement ? el : null;
}

/**
 * Read/write `<select>` value in a way that works in browsers and linkedom
 * (linkedom's HTMLSelectElement.value is often getter-only).
 */
function readSelectValue(select: HTMLSelectElement): string {
  // Prefer live selection (real browsers update this on user change).
  const live = select.selectedOptions?.[0]?.value;
  if (typeof live === "string" && live.length > 0) return live;
  try {
    const native = select.value;
    if (typeof native === "string" && native.length > 0) return native;
  } catch {
    // linkedom: ignore
  }
  const selected = select.querySelector("option[selected]") as HTMLOptionElement | null;
  if (selected) return selected.value;
  const first = select.querySelector("option") as HTMLOptionElement | null;
  return first?.value ?? "";
}

function writeSelectValue(select: HTMLSelectElement, value: string): void {
  const options = Array.from(select.querySelectorAll("option"));
  let matched = false;
  for (const option of options) {
    if (option.value === value) {
      option.setAttribute("selected", "");
      matched = true;
    } else {
      option.removeAttribute("selected");
    }
  }
  // Prefer native setter when available (real browsers).
  if (matched) {
    try {
      select.value = value;
    } catch {
      // linkedom: ignore read-only value
    }
  }
}

/** Sync the in-page picker to a built-in preset (e.g. popup changed it). */
export function setToolbarPreset(root: ParentNode, preset: FormatPreset): void {
  setToolbarSelection(root, { kind: "preset", id: preset });
}

/** Sync the in-page picker to a built-in or saved-profile selection. */
export function setToolbarSelection(root: ParentNode, selection: FormatSelection): void {
  const select = findToolbarPresetSelect(root);
  if (!select) return;
  const value = selectionToValue(selection);
  if (readSelectValue(select) === value) return;
  // Only write when the option exists (profile may have been deleted).
  const hasOption = Array.from(select.querySelectorAll("option")).some(
    (opt) => opt.getAttribute("value") === value,
  );
  if (!hasOption) return;
  writeSelectValue(select, value);
}

function fillStyleSelect(
  select: HTMLSelectElement,
  selection: FormatSelection,
  profiles: Pick<SavedProfile, "id" | "name">[],
): void {
  select.replaceChildren();

  const builtins = document.createElement("optgroup");
  builtins.label = "Built-in presets";
  const selectedValue = selectionToValue(selection);

  for (const opt of PRESET_OPTIONS) {
    const option = document.createElement("option");
    option.value = opt.id;
    option.textContent = opt.label;
    if (opt.id === selectedValue) option.setAttribute("selected", "");
    builtins.appendChild(option);
  }
  select.appendChild(builtins);

  if (profiles.length > 0) {
    const saved = document.createElement("optgroup");
    saved.label = "Saved profiles";
    for (const profile of profiles) {
      const option = document.createElement("option");
      option.value = selectionToValue({ kind: "profile", id: profile.id });
      option.textContent = profile.name;
      if (option.value === selectedValue) option.setAttribute("selected", "");
      saved.appendChild(option);
    }
    select.appendChild(saved);
  }

  writeSelectValue(select, selectedValue);
}

function createPresetSelect(
  selection: FormatSelection,
  profiles: Pick<SavedProfile, "id" | "name">[],
  onPresetChange?: FormatButtonHandlers["onPresetChange"],
  onSelectionChange?: FormatButtonHandlers["onSelectionChange"],
): HTMLSelectElement {
  const select = document.createElement("select");
  select.className = PRESET_SELECT_CLASS;
  select.setAttribute("aria-label", "Formatting style");
  select.title = "Formatting style";

  fillStyleSelect(select, selection, profiles);

  select.addEventListener("change", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const nextValue = readSelectValue(select);
    const next = valueToSelection(nextValue);
    if (!next) return;
    // Keep selected attribute in sync for hosts / tests that don't update it.
    writeSelectValue(select, nextValue);
    void onSelectionChange?.(next);
    if (next.kind === "preset") void onPresetChange?.(next.id);
  });

  return select;
}

/**
 * Show (or reuse) a Cancel control on the toolbar for an in-flight Format.
 */
export function showFormatCancelButton(
  toolbar: HTMLElement,
  onCancel: () => void,
): HTMLButtonElement {
  let button = toolbar.querySelector<HTMLButtonElement>(`.${CANCEL_BTN_CLASS}`);
  if (!button) {
    button = document.createElement("button");
    button.type = "button";
    button.className = CANCEL_BTN_CLASS;
    button.textContent = "Cancel";
    button.setAttribute("aria-label", "Cancel formatting");
    toolbar.appendChild(button);
  }
  button.hidden = false;
  button.disabled = false;
  button.onclick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    onCancel();
  };
  return button;
}

/** Hide the Cancel control after Format completes / fails / is cancelled. */
export function hideFormatCancelButton(toolbar: HTMLElement | null | undefined): void {
  if (!toolbar) return;
  const button = toolbar.querySelector<HTMLButtonElement>(`.${CANCEL_BTN_CLASS}`);
  if (!button) return;
  button.hidden = true;
  button.disabled = true;
  button.onclick = null;
}

/**
 * Insert a Format Markdown toolbar (preset picker + button) above the editor
 * surface (once). Returns the button, or null if the field was already bound /
 * missing a mount point.
 */
export function injectFormatButton(
  surface: HTMLElement,
  handlers: FormatButtonHandlers,
  target: PrBodyTarget,
): HTMLButtonElement | null {
  if (surface.getAttribute(MARKER_ATTR) === "1") return null;
  surface.setAttribute(MARKER_ATTR, "1");

  const row = document.createElement("div");
  row.className = TOOLBAR_CLASS;

  const selection = resolveToolbarSelection(handlers);
  row.appendChild(
    createPresetSelect(
      selection,
      handlers.profiles ?? [],
      handlers.onPresetChange,
      handlers.onSelectionChange,
    ),
  );

  const button = document.createElement("button");
  button.type = "button";
  button.className = FORMAT_BTN_CLASS;
  button.textContent = "Format Markdown";
  button.setAttribute("aria-label", "Format current PR description with MD Formatter");

  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    void handlers.onFormat(target, button);
  });

  row.appendChild(button);

  // Present but hidden until a Format is in flight.
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = CANCEL_BTN_CLASS;
  cancel.textContent = "Cancel";
  cancel.setAttribute("aria-label", "Cancel formatting");
  cancel.hidden = true;
  cancel.disabled = true;
  row.appendChild(cancel);

  const mountParent = surface.parentElement;
  if (!mountParent) {
    surface.removeAttribute(MARKER_ATTR);
    return null;
  }
  mountParent.insertBefore(row, surface);
  return button;
}

/**
 * Replace the textarea value and fire the events hosts listen for so React /
 * Turbo / native forms pick up the change.
 */
export function applyFormattedText(
  textarea: HTMLTextAreaElement,
  markdown: string,
): void {
  textarea.focus();
  textarea.value = markdown;
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
  textarea.dispatchEvent(new Event("change", { bubbles: true }));
}

/**
 * Scan `root` for a PR body field and mount the toolbar if needed.
 * Safe to call repeatedly (SPA navigations / MutationObserver).
 * When already bound, refreshes the style picker to match selection / profiles.
 */
export function ensureFormatControl(
  root: ParentNode,
  handlers: FormatButtonHandlers,
): HTMLButtonElement | null {
  const target = findPrDescriptionTarget(root);
  if (!target) return null;

  const surface = target.element;
  if (surface.getAttribute(MARKER_ATTR) === "1") {
    const toolbar = surface.parentElement?.querySelector(`.${TOOLBAR_CLASS}`);
    const select = toolbar ? findToolbarPresetSelect(toolbar) : null;
    if (select) {
      fillStyleSelect(
        select,
        resolveToolbarSelection(handlers),
        handlers.profiles ?? [],
      );
    }
    return (
      toolbar?.querySelector<HTMLButtonElement>(`.${FORMAT_BTN_CLASS}`) ??
      surface.parentElement?.querySelector<HTMLButtonElement>(`.${FORMAT_BTN_CLASS}`) ??
      null
    );
  }
  return injectFormatButton(surface, handlers, target);
}
