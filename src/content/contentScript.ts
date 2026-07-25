import {
  ensureFormatControl,
  hideFormatCancelButton,
  PrBodyTarget,
  readPrDescription,
  setToolbarActionsDisabled,
  setToolbarSelection,
  showFormatCancelButton,
  TOOLBAR_CLASS,
  writePrDescription,
} from "./prEditor";
import {
  createJobRequestId,
  InPageJobKind,
  streamProgressLabel,
} from "./formatProgress";
import {
  dismissDiffPreviewPanel,
  mountDiffPreviewPanel,
} from "./diffPreviewPanel";
import {
  CANCEL_FORMAT_PR_DESCRIPTION,
  FORMAT_PR_DESCRIPTION,
  GENERATE_PR_ARTIFACT,
  FormatPrDescriptionResponse,
  PrArtifactKind,
  isCancelledFormatResponse,
  isFormatPrProgressMessage,
} from "../messaging/protocol";
import { markdownChanged } from "../diff/lineDiff";
import { FormatSelection } from "../formatter/types";
import { loadDiffLayout, saveDiffLayout } from "../storage/diffLayout";
import {
  loadActiveFormatGuide,
  loadFormatSelection,
  loadProfiles,
  saveFormatSelection,
} from "../storage/profiles";

const IDLE_MS = 400;

/** Correlates progress events with the job currently driving the toolbar. */
let activeRequestId: string | null = null;
let activeJobButton: HTMLButtonElement | null = null;
let activeJobKind: InPageJobKind | null = null;

async function requestFormat(
  input: string,
  requestId: string,
): Promise<FormatPrDescriptionResponse> {
  return chrome.runtime.sendMessage({
    type: FORMAT_PR_DESCRIPTION,
    input,
    requestId,
  }) as Promise<FormatPrDescriptionResponse>;
}

async function requestGenerate(
  kind: PrArtifactKind,
  input: string,
  requestId: string,
): Promise<FormatPrDescriptionResponse> {
  return chrome.runtime.sendMessage({
    type: GENERATE_PR_ARTIFACT,
    kind,
    input,
    requestId,
  }) as Promise<FormatPrDescriptionResponse>;
}

async function requestCancelJob(requestId: string): Promise<void> {
  try {
    await chrome.runtime.sendMessage({
      type: CANCEL_FORMAT_PR_DESCRIPTION,
      requestId,
    });
  } catch {
    // Extension context may be gone; local UI still resets in finally.
  }
}

function toolbarNear(surface: HTMLElement): HTMLElement | null {
  const prev = surface.previousElementSibling;
  if (prev instanceof HTMLElement && prev.classList.contains(TOOLBAR_CLASS)) {
    return prev;
  }
  return surface.parentElement?.querySelector(`.${TOOLBAR_CLASS}`) ?? null;
}

function emptyInputTitle(kind: InPageJobKind): string {
  if (kind === "quiz") return "PR description is empty — paste notes before Quiz me";
  if (kind === "pitch") {
    return "PR description is empty — paste notes before Elevator pitch";
  }
  return "PR description is empty";
}

function failLabel(kind: InPageJobKind): string {
  if (kind === "quiz") return "Quiz failed";
  if (kind === "pitch") return "Pitch failed";
  return "Format failed";
}

function successTransientLabel(kind: InPageJobKind): string {
  if (kind === "quiz") return "Quiz ready";
  if (kind === "pitch") return "Pitch ready";
  return "Preview ready";
}

function cancellingTitle(kind: InPageJobKind): string {
  if (kind === "quiz") return "Cancelling quiz request";
  if (kind === "pitch") return "Cancelling elevator pitch request";
  return "Cancelling format request";
}

if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message) => {
    if (!isFormatPrProgressMessage(message)) return;
    if (!activeRequestId || message.requestId !== activeRequestId) return;
    if (!activeJobButton || !activeJobKind) return;
    activeJobButton.textContent = streamProgressLabel(
      activeJobKind,
      message.accumulatedChars,
    );
    activeJobButton.title = `${message.accumulatedChars} characters streamed`;
  });
}

