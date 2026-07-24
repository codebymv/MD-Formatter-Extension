import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseHTML } from "linkedom";
import {
  PREVIEW_APPLY_CLASS,
  PREVIEW_DISMISS_CLASS,
  PREVIEW_LAYOUT_COLUMNS_CLASS,
  PREVIEW_LAYOUT_UNIFIED_CLASS,
  PREVIEW_PANEL_CLASS,
  dismissDiffPreviewPanel,
  findDiffPreviewPanel,
  mountDiffPreviewPanel,
} from "../src/content/diffPreviewPanel";

function load(html: string) {
  const { window, document } = parseHTML(`<!doctype html><html><body>${html}</body></html>`);
  (globalThis as unknown as { document: Document }).document = document as unknown as Document;
  (globalThis as unknown as { HTMLElement: typeof HTMLElement }).HTMLElement =
    window.HTMLElement as unknown as typeof HTMLElement;
  (globalThis as unknown as { HTMLButtonElement: typeof HTMLButtonElement }).HTMLButtonElement =
    window.HTMLButtonElement as unknown as typeof HTMLButtonElement;
  (globalThis as unknown as { Event: typeof Event }).Event = window.Event as unknown as typeof Event;
  return { window, document };
}

describe("mountDiffPreviewPanel", () => {
  it("renders a line diff with Apply / Dismiss after the toolbar", () => {
    const { document } = load(`
      <div class="wrap">
        <div class="md-formatter-toolbar"><button type="button">Format Markdown</button></div>
        <textarea id="pull_request_body">Summary\nraw</textarea>
      </div>
    `);
    const toolbar = document.querySelector(".md-formatter-toolbar") as HTMLElement;
    let applied: string | null = null;
    let dismissed = 0;

    const panel = mountDiffPreviewPanel(toolbar, {
      before: "Summary\nraw",
      after: "## Summary\n\nclean",
      layout: "unified",
      onApply: (markdown) => {
        applied = markdown;
      },
      onDismiss: () => {
        dismissed += 1;
      },
    });

    assert.ok(panel.classList.contains(PREVIEW_PANEL_CLASS));
    assert.equal(toolbar.nextElementSibling, panel);
    assert.match(panel.textContent ?? "", /Preview \(\+/);
    assert.ok(panel.querySelector('[data-diff-kind="add"]'));
    assert.ok(panel.querySelector('[data-diff-kind="remove"]'));

    const apply = panel.querySelector(`.${PREVIEW_APPLY_CLASS}`) as HTMLButtonElement;
    const dismiss = panel.querySelector(`.${PREVIEW_DISMISS_CLASS}`) as HTMLButtonElement;
    assert.ok(apply);
    assert.equal(apply.disabled, false);
    assert.ok(dismiss);

    apply.click();
    assert.equal(applied, "## Summary\n\nclean");
    assert.equal(findDiffPreviewPanel(document), null);

    const panel2 = mountDiffPreviewPanel(toolbar, {
      before: "a",
      after: "b",
      onApply: () => undefined,
      onDismiss: () => {
        dismissed += 1;
      },
    });
    const dismiss2 = panel2.querySelector(`.${PREVIEW_DISMISS_CLASS}`) as HTMLButtonElement;
    dismiss2.click();
    assert.equal(dismissed, 1);
    assert.equal(findDiffPreviewPanel(document), null);
  });

  it("defaults to side-by-side columns and toggles to unified", () => {
    const { document } = load(`
      <div class="wrap">
        <div class="md-formatter-toolbar"></div>
      </div>
    `);
    const toolbar = document.querySelector(".md-formatter-toolbar") as HTMLElement;
    const layouts: string[] = [];
    const panel = mountDiffPreviewPanel(toolbar, {
      before: "old",
      after: "new",
      onApply: () => undefined,
      onLayoutChange: (layout) => {
        layouts.push(layout);
      },
    });

    assert.equal(panel.getAttribute("data-diff-layout"), "columns");
    assert.ok(panel.querySelector('[data-diff-layout="columns"]'));
    assert.ok(panel.querySelector('[data-diff-left="remove"]'));
    assert.ok(panel.querySelector('[data-diff-right="add"]'));
    assert.match(panel.textContent ?? "", /Before/);
    assert.match(panel.textContent ?? "", /After/);

    const unified = panel.querySelector(
      `.${PREVIEW_LAYOUT_UNIFIED_CLASS}`,
    ) as HTMLButtonElement;
    const columns = panel.querySelector(
      `.${PREVIEW_LAYOUT_COLUMNS_CLASS}`,
    ) as HTMLButtonElement;
    assert.equal(unified.getAttribute("aria-pressed"), "false");
    assert.equal(columns.getAttribute("aria-pressed"), "true");

    unified.click();
    assert.equal(panel.getAttribute("data-diff-layout"), "unified");
    assert.ok(panel.querySelector('[data-diff-layout="unified"]'));
    assert.ok(panel.querySelector('[data-diff-kind="remove"]'));
    assert.ok(panel.querySelector('[data-diff-kind="add"]'));
    assert.equal(unified.getAttribute("aria-pressed"), "true");
    assert.equal(columns.getAttribute("aria-pressed"), "false");

    columns.click();
    assert.equal(panel.getAttribute("data-diff-layout"), "columns");
    assert.ok(panel.querySelector('[data-diff-layout="columns"]'));
    assert.deepEqual(layouts, ["unified", "columns"]);
  });

  it("disables Apply when before and after are identical", () => {
    const { document } = load(`
      <div class="wrap">
        <div class="md-formatter-toolbar"></div>
        <textarea></textarea>
      </div>
    `);
    const toolbar = document.querySelector(".md-formatter-toolbar") as HTMLElement;
    let applied = 0;
    const panel = mountDiffPreviewPanel(toolbar, {
      before: "same\ntext",
      after: "same\ntext",
      onApply: () => {
        applied += 1;
      },
    });
    assert.match(panel.textContent ?? "", /no changes/i);
    const apply = panel.querySelector(`.${PREVIEW_APPLY_CLASS}`) as HTMLButtonElement;
    assert.equal(apply.disabled, true);
    apply.click();
    assert.equal(applied, 0);
  });

  it("replaces an existing panel under the same parent", () => {
    const { document } = load(`
      <div class="wrap">
        <div class="md-formatter-toolbar"></div>
      </div>
    `);
    const toolbar = document.querySelector(".md-formatter-toolbar") as HTMLElement;
    mountDiffPreviewPanel(toolbar, {
      before: "a",
      after: "b",
      onApply: () => undefined,
    });
    mountDiffPreviewPanel(toolbar, {
      before: "c",
      after: "d",
      onApply: () => undefined,
    });
    assert.equal(document.querySelectorAll(`.${PREVIEW_PANEL_CLASS}`).length, 1);
    assert.match(
      document.querySelector(`.${PREVIEW_PANEL_CLASS}`)?.textContent ?? "",
      /Preview/,
    );
  });

  it("dismissDiffPreviewPanel removes all panels", () => {
    const { document } = load(`
      <div class="wrap">
        <div class="md-formatter-toolbar"></div>
      </div>
    `);
    const toolbar = document.querySelector(".md-formatter-toolbar") as HTMLElement;
    mountDiffPreviewPanel(toolbar, {
      before: "a",
      after: "b",
      onApply: () => undefined,
    });
    assert.ok(findDiffPreviewPanel(document));
    dismissDiffPreviewPanel(document);
    assert.equal(findDiffPreviewPanel(document), null);
  });
});
