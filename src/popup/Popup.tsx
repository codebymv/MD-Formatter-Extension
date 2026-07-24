import { useEffect, useRef, useState } from "react";
import {
  DiffLine,
  SideBySideRow,
  diffLines,
  markdownChanged,
  summarizeDiff,
  toSideBySide,
} from "../diff/lineDiff";
import { formatPrDescription } from "../formatter/formatPrDescription";
import {
  createProfile,
  parseSectionList,
  resolveFormatGuide,
  selectionToValue,
  serializeSectionList,
  valueToSelection,
} from "../formatter/profile";
import { generateElevatorPitch } from "../formatter/elevatorPitch";
import { generateReleaseQuiz } from "../formatter/releaseQuiz";
import {
  ENDPOINT_PRESETS,
  EndpointPresetId,
  applyEndpointPreset,
  isEndpointPresetId,
  shouldUseApi,
} from "../formatter/endpointPresets";
import {
  DEFAULT_SETTINGS,
  FormatPreset,
  FormatSelection,
  FormatterError,
  PRESETS,
  SavedProfile,
  Settings,
} from "../formatter/types";
import {
  DEFAULT_DIFF_LAYOUT,
  DiffPreviewLayout,
  loadDiffLayout,
  saveDiffLayout,
} from "../storage/diffLayout";
import {
  deleteProfile,
  loadActiveFormatGuide,
  saveFormatSelection,
  saveProfile,
} from "../storage/profiles";
import { loadSettings, saveSettings } from "../storage/settings";
import {
  CheckIcon,
  CloseIcon,
  CopyIcon,
  FormatIcon,
  GearIcon,
  InfoIcon,
} from "./Logo";
import { PopupFormatSession } from "./popupFormatSession";

const PRESET_OPTIONS = (Object.keys(PRESETS) as FormatPreset[]).map((id) => ({
  id,
  label: PRESETS[id].label,
}));

const ENDPOINT_OPTIONS = (Object.keys(ENDPOINT_PRESETS) as EndpointPresetId[]).map((id) => ({
  id,
  label: ENDPOINT_PRESETS[id].label,
}));

function buildPopupDiff(
  raw: string,
  output: string,
): {
  lines: DiffLine[];
  columns: SideBySideRow[];
  summary: ReturnType<typeof summarizeDiff>;
  identical: boolean;
} | null {
  if (!output || !raw.trim()) return null;
  if (!markdownChanged(raw, output)) {
    return {
      lines: [],
      columns: [],
      summary: summarizeDiff([]),
      identical: true,
    };
  }
  const lines = diffLines(raw, output);
  return {
    lines,
    columns: toSideBySide(lines),
    summary: summarizeDiff(lines),
    identical: false,
  };
}

function basedOnForSelection(
  selection: FormatSelection,
  profiles: SavedProfile[],
): FormatPreset {
  if (selection.kind === "preset") return selection.id;
  const profile = profiles.find((p) => p.id === selection.id);
  return profile?.basedOn ?? "standard";
}

function isAbortError(err: unknown): boolean {
  return (
    (err instanceof DOMException && err.name === "AbortError") ||
    (err instanceof Error && err.name === "AbortError")
  );
}

