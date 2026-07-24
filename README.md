# MD Formatter

A Chrome extension (Manifest V3) that turns messy, unstructured pull-request
notes into clean, well-formatted Markdown you can paste straight into GitHub,
Forgejo, GitLab, or any PR tool.

Paste rough notes → **Format Markdown** → **Copy Markdown**.

It works **with no API key** (a built-in offline formatter), and gets much
smarter when you configure an OpenAI-compatible API key.

---

## Features

- Popup UI: raw input, style selector, **Format Markdown** / **Quiz me** /
  **Elevator pitch**, **line diff preview** (before/after, unified or
  **side-by-side columns**), output, copy button. **Quiz me** and **Elevator
  pitch** need a model endpoint (API key or Ollama); they stream a short
  fact-checked Q&A quiz or a 2–4 sentence spoken pitch from the raw
  description. While a model stream is in flight, **Cancel** aborts the
  request (same AbortSignal path as in-page Cancel). Columns / Unified
  preference is persisted in `chrome.storage.local` and shared with the
  in-page preview.
- Presets: **Standard / Feature / Bugfix / Release** — each guides the section
  structure without forcing irrelevant headings. The selected style is persisted
  and shared by the popup and the in-page toolbar.
- **Saved formatting profiles**: name a custom section order (cloned from a
  built-in), pick it from the popup or in-page toolbar, and delete it later.
  Profiles are stored in `chrome.storage.local` (max 20).
- Content script on GitHub, GitLab, and Forgejo-style `/pulls` / `/compare` URLs:
  injects an in-page toolbar (style picker + **Format Markdown**) above the
  PR / MR description editor (classic textarea, scoped GitHub ProseMirror, or
  GitLab TipTap / Content Editor). Format shows a before/after **diff preview**
  (default **Columns** side-by-side, toggle **Unified**; layout preference
  shared with the popup) with **Apply** / **Dismiss** before writing;
  formatting itself runs via the background service worker. While a model
  stream is in flight, the toolbar shows **char-count progress** and a
  **Cancel** control that aborts the request.
- Inline `code` for routes, file names, env vars, commands, config keys.
- Bullet lists per section; fenced code blocks and existing formatting preserved.
- Two backends behind one `formatPrDescription()` abstraction: an offline
  formatter (no key) and an OpenAI-compatible **streaming** chat completion
  (SSE) when a model endpoint is configured. The popup updates the output as
  tokens arrive and can **Cancel** mid-stream; the in-page toolbar shows
  stream progress and can cancel.
- Settings (API key / model / base URL / **endpoint preset**) stored in
  `chrome.storage.local` only — never committed or logged.
- **Endpoint presets**: **OpenAI**, **Ollama (local)**, **OpenRouter**, and
  **Custom** — one click fills a default model + OpenAI-compatible base URL.
  Ollama works without an API key (`http://localhost:11434/v1`).
- Friendly errors for empty input, missing/invalid key, network failures, and
  empty model responses.
- Minimal permissions: `storage`, PR-host matches, plus local Ollama
  (`localhost` / `127.0.0.1:11434`) for the local endpoint preset.

---

## 1. Setup

Requires Node 18+ (tested on Node 22). From this folder (`zEXTENSIONS/MD-formatter`):

```bash
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
| `npm test` | Unit tests (formatter, SSE stream / abort with mocked fetch, release quiz + elevator pitch parse/normalize + mocked SSE, format job + popup cancel sessions, in-page progress labels, endpoint presets, profiles, PR editor DOM helpers, line diff / preview panel) |

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

## 3. Configure a model endpoint (optional but recommended)

Without a keyed cloud endpoint (and without the Ollama preset) the extension
uses the built-in offline heuristic formatter. To enable the model-powered
formatter:

1. Open the popup → **Settings**.
2. Pick an **Endpoint** preset:
   - **OpenAI** — `gpt-4.1-mini` @ `https://api.openai.com/v1` (API key required).
   - **Ollama (local)** — `llama3.2` @ `http://localhost:11434/v1` (API key optional).
   - **OpenRouter** — routed model id @ `https://openrouter.ai/api/v1` (API key required).
   - **Custom** — keep your own model + base URL (any OpenAI-compatible server).
3. Adjust **Model** / **Base URL** if needed, then paste an **API key** when the
   preset requires one.
4. Click **Save settings**.

The key and endpoint choice are stored locally via `chrome.storage.local`, are
never logged, and are only sent to the endpoint you configure when you click
**Format Markdown**, **Quiz me**, or **Elevator pitch**.

