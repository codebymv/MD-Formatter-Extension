import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseHTML } from "linkedom";
import {
  CANCEL_BTN_CLASS,
  MARKER_ATTR,
  PRESET_SELECT_CLASS,
  TOOLBAR_CLASS,
  applyFormattedText,
  ensureFormatControl,
  findPrDescriptionField,
  findPrDescriptionTarget,
  findToolbarPresetSelect,
  hideFormatCancelButton,
  injectFormatButton,
  readPrDescription,
  setToolbarPreset,
  showFormatCancelButton,
  writePrDescription,
} from "../src/content/prEditor";
import { PRESETS } from "../src/formatter/types";

function load(html: string) {
  const { window, document } = parseHTML(`<!doctype html><html><body>${html}</body></html>`);
  // linkedom needs these globals for instanceof checks against elements from this document.
  (globalThis as unknown as { document: Document }).document = document as unknown as Document;
  (globalThis as unknown as { HTMLElement: typeof HTMLElement }).HTMLElement =
    window.HTMLElement as unknown as typeof HTMLElement;
  (globalThis as unknown as { HTMLTextAreaElement: typeof HTMLTextAreaElement }).HTMLTextAreaElement =
    window.HTMLTextAreaElement as unknown as typeof HTMLTextAreaElement;
  (globalThis as unknown as { HTMLInputElement: typeof HTMLInputElement }).HTMLInputElement =
    window.HTMLInputElement as unknown as typeof HTMLInputElement;
  (globalThis as unknown as { HTMLButtonElement: typeof HTMLButtonElement }).HTMLButtonElement =
    window.HTMLButtonElement as unknown as typeof HTMLButtonElement;
  (globalThis as unknown as { HTMLSelectElement: typeof HTMLSelectElement }).HTMLSelectElement =
    window.HTMLSelectElement as unknown as typeof HTMLSelectElement;
  (globalThis as unknown as { Event: typeof Event }).Event = window.Event as unknown as typeof Event;
  return { window, document };
}

describe("findPrDescriptionField", () => {
  it("finds GitHub pull_request_body textarea", () => {
    const { document } = load(`
      <form>
        <textarea id="pull_request_body" name="pull_request[body]">messy notes</textarea>
      </form>
    `);
    const field = findPrDescriptionField(document);
    assert.ok(field);
    assert.equal(field?.id, "pull_request_body");
    assert.equal(field?.value, "messy notes");
  });

  it("finds Forgejo /pulls form content textarea", () => {
    const { document } = load(`
      <form action="/acme/widgets/pulls">
        <textarea id="content" name="content">forgejo draft</textarea>
      </form>
    `);
    const field = findPrDescriptionField(document);
    assert.ok(field);
    assert.equal(field?.id, "content");
    assert.equal(field?.value, "forgejo draft");
  });

  it("finds GitLab create MR description textarea", () => {
    const { document } = load(`
      <form action="/acme/widgets/-/merge_requests">
        <textarea id="merge_request_description" name="merge_request[description]">gitlab create draft</textarea>
      </form>
    `);
    const field = findPrDescriptionField(document);
    assert.ok(field);
    assert.equal(field?.id, "merge_request_description");
    assert.equal(field?.value, "gitlab create draft");
  });

  it("finds GitLab edit MR description by name when id differs", () => {
    const { document } = load(`
      <form action="/acme/widgets/-/merge_requests/42">
        <textarea name="merge_request[description]" data-testid="issuable-form-description-field">gitlab edit draft</textarea>
      </form>
    `);
    const field = findPrDescriptionField(document);
    assert.ok(field);
    assert.equal(field?.name, "merge_request[description]");
    assert.equal(field?.value, "gitlab edit draft");
  });

  it("ignores GitLab issue description textarea", () => {
    const { document } = load(`
      <form action="/acme/widgets/-/issues">
        <textarea id="issue_description" name="issue[description]">issue body</textarea>
      </form>
    `);
    assert.equal(findPrDescriptionField(document), null);
  });

  it("returns null when no PR body field exists", () => {
    const { document } = load(`<textarea id="comment_field">issue comment</textarea>`);
    assert.equal(findPrDescriptionField(document), null);
  });
});

