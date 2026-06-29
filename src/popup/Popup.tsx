import { useEffect, useRef, useState } from "react";
import { formatPrDescription } from "../formatter/formatPrDescription";
import { DEFAULT_SETTINGS, FormatterError, Settings } from "../formatter/types";
import { loadSettings, saveSettings } from "../storage/settings";
import {
  CheckIcon,
  CloseIcon,
  CopyIcon,
  FormatIcon,
  GearIcon,
  InfoIcon,
} from "./Logo";

export function Popup() {
  const [raw, setRaw] = useState("");
  const [output, setOutput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSaved, setSettingsSaved] = useState(false);

  const copyTimer = useRef<number | undefined>(undefined);
  const savedTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    loadSettings().then(setSettings);
    return () => {
      window.clearTimeout(copyTimer.current);
      window.clearTimeout(savedTimer.current);
    };
  }, []);

  async function handleFormat() {
    setError(null);
    setCopied(false);
    if (!raw.trim()) {
      setError("Paste a PR description first — the input is empty.");
      return;
    }
    setLoading(true);
    try {
      const result = await formatPrDescription(raw, "standard", settings);
      setOutput(result);
    } catch (err) {
      const message =
        err instanceof FormatterError
          ? err.message
          : "Something went wrong while formatting. Please try again.";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  async function handleCopy() {
    if (!output) return;
    try {
      await navigator.clipboard.writeText(output);
      setCopied(true);
      window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("Could not access the clipboard. Select the text and copy manually.");
    }
  }

  async function handleSaveSettings() {
    await saveSettings(settings);
    const reloaded = await loadSettings();
    setSettings(reloaded);
    setSettingsSaved(true);
    window.clearTimeout(savedTimer.current);
    savedTimer.current = window.setTimeout(() => setSettingsSaved(false), 1500);
  }

  return (
    <div className="app">
      <header className="brand">
        <div className="brand__identity">
          <img className="brand__mark" src="/logo-icon.png" alt="" />
          <img className="brand__wordmark" src="/logo-text.png" alt="MD Formatter" />
        </div>
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() => setSettingsOpen((v) => !v)}
          aria-expanded={settingsOpen}
          aria-label={settingsOpen ? "Close settings" : "Open settings"}
        >
          {settingsOpen ? (
            <CloseIcon className="btn__icon" />
          ) : (
            <GearIcon className="btn__icon" />
          )}
          {settingsOpen ? "Close" : "Settings"}
        </button>
      </header>

      {settingsOpen && (
        <section className="settings" aria-label="Settings">
          <label className="field">
            <span className="field__label-row">
              <span className="field__label">API key (optional)</span>
              <InfoIcon
                className="field__info"
                title="Stored locally via chrome.storage.local. Never sent anywhere except your configured endpoint."
              />
            </span>
            <input
              type="password"
              className="field__input"
              placeholder="sk-..."
              autoComplete="off"
              value={settings.apiKey}
              onChange={(e) => setSettings({ ...settings, apiKey: e.target.value })}
            />
            <span className="field__hint">
              Leave blank to use the built-in offline formatter.
            </span>
          </label>
          <label className="field">
            <span className="field__label">Model</span>
            <input
              type="text"
              className="field__input"
              placeholder={DEFAULT_SETTINGS.model}
              value={settings.model}
              onChange={(e) => setSettings({ ...settings, model: e.target.value })}
            />
          </label>
          <label className="field">
            <span className="field__label">Base URL</span>
            <input
              type="text"
              className="field__input"
              placeholder={DEFAULT_SETTINGS.baseUrl}
              value={settings.baseUrl}
              onChange={(e) => setSettings({ ...settings, baseUrl: e.target.value })}
            />
          </label>
          <div className="settings__actions">
            <button type="button" className="btn btn--primary" onClick={handleSaveSettings}>
              {settingsSaved ? "Saved" : "Save settings"}
            </button>
          </div>
        </section>
      )}

      <label className="field">
        <span className="field__label">Raw PR description</span>
        <textarea
          className="textarea"
          placeholder="Paste your messy PR notes here…"
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          rows={7}
        />
      </label>

      <div className="actions">
        <button
          type="button"
          className="btn btn--primary btn--lg btn--block"
          onClick={handleFormat}
          disabled={loading}
        >
          {!loading && <FormatIcon className="btn__icon" />}
          {loading ? "Formatting…" : "Format Markdown"}
        </button>
      </div>

      {error && (
        <div className="alert" role="alert">
          {error}
        </div>
      )}

      <label className="field">
        <span className="field__label">Formatted Markdown</span>
        <textarea
          className="textarea textarea--output"
          placeholder="Formatted Markdown will appear here…"
          value={output}
          readOnly
          rows={10}
        />
      </label>

      <div className="actions">
        <button
          type="button"
          className={`btn btn--block${copied ? " btn--success" : ""}`}
          onClick={handleCopy}
          disabled={!output}
        >
          {copied ? <CheckIcon className="btn__icon" /> : <CopyIcon className="btn__icon" />}
          {copied ? "Copied" : "Copy Markdown"}
        </button>
      </div>
    </div>
  );
}
