import {
  ensureFormatControl,
  hideFormatCancelButton,
  PrBodyTarget,
  readPrDescription,
  setToolbarSelection,
  showFormatCancelButton,
  TOOLBAR_CLASS,
  writePrDescription,
} from "./prEditor";
import { createFormatRequestId, formatStreamProgressLabel } from "./formatProgress";
import {
  dismissDiffPreviewPanel,
  mountDiffPreviewPanel,
} from "./diffPreviewPanel";
import {
  CANCEL_FORMAT_PR_DESCRIPTION,
  FORMAT_PR_DESCRIPTION,
  FormatPrDescriptionResponse,
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

/** Correlates progress events with the Format currently driving the toolbar. */
let activeRequestId: string | null = null;
let activeFormatButton: HTMLButtonElement | null = null;

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

async function requestCancelFormat(requestId: string): Promise<void> {
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

if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message) => {
    if (!isFormatPrProgressMessage(message)) return;
    if (!activeRequestId || message.requestId !== activeRequestId) return;
    if (!activeFormatButton) return;
    activeFormatButton.textContent = formatStreamProgressLabel(message.accumulatedChars);
    activeFormatButton.title = `${message.accumulatedChars} characters streamed`;
  });
}

async function onFormat(
  target: PrBodyTarget,
  button: HTMLButtonElement,
): Promise<void> {
  const raw = readPrDescription(target);
  if (!raw.trim()) {
    button.title = "PR description is empty";
    return;
  }

  const previous = button.textContent;
  const requestId = createFormatRequestId();
  activeRequestId = requestId;
  activeFormatButton = button;

  const toolbar = toolbarNear(target.element);
  button.disabled = true;
  button.textContent = formatStreamProgressLabel(0);
  button.title = "";

  if (toolbar) {
    showFormatCancelButton(toolbar, () => {
      button.textContent = "Cancelling…";
      button.title = "Cancelling format request";
      void requestCancelFormat(requestId);
    });
  }

  try {
    const response = await requestFormat(raw, requestId);
    if (isCancelledFormatResponse(response)) {
      button.title = "Formatting cancelled";
      button.textContent = "Cancelled";
      window.setTimeout(() => {
        button.textContent = previous;
        button.title = "";
      }, 1500);
      return;
    }

    if (!response?.ok) {
      button.title = response && "error" in response ? response.error : "Formatting failed";
      button.textContent = "Format failed";
      window.setTimeout(() => {
        button.textContent = previous;
      }, 2000);
      return;
    }

    if (!toolbar) {
      // Fallback: apply immediately if the toolbar mount point disappeared.
      writePrDescription(target, response.markdown);
      button.textContent = "Formatted";
      window.setTimeout(() => {
        button.textContent = previous;
      }, 1500);
      return;
    }

    if (!markdownChanged(raw, response.markdown)) {
      dismissDiffPreviewPanel(toolbar.parentElement ?? document);
      button.title = "Already matches the formatted result";
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
    button.textContent = "Preview ready";
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Could not reach the MD Formatter extension.";
    button.title = message;
    button.textContent = "Format failed";
    window.setTimeout(() => {
      button.textContent = previous;
    }, 2000);
  } finally {
    if (activeRequestId === requestId) {
      activeRequestId = null;
      activeFormatButton = null;
    }
    hideFormatCancelButton(toolbar);
    button.disabled = false;
  }
}

async function onSelectionChange(selection: FormatSelection): Promise<void> {
  await saveFormatSelection(selection);
}

async function mount(): Promise<void> {
  const { selection, profiles } = await loadActiveFormatGuide();
  ensureFormatControl(document, {
    onFormat,
    onSelectionChange,
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
          onFormat,
          onSelectionChange,
          selection,
          profiles,
        });
        setToolbarSelection(document, selection);
      })();
    }
  });
}