async function runInPageJob(
  kind: InPageJobKind,
  target: PrBodyTarget,
  button: HTMLButtonElement,
): Promise<void> {
  const raw = readPrDescription(target);
  if (!raw.trim()) {
    button.title = emptyInputTitle(kind);
    return;
  }

  const previous = button.textContent;
  const requestId = createJobRequestId(kind);
  activeRequestId = requestId;
  activeJobButton = button;
  activeJobKind = kind;

  const toolbar = toolbarNear(target.element);
  setToolbarActionsDisabled(toolbar, true);
  button.textContent = streamProgressLabel(kind, 0);
  button.title = "";

  if (toolbar) {
    showFormatCancelButton(toolbar, () => {
      button.textContent = "Cancelling…";
      button.title = cancellingTitle(kind);
      void requestCancelJob(requestId);
    });
  }

  try {
    const response =
      kind === "format"
        ? await requestFormat(raw, requestId)
        : await requestGenerate(kind, raw, requestId);

    if (isCancelledFormatResponse(response)) {
      button.title =
        kind === "quiz"
          ? "Quiz cancelled"
          : kind === "pitch"
            ? "Elevator pitch cancelled"
            : "Formatting cancelled";
      button.textContent = "Cancelled";
      window.setTimeout(() => {
        button.textContent = previous;
        button.title = "";
      }, 1500);
      return;
    }

    if (!response?.ok) {
      button.title =
        response && "error" in response ? response.error : `${failLabel(kind)}`;
      button.textContent = failLabel(kind);
      window.setTimeout(() => {
        button.textContent = previous;
      }, 2000);
      return;
    }

    if (!toolbar) {
      // Fallback: apply immediately if the toolbar mount point disappeared.
      writePrDescription(target, response.markdown);
      button.textContent = kind === "format" ? "Formatted" : "Applied";
      window.setTimeout(() => {
        button.textContent = previous;
      }, 1500);
      return;
    }

    if (!markdownChanged(raw, response.markdown)) {
      dismissDiffPreviewPanel(toolbar.parentElement ?? document);
      button.title = "Already matches the generated result";
      button.textContent = "No changes";
      window.setTimeout(() => {
        button.textContent = previous;
        button.title = "";
      }, 1500);
      return;
    }

    const layout = await loadDiffLayout();
    mountDiffPreviewPanel(toolbar, {
      before: raw,
      after: response.markdown,
      layout,
      onLayoutChange: (next) => {
        void saveDiffLayout(next);
      },
      onApply: (markdown) => {
        writePrDescription(target, markdown);
        button.textContent = "Applied";
        window.setTimeout(() => {
          button.textContent = previous;
        }, 1500);
      },
      onDismiss: () => {
        button.textContent = previous;
      },
    });
    button.textContent = successTransientLabel(kind);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Could not reach the MD Formatter extension.";
    button.title = message;
    button.textContent = failLabel(kind);
    window.setTimeout(() => {
      button.textContent = previous;
    }, 2000);
  } finally {
    if (activeRequestId === requestId) {
      activeRequestId = null;
      activeJobButton = null;
      activeJobKind = null;
    }
    hideFormatCancelButton(toolbar);
    setToolbarActionsDisabled(toolbar, false);
  }
}

async function onFormat(
  target: PrBodyTarget,
  button: HTMLButtonElement,
): Promise<void> {
  await runInPageJob("format", target, button);
}

async function onQuiz(
  target: PrBodyTarget,
  button: HTMLButtonElement,
): Promise<void> {
  await runInPageJob("quiz", target, button);
}

async function onPitch(
  target: PrBodyTarget,
  button: HTMLButtonElement,
): Promise<void> {
  await runInPageJob("pitch", target, button);
}

async function onSelectionChange(selection: FormatSelection): Promise<void> {
  await saveFormatSelection(selection);
}

function toolbarHandlers() {
  return {
    onFormat,
    onQuiz,
    onPitch,
    onSelectionChange,
  };
}

async function mount(): Promise<void> {
  const { selection, profiles } = await loadActiveFormatGuide();
  ensureFormatControl(document, {
    ...toolbarHandlers(),
    selection,
    profiles,
  });
}

let debounceTimer: number | undefined;

function scheduleMount(): void {
  window.clearTimeout(debounceTimer);
  debounceTimer = window.setTimeout(() => {
    void mount();
  }, IDLE_MS);
}

void mount();

const observer = new MutationObserver(scheduleMount);
observer.observe(document.documentElement, { childList: true, subtree: true });

// Keep the in-page picker aligned when the popup (or another tab) changes style.
if (typeof chrome !== "undefined" && chrome.storage?.onChanged) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.formatSelection || changes.profiles || changes.preset) {
      void (async () => {
        const profiles = await loadProfiles();
        const selection = await loadFormatSelection(profiles);
        ensureFormatControl(document, {
          ...toolbarHandlers(),
          selection,
          profiles,
        });
        setToolbarSelection(document, selection);
      })();
    }
  });
}
