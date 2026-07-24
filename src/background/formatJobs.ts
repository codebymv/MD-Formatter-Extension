/**
 * In-flight Format jobs keyed by requestId.
 * Pure enough for unit tests — no chrome.* APIs.
 */

export class FormatJobRegistry {
  private readonly jobs = new Map<string, AbortController>();

  /** Start (or replace) a job; returns its AbortSignal. */
  start(requestId: string): AbortSignal {
    const existing = this.jobs.get(requestId);
    if (existing) {
      existing.abort();
      this.jobs.delete(requestId);
    }
    const controller = new AbortController();
    this.jobs.set(requestId, controller);
    return controller.signal;
  }

  /** Abort a job if present. Returns true when a live job was cancelled. */
  cancel(requestId: string): boolean {
    const controller = this.jobs.get(requestId);
    if (!controller) return false;
    if (!controller.signal.aborted) {
      controller.abort();
    }
    this.jobs.delete(requestId);
    return true;
  }

  /** Drop a finished job without aborting (no-op if already cancelled). */
  finish(requestId: string): void {
    this.jobs.delete(requestId);
  }

  has(requestId: string): boolean {
    return this.jobs.has(requestId);
  }

  get size(): number {
    return this.jobs.size;
  }
}

export function isAbortError(err: unknown): boolean {
  return (
    (err instanceof DOMException && err.name === "AbortError") ||
    (err instanceof Error && err.name === "AbortError")
  );
}
