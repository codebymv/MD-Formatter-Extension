import { FormatJobRegistry, isAbortError } from "./formatJobs";
import { formatPrDescription } from "../formatter/formatPrDescription";
import { FormatterError } from "../formatter/types";
import {
  CancelFormatPrDescriptionResponse,
  FORMAT_PR_PROGRESS,
  FormatPrDescriptionResponse,
  isCancelFormatPrDescriptionRequest,
  isFormatPrDescriptionRequest,
} from "../messaging/protocol";
import { loadActiveFormatGuide } from "../storage/profiles";
import { loadSettings } from "../storage/settings";

const formatJobs = new FormatJobRegistry();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (isCancelFormatPrDescriptionRequest(message)) {
    const cancelled = formatJobs.cancel(message.requestId);
    const response: CancelFormatPrDescriptionResponse = { ok: true, cancelled };
    sendResponse(response);
    return false;
  }

  if (!isFormatPrDescriptionRequest(message)) {
    return false;
  }

  void (async () => {
    const response = await handleFormat(
      message.input,
      message.requestId,
      sender.tab?.id,
    );
    sendResponse(response);
  })();

  // Keep the message channel open for the async response.
  return true;
});

async function handleFormat(
  input: string,
  requestId: string,
  tabId: number | undefined,
): Promise<FormatPrDescriptionResponse> {
  const signal = formatJobs.start(requestId);
  try {
    const [{ guide }, settings] = await Promise.all([
      loadActiveFormatGuide(),
      loadSettings(),
    ]);
    const markdown = await formatPrDescription(input, guide, settings, {
      signal,
      onChunk: (accumulated) => {
        if (tabId == null || signal.aborted) return;
        void chrome.tabs.sendMessage(tabId, {
          type: FORMAT_PR_PROGRESS,
          requestId,
          accumulatedChars: accumulated.length,
        });
      },
    });
    return { ok: true, markdown };
  } catch (err) {
    if (isAbortError(err)) {
      return { ok: false, cancelled: true };
    }
    const error =
      err instanceof FormatterError
        ? err.message
        : "Something went wrong while formatting. Please try again.";
    return { ok: false, error };
  } finally {
    formatJobs.finish(requestId);
  }
}
