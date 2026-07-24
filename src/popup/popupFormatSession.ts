/**
 * Single in-flight Format job for the popup UI.
 * Pure enough for unit tests — no chrome.* / React APIs.
 */
export class PopupFormatSession {
  private controller: AbortController | null = null;

  /** Start (or replace) the active job; returns its AbortSignal. */
  start(): AbortSignal {
    if (this.controller && !this.controller.signal.aborted) {
      this.controller.abort();
    }
    this.controller = new AbortController();
    return this.controller.signal;
  }

  /** Abort the active job if present. Returns true when a live job was cancelled. */
  cancel(): boolean {
    const controller = this.controller;
    if (!controller) return false;
    const wasLive = !controller.signal.aborted;
    if (wasLive) controller.abort();
    this.controller = null;
    return wasLive;
  }

  /** Drop a finished job without aborting (no-op if already cancelled). */
  finish(): void {
    this.controller = null;
  }

  get active(): boolean {
    return this.controller !== null && !this.controller.signal.aborted;
  }
}