describe("findPrDescriptionTarget — ProseMirror PR body", () => {
  it("finds ProseMirror inside form#new_pull_request when no classic textarea", () => {
    const { document } = load(`
      <form id="new_pull_request" action="/acme/widgets/compare/main...feature">
        <div class="CommentBox">
          <div class="ProseMirror" contenteditable="true" role="textbox">
            <p>messy pm notes</p>
          </div>
        </div>
      </form>
    `);
    const target = findPrDescriptionTarget(document);
    assert.ok(target);
    assert.equal(target?.kind, "prosemirror");
    assert.equal(readPrDescription(target!), "messy pm notes");
  });

  it("prefers classic textarea over ProseMirror when both exist", () => {
    const { document } = load(`
      <form id="new_pull_request">
        <textarea id="pull_request_body" name="pull_request[body]">classic wins</textarea>
        <div class="ProseMirror" contenteditable="true"><p>ignored</p></div>
      </form>
    `);
    const target = findPrDescriptionTarget(document);
    assert.equal(target?.kind, "textarea");
    assert.equal(readPrDescription(target!), "classic wins");
  });

  it("uses hidden backing field via nearest ProseMirror", () => {
    const { document } = load(`
      <form action="/acme/widgets/pulls">
        <textarea name="pull_request[body]" hidden>backed markdown</textarea>
        <div class="wrap">
          <div class="ProseMirror" contenteditable="true" aria-label="Pull request body">
            <p>stale view</p>
          </div>
        </div>
      </form>
    `);
    const target = findPrDescriptionTarget(document);
    assert.ok(target);
    assert.equal(target?.kind, "prosemirror");
    // Backing field is the source of truth for submitted markdown.
    assert.equal(readPrDescription(target!), "backed markdown");
  });

  it("ignores review-comment ProseMirror outside PR description scopes", () => {
    const { document } = load(`
      <div class="review-comment">
        <div class="ProseMirror" contenteditable="true"><p>inline review</p></div>
      </div>
    `);
    assert.equal(findPrDescriptionTarget(document), null);
  });

  it("read/write ProseMirror surface and syncs backing field", () => {
    const { document } = load(`
      <form id="new_pull_request">
        <input type="hidden" name="pull_request[body]" value="old" />
        <div class="ProseMirror" contenteditable="true"><p>old</p></div>
      </form>
    `);
    const target = findPrDescriptionTarget(document);
    assert.ok(target);
    assert.equal(target?.kind, "prosemirror");

    writePrDescription(target!, "## Summary\n\nclean");
    assert.equal(readPrDescription(target!), "## Summary\n\nclean");

    const backing = document.querySelector('input[name="pull_request[body]"]') as HTMLInputElement;
    assert.equal(backing.value, "## Summary\n\nclean");

    const prose = document.querySelector(".ProseMirror") as HTMLElement;
    assert.match(prose.textContent ?? "", /## Summary/);
    assert.match(prose.textContent ?? "", /clean/);
  });
});

describe("findPrDescriptionTarget — GitLab TipTap Content Editor", () => {
  const gitlabTipTapHtml = `
    <form action="/acme/widgets/-/merge_requests">
      <div class="js-markdown-editor js-editor md-area-wrapper">
        <div class="md-content-editor-wrapper">
          <div class="md-area" data-testid="content-editor-container">
            <div data-testid="content-editor">
              <div data-testid="content_editor_editablebox" class="md">
                <div
                  class="ProseMirror rte-text-box"
                  contenteditable="true"
                  aria-label="Description"
                  role="textbox"
                >
                  <p>stale rich view</p>
                </div>
              </div>
            </div>
          </div>
          <input
            type="hidden"
            id="merge_request_description"
            name="merge_request[description]"
            data-testid="issuable-form-description-field"
            value="backed gitlab markdown"
          />
        </div>
      </div>
    </form>
  `;

  it("finds TipTap ProseMirror via MR description hidden backing field", () => {
    const { document } = load(gitlabTipTapHtml);
    const target = findPrDescriptionTarget(document);
    assert.ok(target);
    assert.equal(target?.kind, "prosemirror");
    // Hidden input is source of truth while rich editor is active.
    assert.equal(readPrDescription(target!), "backed gitlab markdown");
    assert.ok(target && "backing" in target && target.backing);
    assert.equal(
      (target as { backing: HTMLInputElement }).backing?.name,
      "merge_request[description]",
    );
  });

  it("ignores note/comment TipTap editors without MR description backing", () => {
    const { document } = load(`
      <form action="/acme/widgets/-/merge_requests/42">
        <div class="js-markdown-editor note-form">
          <div class="md-content-editor-wrapper">
            <div data-testid="content-editor">
              <div data-testid="content_editor_editablebox">
                <div class="ProseMirror rte-text-box" contenteditable="true">
                  <p>a comment</p>
                </div>
              </div>
            </div>
            <input type="hidden" name="note[note]" value="a comment" />
          </div>
        </div>
      </form>
    `);
    assert.equal(findPrDescriptionTarget(document), null);
  });

  it("skips earlier comment TipTap and binds the MR description editor", () => {
    const { document } = load(`
      <div class="notes">
        <div class="js-markdown-editor">
          <div class="md-content-editor-wrapper">
            <div data-testid="content-editor">
              <div data-testid="content_editor_editablebox">
                <div class="ProseMirror rte-text-box" contenteditable="true">
                  <p>comment first</p>
                </div>
              </div>
            </div>
            <input type="hidden" name="note[note]" value="comment first" />
          </div>
        </div>
      </div>
      ${gitlabTipTapHtml}
    `);
    const target = findPrDescriptionTarget(document);
    assert.ok(target);
    assert.equal(target?.kind, "prosemirror");
    assert.equal(readPrDescription(target!), "backed gitlab markdown");
  });

  it("read/write TipTap surface and syncs GitLab hidden backing field", () => {
    const { document } = load(gitlabTipTapHtml);
    const target = findPrDescriptionTarget(document);
    assert.ok(target);
    assert.equal(target?.kind, "prosemirror");

    writePrDescription(target!, "## Summary\n\nclean gitlab");
    assert.equal(readPrDescription(target!), "## Summary\n\nclean gitlab");

    const backing = document.querySelector(
      'input[name="merge_request[description]"]',
    ) as HTMLInputElement;
    assert.equal(backing.value, "## Summary\n\nclean gitlab");

    const prose = document.querySelector(".ProseMirror") as HTMLElement;
    assert.match(prose.textContent ?? "", /## Summary/);
    assert.match(prose.textContent ?? "", /clean gitlab/);
  });

  it("prefers classic GitLab textarea when TipTap is not mounted", () => {
    const { document } = load(`
      <form action="/acme/widgets/-/merge_requests">
        <div class="js-markdown-editor">
          <textarea id="merge_request_description" name="merge_request[description]">classic</textarea>
        </div>
      </form>
    `);
    const target = findPrDescriptionTarget(document);
    assert.equal(target?.kind, "textarea");
    assert.equal(readPrDescription(target!), "classic");
  });
});

describe("showFormatCancelButton / hideFormatCancelButton", () => {
  it("reveals a Cancel control on the toolbar and hides it again", () => {
    const { document } = load(`
      <form>
        <div>
          <textarea id="pull_request_body" name="pull_request[body]">notes</textarea>
        </div>
      </form>
    `);
    const target = findPrDescriptionTarget(document);
    assert.ok(target);
    injectFormatButton(target!.element, { onFormat: () => undefined }, target!);
    const toolbar = document.querySelector(`.${TOOLBAR_CLASS}`) as HTMLElement;
    assert.ok(toolbar);

    const cancel = toolbar.querySelector(`.${CANCEL_BTN_CLASS}`) as HTMLButtonElement;
    assert.ok(cancel);
    assert.equal(cancel.hidden, true);

    let clicks = 0;
    const shown = showFormatCancelButton(toolbar, () => {
      clicks += 1;
    });
    assert.equal(shown.hidden, false);
    assert.equal(shown.disabled, false);
    shown.click();
    assert.equal(clicks, 1);

    hideFormatCancelButton(toolbar);
    assert.equal(shown.hidden, true);
    assert.equal(shown.disabled, true);
  });
});

describe("injectFormatButton / ensureFormatControl", () => {
  it("injects a Format Markdown button once above the textarea", () => {
    const { document } = load(`
      <div class="wrap">
        <textarea id="pull_request_body">body</textarea>
      </div>
    `);
    const target = findPrDescriptionTarget(document)!;
    let clicks = 0;
    const btn = injectFormatButton(target.element, {
      onFormat: () => {
        clicks += 1;
      },
    }, target);
    assert.ok(btn);
    assert.equal(btn?.textContent, "Format Markdown");
    assert.equal(target.element.getAttribute(MARKER_ATTR), "1");
    assert.equal(target.element.previousElementSibling, btn?.parentElement);

    const second = injectFormatButton(target.element, { onFormat: () => undefined }, target);
    assert.equal(second, null);

    btn?.click();
    assert.equal(clicks, 1);
  });

  it("mounts an in-page preset picker that reports changes", () => {
    const { document } = load(`
      <div class="wrap">
        <textarea id="pull_request_body">body</textarea>
      </div>
    `);
    const seen: string[] = [];
    const btn = ensureFormatControl(document, {
      onFormat: () => undefined,
      preset: "feature",
      onPresetChange: (preset) => {
        seen.push(preset);
      },
    });
    assert.ok(btn);

    const select = findToolbarPresetSelect(document);
    assert.ok(select);
    assert.equal(select?.className, PRESET_SELECT_CLASS);
    assert.equal(
      select?.querySelector("option[selected]")?.getAttribute("value"),
      "feature",
    );
    assert.equal(select?.getAttribute("aria-label"), "Formatting style");
    assert.equal(select?.querySelectorAll("option").length, Object.keys(PRESETS).length);

    // linkedom: select.value is often read-only — flip selected attrs then change.
    for (const option of Array.from(select!.querySelectorAll("option"))) {
      if (option.getAttribute("value") === "bugfix") {
        option.setAttribute("selected", "");
      } else {
        option.removeAttribute("selected");
      }
    }
    select!.dispatchEvent(new Event("change", { bubbles: true }));
    assert.deepEqual(seen, ["bugfix"]);

    setToolbarPreset(document, "release");
    assert.equal(
      findToolbarPresetSelect(document)?.querySelector("option[selected]")?.getAttribute("value"),
      "release",
    );
  });

  it("syncs an already-mounted preset picker on ensureFormatControl", () => {
    const { document } = load(`
      <div><textarea id="pull_request_body">x</textarea></div>
    `);
    ensureFormatControl(document, {
      onFormat: () => undefined,
      preset: "standard",
    });
    assert.equal(
      findToolbarPresetSelect(document)?.querySelector("option[selected]")?.getAttribute("value"),
      "standard",
    );

    ensureFormatControl(document, {
      onFormat: () => undefined,
      preset: "release",
    });
    assert.equal(
      findToolbarPresetSelect(document)?.querySelector("option[selected]")?.getAttribute("value"),
      "release",
    );
    assert.equal(document.querySelectorAll(".md-formatter-btn").length, 1);
    assert.equal(document.querySelectorAll(`select.${PRESET_SELECT_CLASS}`).length, 1);
  });

  it("lists saved profiles and reports profile selection changes", () => {
    const { document } = load(`
      <div><textarea id="pull_request_body">x</textarea></div>
    `);
    const seen: string[] = [];
    ensureFormatControl(document, {
      onFormat: () => undefined,
      selection: { kind: "profile", id: "p_ops" },
      profiles: [{ id: "p_ops", name: "Ops" }],
      onSelectionChange: (selection) => {
        seen.push(`${selection.kind}:${selection.id}`);
      },
    });

    const select = findToolbarPresetSelect(document);
    assert.ok(select);
    assert.equal(
      select?.querySelector("option[selected]")?.getAttribute("value"),
      "profile:p_ops",
    );
    assert.equal(select?.querySelectorAll("optgroup").length, 2);
    assert.equal(
      select?.querySelectorAll("option").length,
      Object.keys(PRESETS).length + 1,
    );

    for (const option of Array.from(select!.querySelectorAll("option"))) {
      if (option.getAttribute("value") === "feature") {
        option.setAttribute("selected", "");
      } else {
        option.removeAttribute("selected");
      }
    }
    select!.dispatchEvent(new Event("change", { bubbles: true }));
    assert.deepEqual(seen, ["preset:feature"]);
  });

  it("mounts on ProseMirror-only PR body", () => {
    const { document } = load(`
      <form id="new_pull_request">
        <div class="CommentBox">
          <div class="ProseMirror" contenteditable="true"><p>x</p></div>
        </div>
      </form>
    `);
    const btn = ensureFormatControl(document, { onFormat: () => undefined });
    assert.ok(btn);
    assert.equal(document.querySelectorAll(".md-formatter-btn").length, 1);
    assert.ok(findToolbarPresetSelect(document));
    const prose = document.querySelector(".ProseMirror");
    assert.equal(prose?.getAttribute(MARKER_ATTR), "1");
  });

  it("ensureFormatControl is idempotent across SPA remounts", () => {
    const { document } = load(`
      <div><textarea id="pull_request_body">x</textarea></div>
    `);
    const a = ensureFormatControl(document, { onFormat: () => undefined });
    const b = ensureFormatControl(document, { onFormat: () => undefined });
    assert.ok(a);
    assert.equal(a, b);
    assert.equal(document.querySelectorAll(".md-formatter-btn").length, 1);
  });

  it("mounts Format Markdown on GitLab MR description textarea", () => {
    const { document } = load(`
      <div class="md-area">
        <textarea id="merge_request_description" name="merge_request[description]">messy gitlab notes</textarea>
      </div>
    `);
    const btn = ensureFormatControl(document, { onFormat: () => undefined });
    assert.ok(btn);
    assert.equal(btn?.textContent, "Format Markdown");
    const field = document.querySelector("#merge_request_description");
    assert.equal(field?.getAttribute(MARKER_ATTR), "1");
    assert.equal(document.querySelectorAll(".md-formatter-btn").length, 1);
    assert.ok(findToolbarPresetSelect(document));
  });

  it("mounts Format Markdown + preset picker on GitLab TipTap MR body", () => {
    const { document } = load(`
      <form action="/acme/widgets/-/merge_requests">
        <div class="js-markdown-editor js-editor">
          <div class="md-content-editor-wrapper">
            <div data-testid="content-editor">
              <div data-testid="content_editor_editablebox">
                <div class="ProseMirror rte-text-box" contenteditable="true"><p>x</p></div>
              </div>
            </div>
            <input type="hidden" name="merge_request[description]" value="x" />
          </div>
        </div>
      </form>
    `);
    const btn = ensureFormatControl(document, {
      onFormat: () => undefined,
      preset: "bugfix",
    });
    assert.ok(btn);
    assert.equal(btn?.textContent, "Format Markdown");
    assert.equal(document.querySelectorAll(".md-formatter-btn").length, 1);
    const select = findToolbarPresetSelect(document);
    assert.ok(select);
    assert.equal(
      select?.querySelector("option[selected]")?.getAttribute("value"),
      "bugfix",
    );
    const prose = document.querySelector(".ProseMirror");
    assert.equal(prose?.getAttribute(MARKER_ATTR), "1");
  });
});

describe("applyFormattedText", () => {
  it("writes value and dispatches input + change", () => {
    const { document } = load(`<textarea id="pull_request_body">old</textarea>`);
    const field = findPrDescriptionField(document)!;
    const seen: string[] = [];
    field.addEventListener("input", () => seen.push("input"));
    field.addEventListener("change", () => seen.push("change"));
    applyFormattedText(field, "## Summary\n\nclean");
    assert.equal(field.value, "## Summary\n\nclean");
    assert.deepEqual(seen, ["input", "change"]);
  });
});