export function Popup() {
  const [raw, setRaw] = useState("");
  const [output, setOutput] = useState("");
  const [selection, setSelection] = useState<FormatSelection>({
    kind: "preset",
    id: "standard",
  });
  const [profiles, setProfiles] = useState<SavedProfile[]>([]);
  const [loading, setLoading] = useState(false);
  const [jobKind, setJobKind] = useState<"format" | "quiz" | "pitch" | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSaved, setSettingsSaved] = useState(false);
  const [diffOpen, setDiffOpen] = useState(true);
  const [diffLayout, setDiffLayout] = useState<DiffPreviewLayout>(DEFAULT_DIFF_LAYOUT);

  const [saveOpen, setSaveOpen] = useState(false);
  const [profileName, setProfileName] = useState("");
  const [profileSectionsText, setProfileSectionsText] = useState("");
  const [profileNotice, setProfileNotice] = useState<string | null>(null);

  const copyTimer = useRef<number | undefined>(undefined);
  const savedTimer = useRef<number | undefined>(undefined);
  const noticeTimer = useRef<number | undefined>(undefined);
  const formatSession = useRef(new PopupFormatSession());

  const diff = buildPopupDiff(raw, output);
  const activeGuide = resolveFormatGuide(selection, profiles).guide;

  useEffect(() => {
    void loadSettings().then(setSettings);
    void loadDiffLayout().then(setDiffLayout);
    void loadActiveFormatGuide().then(({ selection: next, profiles: list }) => {
      setSelection(next);
      setProfiles(list);
    });
    return () => {
      window.clearTimeout(copyTimer.current);
      window.clearTimeout(savedTimer.current);
      window.clearTimeout(noticeTimer.current);
      formatSession.current.cancel();
    };
  }, []);

  async function handleDiffLayoutChange(next: DiffPreviewLayout) {
    setDiffLayout(next);
    await saveDiffLayout(next);
  }

  function flashNotice(message: string) {
    setProfileNotice(message);
    window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setProfileNotice(null), 1600);
  }

  async function handleSelectionChange(next: FormatSelection) {
    setSelection(next);
    await saveFormatSelection(next);
  }

  function openSaveForm() {
    const basedOn = basedOnForSelection(selection, profiles);
    const seedSections =
      selection.kind === "profile"
        ? profiles.find((p) => p.id === selection.id)?.sections ?? PRESETS[basedOn].sections
        : PRESETS[basedOn].sections;
    setProfileName("");
    setProfileSectionsText(serializeSectionList(seedSections));
    setSaveOpen(true);
  }

  async function handleSaveProfile() {
    const basedOn = basedOnForSelection(selection, profiles);
    const profile = createProfile({
      name: profileName,
      basedOn,
      sections: parseSectionList(profileSectionsText),
    });
    if (!profile) {
      setError("Enter a profile name and at least one section heading.");
      return;
    }
    setError(null);
    const nextProfiles = await saveProfile(profile);
    setProfiles(nextProfiles);
    const nextSelection: FormatSelection = { kind: "profile", id: profile.id };
    setSelection(nextSelection);
    await saveFormatSelection(nextSelection);
    setSaveOpen(false);
    flashNotice(`Saved “${profile.name}”`);
  }

  async function handleDeleteProfile() {
    if (selection.kind !== "profile") return;
    const doomed = profiles.find((p) => p.id === selection.id);
    const nextProfiles = await deleteProfile(selection.id);
    setProfiles(nextProfiles);
    const nextSelection: FormatSelection = { kind: "preset", id: "standard" };
    setSelection(nextSelection);
    flashNotice(doomed ? `Deleted “${doomed.name}”` : "Profile deleted");
  }

  async function handleFormat() {
    setError(null);
    setCopied(false);
    setCancelling(false);
    if (!raw.trim()) {
      setError("Paste a PR description first — the input is empty.");
      return;
    }
    const signal = formatSession.current.start();
    setJobKind("format");
    setLoading(true);
    setOutput("");
    try {
      const { guide } = resolveFormatGuide(selection, profiles);
      const result = await formatPrDescription(raw, guide, settings, {
        signal,
        onChunk: (accumulated) => setOutput(accumulated),
      });
      setOutput(result);
      setDiffOpen(true);
    } catch (err) {
      if (isAbortError(err)) return;
      const message =
        err instanceof FormatterError
          ? err.message
          : "Something went wrong while formatting. Please try again.";
      setError(message);
    } finally {
      formatSession.current.finish();
      setLoading(false);
      setJobKind(null);
      setCancelling(false);
    }
  }

  async function handleQuiz() {
    setError(null);
    setCopied(false);
    setCancelling(false);
    if (!raw.trim()) {
      setError("Paste a PR description first — the input is empty.");
      return;
    }
    if (!shouldUseApi(settings)) {
      setError(
        "Quiz generation needs a model endpoint. Open Settings and add an API key, or pick the Ollama preset.",
      );
      return;
    }
    const signal = formatSession.current.start();
    setJobKind("quiz");
    setLoading(true);
    setOutput("");
    try {
      const result = await generateReleaseQuiz(raw, settings, {
        signal,
        onChunk: (accumulated) => setOutput(accumulated),
      });
      setOutput(result.markdown);
      setDiffOpen(true);
    } catch (err) {
      if (isAbortError(err)) return;
      const message =
        err instanceof FormatterError
          ? err.message
          : "Something went wrong while generating the quiz. Please try again.";
      setError(message);
    } finally {
      formatSession.current.finish();
      setLoading(false);
      setJobKind(null);
      setCancelling(false);
    }
  }

  async function handlePitch() {
    setError(null);
    setCopied(false);
    setCancelling(false);
    if (!raw.trim()) {
      setError("Paste a PR description first — the input is empty.");
      return;
    }
    if (!shouldUseApi(settings)) {
      setError(
        "Elevator pitch needs a model endpoint. Open Settings and add an API key, or pick the Ollama preset.",
      );
      return;
    }
    const signal = formatSession.current.start();
    setJobKind("pitch");
    setLoading(true);
    setOutput("");
    try {
      const result = await generateElevatorPitch(raw, settings, {
        signal,
        onChunk: (accumulated) => setOutput(accumulated),
      });
      setOutput(result.markdown);
      setDiffOpen(true);
    } catch (err) {
      if (isAbortError(err)) return;
      const message =
        err instanceof FormatterError
          ? err.message
          : "Something went wrong while generating the pitch. Please try again.";
      setError(message);
    } finally {
      formatSession.current.finish();
      setLoading(false);
      setJobKind(null);
      setCancelling(false);
    }
  }

  function handleCancelFormat() {
    if (!loading || cancelling) return;
    setCancelling(true);
    formatSession.current.cancel();
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

  function handleEndpointPresetChange(next: EndpointPresetId) {
    setSettings((prev) => applyEndpointPreset(prev, next));
    setSettingsSaved(false);
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
            <span className="field__label">Endpoint</span>
            <select
              className="field__input field__select"
              value={settings.endpointPreset}
              onChange={(e) => {
                const next = e.target.value;
                if (isEndpointPresetId(next)) handleEndpointPresetChange(next);
              }}
              aria-label="Model endpoint preset"
            >
              {ENDPOINT_OPTIONS.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
            <span className="field__hint">
              {ENDPOINT_PRESETS[settings.endpointPreset].hint}
            </span>
          </label>
          <label className="field">
            <span className="field__label-row">
              <span className="field__label">
                {ENDPOINT_PRESETS[settings.endpointPreset].requiresApiKey
                  ? "API key"
                  : "API key (optional)"}
              </span>
              <InfoIcon
                className="field__info"
                title="Stored locally via chrome.storage.local. Never sent anywhere except your configured endpoint."
              />
            </span>
            <input
              type="password"
              className="field__input"
              placeholder={
                ENDPOINT_PRESETS[settings.endpointPreset].requiresApiKey
                  ? "sk-..."
                  : "leave blank for local"
              }
              autoComplete="off"
              value={settings.apiKey}
              onChange={(e) => setSettings({ ...settings, apiKey: e.target.value })}
            />
            <span className="field__hint">
              {ENDPOINT_PRESETS[settings.endpointPreset].requiresApiKey
                ? "Leave blank to use the built-in offline formatter."
                : "Local endpoints work without a key; blank still uses the model at the Base URL."}
            </span>
          </label>
          <label className="field">
            <span className="field__label">Model</span>
            <input
              type="text"
              className="field__input"
              placeholder={ENDPOINT_PRESETS[settings.endpointPreset].model}
              value={settings.model}
              onChange={(e) => setSettings({ ...settings, model: e.target.value })}
            />
          </label>
          <label className="field">
            <span className="field__label">Base URL</span>
            <input
              type="text"
              className="field__input"
              placeholder={ENDPOINT_PRESETS[settings.endpointPreset].baseUrl}
              value={settings.baseUrl}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  baseUrl: e.target.value,
                  endpointPreset: "custom",
                })
              }
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

      <label className="field">
        <span className="field__label">Style</span>
        <select
          className="field__input field__select"
          value={selectionToValue(selection)}
          onChange={(e) => {
            const next = valueToSelection(e.target.value);
            if (next) void handleSelectionChange(next);
          }}
          aria-label="Formatting style"
        >
          <optgroup label="Built-in presets">
            {PRESET_OPTIONS.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.label}
              </option>
            ))}
          </optgroup>
          {profiles.length > 0 && (
            <optgroup label="Saved profiles">
              {profiles.map((profile) => (
                <option key={profile.id} value={selectionToValue({ kind: "profile", id: profile.id })}>
                  {profile.name}
                </option>
              ))}
            </optgroup>
          )}
        </select>
        <span className="field__hint">
          Active: {activeGuide.label} ({activeGuide.sections.length} sections)
        </span>
      </label>

      <div className="profile-actions">
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() => {
            if (saveOpen) setSaveOpen(false);
            else openSaveForm();
          }}
        >
          {saveOpen ? "Cancel save" : "Save as profile"}
        </button>
        {selection.kind === "profile" && (
          <button type="button" className="btn btn--ghost" onClick={() => void handleDeleteProfile()}>
            Delete profile
          </button>
        )}
      </div>

      {saveOpen && (
        <section className="profile-save" aria-label="Save formatting profile">
          <label className="field">
            <span className="field__label">Profile name</span>
            <input
              type="text"
              className="field__input"
              placeholder="e.g. Platform services"
              value={profileName}
              onChange={(e) => setProfileName(e.target.value)}
              maxLength={48}
            />
          </label>
          <label className="field">
            <span className="field__label">Section headings</span>
            <textarea
              className="textarea textarea--compact"
              rows={5}
              value={profileSectionsText}
              onChange={(e) => setProfileSectionsText(e.target.value)}
              placeholder={"Summary\nWhat Changed\nTest Plan"}
            />
            <span className="field__hint">One heading per line. Order is preserved.</span>
          </label>
          <button type="button" className="btn btn--primary" onClick={() => void handleSaveProfile()}>
            Save profile
          </button>
        </section>
      )}

      {profileNotice && (
        <p className="profile-notice" role="status">
          {profileNotice}
        </p>
      )}

      <div className="actions actions--format">
        <button
          type="button"
          className="btn btn--primary btn--lg btn--grow"
          onClick={() => void handleFormat()}
          disabled={loading}
        >
          {!(loading && jobKind === "format") && <FormatIcon className="btn__icon" />}
          {loading && jobKind === "format"
            ? cancelling
              ? "Cancelling…"
              : "Formatting…"
            : "Format Markdown"}
        </button>
        <button
          type="button"
          className="btn btn--lg"
          onClick={() => void handleQuiz()}
          disabled={loading}
          title={
            shouldUseApi(settings)
              ? "Generate a short quiz from this description (model required)"
              : "Needs a model endpoint (API key or Ollama preset)"
          }
        >
          {loading && jobKind === "quiz"
            ? cancelling
              ? "Cancelling…"
              : "Quizzing…"
            : "Quiz me"}
        </button>
        <button
          type="button"
          className="btn btn--lg"
          onClick={() => void handlePitch()}
          disabled={loading}
          title={
            shouldUseApi(settings)
              ? "Generate a short elevator pitch from this description (model required)"
              : "Needs a model endpoint (API key or Ollama preset)"
          }
        >
          {loading && jobKind === "pitch"
            ? cancelling
              ? "Cancelling…"
              : "Pitching…"
            : "Elevator pitch"}
        </button>
        {loading && (
          <button
            type="button"
            className="btn btn--lg"
            onClick={handleCancelFormat}
            disabled={cancelling}
            aria-label={
              jobKind === "quiz"
                ? "Cancel quiz"
                : jobKind === "pitch"
                  ? "Cancel elevator pitch"
                  : "Cancel formatting"
            }
          >
            Cancel
          </button>
        )}
      </div>

      {error && (
        <div className="alert" role="alert">
          {error}
        </div>
      )}

      {diff && (
        <section
          className="diff"
          aria-label="Format diff preview"
          data-diff-layout={diffLayout}
        >
          <div className="diff__header">
            <span className="field__label">
              {diff.identical
                ? "Diff (no changes)"
                : `Diff (+${diff.summary.added} / −${diff.summary.removed})`}
            </span>
            {!diff.identical && (
              <div className="diff__header-actions">
                <div className="diff__layout" role="group" aria-label="Diff layout">
                  <button
                    type="button"
                    className={`btn btn--ghost btn--tiny${diffLayout === "unified" ? " btn--pressed" : ""}`}
                    aria-pressed={diffLayout === "unified"}
                    onClick={() => void handleDiffLayoutChange("unified")}
                  >
                    Unified
                  </button>
                  <button
                    type="button"
                    className={`btn btn--ghost btn--tiny${diffLayout === "columns" ? " btn--pressed" : ""}`}
                    aria-pressed={diffLayout === "columns"}
                    onClick={() => void handleDiffLayoutChange("columns")}
                  >
                    Columns
                  </button>
                </div>
                <button
                  type="button"
                  className="btn btn--ghost btn--tiny"
                  onClick={() => setDiffOpen((v) => !v)}
                  aria-expanded={diffOpen}
                >
                  {diffOpen ? "Hide" : "Show"}
                </button>
              </div>
            )}
          </div>
          {diff.identical ? (
            <p className="diff__empty">Formatted output matches the raw input.</p>
          ) : (
            diffOpen &&
            (diffLayout === "columns" ? (
              <div
                className="diff__body diff__body--columns"
                aria-label="Before and after side-by-side diff"
                data-diff-layout="columns"
              >
                <div className="diff__col-head" aria-hidden="true">
                  <span className="diff__col-label">Before</span>
                  <span className="diff__col-label">After</span>
                </div>
                {diff.columns.map((row, index) => (
                  <div
                    key={`col-${index}`}
                    className="diff__row"
                    data-diff-left={row.left.kind}
                    data-diff-right={row.right.kind}
                  >
                    <div className={`diff__cell diff__cell--${row.left.kind}`}>
                      {row.left.text.length > 0 ? row.left.text : " "}
                    </div>
                    <div className={`diff__cell diff__cell--${row.right.kind}`}>
                      {row.right.text.length > 0 ? row.right.text : " "}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <pre
                className="diff__body"
                aria-label="Before and after line diff"
                data-diff-layout="unified"
              >
                {diff.lines.map((line, index) => (
                  <div
                    key={`${line.kind}-${index}`}
                    className={`diff__line diff__line--${line.kind}`}
                    data-diff-kind={line.kind}
                  >
                    <span className="diff__prefix" aria-hidden="true">
                      {line.kind === "add" ? "+" : line.kind === "remove" ? "-" : " "}
                    </span>
                    <span className="diff__text">
                      {line.text.length > 0 ? line.text : " "}
                    </span>
                  </div>
                ))}
              </pre>
            ))
          )}
        </section>
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