> The request goes to `{Base URL}/chat/completions`. Make sure the endpoint
> allows requests from a browser extension origin (CORS). OpenAI’s API does;
> local Ollama is covered by the extension’s localhost host permissions.

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
MD-formatter/
  public/
    manifest.json        # MV3 manifest (copied verbatim into dist/)
    content.css          # styles for the in-page Format button
    icons/               # generated PNG icons
  popup.html             # production popup entry (build input)
  index.html             # dev-only entry for npm run dev:preview
  src/
    popup/
      Popup.tsx          # the UI (+ Cancel while Format / Quiz / Pitch streams)
      popupFormatSession.ts # single in-flight AbortController for popup jobs
      main.tsx           # React mount
      popup.css          # styles
    content/
      contentScript.ts   # GitHub / Forgejo / GitLab injection entry
      prEditor.ts        # find PR/MR body + mount toolbar (style + Format + Cancel)
      formatProgress.ts  # stream progress label + request id helpers
      diffPreviewPanel.ts # in-page before/after line-diff panel (Apply / Dismiss; Columns / Unified)
    diff/
      lineDiff.ts        # pure line LCS + side-by-side pairing (popup + content)
    background/
      serviceWorker.ts   # message handler → formatPrDescription (+ progress / cancel)
      formatJobs.ts      # in-flight AbortController registry (requestId)
    messaging/
      protocol.ts        # typed content ↔ background messages (format / progress / cancel)
    formatter/
      formatPrDescription.ts  # public API: local + OpenAI-compatible streaming backends
      releaseQuiz.ts          # "Quiz me" prompts, Q/A parse, model-backed generation
      elevatorPitch.ts        # "Elevator pitch" prompts, normalize, model-backed generation
      sseChatStream.ts        # OpenAI-compatible SSE parse + streamChatCompletion
      localFormatter.ts       # offline heuristic formatter (no network)
      prompt.ts               # system + style-aware user prompt
      profile.ts              # pure saved-profile helpers (create / resolve / upsert)
      endpointPresets.ts      # OpenAI / Ollama / OpenRouter / Custom endpoint catalog
      types.ts                # FormatPreset, SavedProfile, Settings, errors
    storage/
      settings.ts        # chrome.storage.local persistence (+ in-memory fallback)
      preset.ts          # persisted FormatPreset (legacy + built-in fallback)
      profiles.ts        # saved profiles + active FormatSelection
      diffLayout.ts      # persisted Columns / Unified preference (popup ↔ content)
  test/
  vite.config.ts
  tsconfig.json
  package.json
```

The formatter stays decoupled from the popup: the content script messages the
service worker, which calls `formatPrDescription()` with the active style
(built-in preset or saved profile guide).

---

## Known limitations

- **The offline formatter is conservative.** With no API key, formatting is heuristic: it
  restructures headings and bullets and backticks obvious tokens (routes, env
  vars, file names, commands), but it does **not** infer tables or backtick
  ambiguous identifiers like `AuthGuard`. Configure an API key for full
  formatting (tables, smarter inline code, prose cleanup).
- **In-page Format streams progress, not live editor text.** While formatting,
  the toolbar shows streamed character counts and **Cancel**; the PR body is
  unchanged until you **Apply** the diff preview. The popup paints tokens into
  its output textarea as they arrive and offers **Cancel** mid-stream.
- **CORS.** Some self-hosted OpenAI-compatible endpoints may reject extension
  requests unless they allow the extension origin.
- **GitHub rich editors.** The in-page button targets classic `textarea` PR
  bodies and scoped ProseMirror PR description surfaces (e.g.
  `form#new_pull_request .ProseMirror`). Generic review/comment ProseMirror
  boxes are intentionally ignored. Rich-text (non-source) mode may lose some
  markdown syntax on read when no backing form field is present.
- **Self-hosted Forgejo hosts** are covered when the URL matches
  `/*/pulls/*` or `/*/compare/*`; the script only mounts when a known PR body
  field is present.
- **GitLab MR pages** target classic `#merge_request_description` /
  `merge_request[description]` textareas and TipTap / Content Editor surfaces
  on create and edit forms (`gitlab.com` and `/*/merge_requests/*`). TipTap
  detection is scoped to an MR description backing field (hidden
  `merge_request[description]` input near `[data-testid="content-editor"]`);
  note/comment editors are ignored. Rich-text mode still prefers the backing
  field for markdown reads; writing uses the same ProseMirror insert path as
  GitHub (literal markdown may appear until GitLab re-serializes).
- Bundled icons are simple generated placeholders.

---

## Roadmap (v2)

- Live Ollama / cloud smoke for Format + Quiz me + Elevator pitch (manual).
