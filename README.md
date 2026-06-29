# MD Formatter

A Chrome extension (Manifest V3) that turns messy, unstructured pull-request
notes into clean, well-formatted Markdown you can paste straight into GitHub,
Forgejo, GitLab, or any PR tool.

Paste rough notes → **Format Markdown** → **Copy Markdown**.

It works **with no API key** (a built-in offline formatter), and gets much
smarter when you configure an OpenAI-compatible API key.

---

## Features

- Popup UI: raw input, preset selector, format button, output, copy button.
- Presets: **Standard / Feature / Bugfix / Release** — each guides the section
  structure without forcing irrelevant headings.
- Inline `code` for routes, file names, env vars, commands, config keys.
- Bullet lists per section; fenced code blocks and existing formatting preserved.
- Two backends behind one `formatPrDescription()` abstraction: an offline
  formatter (no key) and an OpenAI-compatible API call (when a key is set).
- Settings (API key / model / base URL) stored in `chrome.storage.local`.
- Friendly errors for empty input, missing/invalid key, network failures, and
  empty model responses.
- Minimal permissions: only `storage`.

---

## 1. Setup

Requires Node 18+ (tested on Node 22).

```bash
cd pr-markdown-formatter-extension
npm install
npm run build
```

This produces a loadable extension in `dist/`.

Useful scripts:

| Script | What it does |
| --- | --- |
| `npm run build` | Type-check + build into `dist/` (load this in Chrome) |
| `npm run dev` | Rebuild `dist/` on every change (reload the extension to see updates) |
| `npm run dev:preview` | Run the popup in a normal browser tab at `http://localhost:5174` (offline formatter only — `chrome.*` APIs are stubbed) |
| `npm run typecheck` | Type-check only |

---

## 2. Load the extension in Chrome

1. Run `npm run build`.
2. Open `chrome://extensions`.
3. Toggle **Developer mode** on (top-right).
4. Click **Load unpacked**.
5. Select the **`dist/`** folder (not the project root).
6. Pin the extension and click its icon to open the popup.

After code changes: `npm run build`, then click the **reload** icon on the
extension card.

---

## 3. Configure the API key (optional but recommended)

Without a key the extension uses the built-in offline heuristic formatter. To
enable the model-powered formatter:

1. Open the popup → **Settings**.
2. Fill in:
   - **API key** — e.g. an OpenAI key (`sk-...`).
   - **Model** — default `gpt-4.1-mini`; any OpenAI-compatible chat model works.
   - **Base URL** — default `https://api.openai.com/v1`. Point this at any
     OpenAI-compatible endpoint (Azure OpenAI, OpenRouter, a local server, etc.).
3. Click **Save settings**.

The key is stored locally via `chrome.storage.local`, is never logged, and is
only sent to the endpoint you configure, only when you click **Format Markdown**.

> The request goes to `{Base URL}/chat/completions`. Make sure the endpoint
> allows requests from a browser extension origin (CORS). OpenAI's API does.

---

## 4. Test with a sample PR description

Paste this into **Raw PR description**, choose **Feature PR**, click **Format
Markdown**:

```txt
Summary
Adds a new admin endpoint to report issues to Forgejo. Uses FORGEJO_PAT for auth.
Backend
new route POST /admin/forgejo/issues
protected by AuthGuard and AdminGuard
reads config key FORGEJO_BASE_URL
Frontend
added ems-report-issue-modal.tsx component
wired up a button
Test plan
ran npm run build
added ems-report-issue-modal.test.tsx
```

Expected output (offline formatter, no key):

```md
## Summary

Adds a new admin endpoint to report issues to Forgejo. Uses `FORGEJO_PAT` for auth.

## Backend

- new route `POST /admin/forgejo/issues`
- protected by AuthGuard and AdminGuard
- reads config key `FORGEJO_BASE_URL`

## Frontend

- added `ems-report-issue-modal.tsx` component
- wired up a button

## Test Plan

- ran `npm run build`
- added `ems-report-issue-modal.test.tsx`
```

Then click **Copy Markdown** — the button briefly reads **Copied**.

---

## Project structure

```txt
pr-markdown-formatter-extension/
  public/
    manifest.json        # MV3 manifest (copied verbatim into dist/)
    icons/               # generated PNG icons
  popup.html             # production popup entry (build input)
  index.html             # dev-only entry for npm run dev:preview
  src/
    popup/
      Popup.tsx          # the UI
      main.tsx           # React mount
      popup.css          # styles
    formatter/
      formatPrDescription.ts  # public API: local + OpenAI-compatible backends
      localFormatter.ts       # offline heuristic formatter (no network)
      prompt.ts               # system + preset-aware user prompt
      types.ts                # FormatPreset, Settings, presets, errors
    storage/
      settings.ts        # chrome.storage.local persistence (+ in-memory fallback)
  vite.config.ts
  tsconfig.json
  package.json
```

The formatter is intentionally decoupled from the popup so a future content
script can reuse `formatPrDescription()` directly.

---

## Known limitations

- **The offline formatter is conservative.** With no API key, formatting is heuristic: it
  restructures headings and bullets and backticks obvious tokens (routes, env
  vars, file names, commands), but it does **not** infer tables or backtick
  ambiguous identifiers like `AuthGuard`. Configure an API key for full
  formatting (tables, smarter inline code, prose cleanup).
- **No streaming.** The popup waits for the full model response.
- **CORS.** Some self-hosted OpenAI-compatible endpoints may reject extension
  requests unless they allow the extension origin.
- **No GitHub/Forgejo page injection yet** — paste → format → copy only (by
  design for the MVP).
- Bundled icons are simple generated placeholders.

---

## Roadmap (v2)

- Content script for GitHub / Forgejo / GitLab PR pages.
- **Format current PR description** button inside the PR editor.
- Diff preview (before/after).
- Saved formatting profiles.
- First-class local Ollama / OpenAI-compatible endpoint presets.
- "Elevator pitch" and "quiz me on this release" generation.
- Streaming responses.
```
