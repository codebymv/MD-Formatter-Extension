import { FormatJobRegistry, isAbortError } from "./formatJobs";
import { generateElevatorPitch } from "../formatter/elevatorPitch";
import { formatPrDescription } from "../formatter/formatPrDescription";
import { generateReleaseQuiz } from "../formatter/releaseQuiz";
import { FormatterError } from "../formatter/types";
import {
  CancelFormatPrDescriptionResponse,
  FORMAT_PR_PROGRESS,
  FormatPrDescriptionResponse,
  GeneratePrArtifactResponse,
  PrArtifactKind,
  isCancelFormatPrDescriptionRequest,
  isFormatPrDescriptionRequest,
  isGeneratePrArtifactRequest,
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

  if (isGeneratePrArtifactRequest(message)) {
    void (async () => {
      const response = await handleGenerate(
        message.kind,
        message.input,
        message.requestId,
        sender.tab?.id,
      );
      sendResponse(response);
    })();
    return true;
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

function publishProgress(
  tabId: number | undefined,
  requestId: string,
  signal: AbortSignal,
  accumulated: string,
): void {
  if (tabId == null || signal.aborted) return;
  void chrome.tabs.sendMessage(tabId, {
    type: FORMAT_PR_PROGRESS,
    requestId,
    accumulatedChars: accumulated.length,
  });
}

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
        publishProgress(tabId, requestId, signal, accumulated);
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

async function handleGenerate(
  kind: PrArtifactKind,
  input: string,
  requestId: string,
  tabId: number | undefined,
): Promise<GeneratePrArtifactResponse> {
  const signal = formatJobs.start(requestId);
  try {
    const settings = await loadSettings();
    const options = {
      signal,
      onChunk: (accumulated: string) => {
        publishProgress(tabId, requestId, signal, accumulated);
      },
    };
    const result =
      kind === "quiz"
        ? await generateReleaseQuiz(input, settings, options)
        : await generateElevatorPitch(input, settings, options);
    return { ok: true, markdown: result.markdown };
  } catch (err) {
    if (isAbortError(err)) {
      return { ok: false, cancelled: true };
    }
    const fallback =
      kind === "quiz"
        ? "Something went wrong while generating the quiz. Please try again."
        : "Something went wrong while generating the pitch. Please try again.";
    const error = err instanceof FormatterError ? err.message : fallback;
    return { ok: false, error };
  } finally {
    formatJobs.finish(requestId);
  }
}
