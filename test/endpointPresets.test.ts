import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_ENDPOINT_PRESET,
  ENDPOINT_PRESETS,
  applyEndpointPreset,
  isEndpointPresetId,
  normalizeBaseUrl,
  shouldUseApi,
} from "../src/formatter/endpointPresets";
import { DEFAULT_SETTINGS } from "../src/formatter/types";
import { loadSettings, saveSettings } from "../src/storage/settings";

describe("isEndpointPresetId", () => {
  it("accepts built-in ids only", () => {
    assert.equal(isEndpointPresetId("openai"), true);
    assert.equal(isEndpointPresetId("ollama"), true);
    assert.equal(isEndpointPresetId("openrouter"), true);
    assert.equal(isEndpointPresetId("custom"), true);
    assert.equal(isEndpointPresetId("azure"), false);
    assert.equal(isEndpointPresetId(""), false);
    assert.equal(isEndpointPresetId(null), false);
  });
});

describe("ENDPOINT_PRESETS catalog", () => {
  it("ships OpenAI, Ollama, OpenRouter, and Custom with OpenAI-compatible /v1 bases", () => {
    assert.equal(DEFAULT_ENDPOINT_PRESET, "openai");
    assert.equal(ENDPOINT_PRESETS.openai.baseUrl, "https://api.openai.com/v1");
    assert.equal(ENDPOINT_PRESETS.openai.requiresApiKey, true);
    assert.equal(ENDPOINT_PRESETS.ollama.baseUrl, "http://localhost:11434/v1");
    assert.equal(ENDPOINT_PRESETS.ollama.requiresApiKey, false);
    assert.equal(ENDPOINT_PRESETS.ollama.model, "llama3.2");
    assert.equal(ENDPOINT_PRESETS.openrouter.baseUrl, "https://openrouter.ai/api/v1");
    assert.equal(ENDPOINT_PRESETS.openrouter.requiresApiKey, true);
    assert.equal(ENDPOINT_PRESETS.custom.requiresApiKey, true);
  });
});

describe("normalizeBaseUrl", () => {
  it("trims and strips trailing slashes, falling back when empty", () => {
    assert.equal(normalizeBaseUrl(" https://api.openai.com/v1/ ", "x"), "https://api.openai.com/v1");
    assert.equal(normalizeBaseUrl("   ", "http://localhost:11434/v1"), "http://localhost:11434/v1");
  });
});

describe("applyEndpointPreset", () => {
  it("stamps Ollama model + base URL and preserves the API key", () => {
    const next = applyEndpointPreset(
      {
        ...DEFAULT_SETTINGS,
        apiKey: "keep-me",
        model: "old",
        baseUrl: "https://example.com/v1",
        endpointPreset: "openai",
      },
      "ollama",
    );
    assert.equal(next.endpointPreset, "ollama");
    assert.equal(next.model, ENDPOINT_PRESETS.ollama.model);
    assert.equal(next.baseUrl, ENDPOINT_PRESETS.ollama.baseUrl);
    assert.equal(next.apiKey, "keep-me");
  });

  it("does not rewrite model/base URL when switching to Custom", () => {
    const prev = {
      ...DEFAULT_SETTINGS,
      model: "my-local-model",
      baseUrl: "http://127.0.0.1:1234/v1",
      endpointPreset: "ollama" as const,
    };
    const next = applyEndpointPreset(prev, "custom");
    assert.equal(next.endpointPreset, "custom");
    assert.equal(next.model, "my-local-model");
    assert.equal(next.baseUrl, "http://127.0.0.1:1234/v1");
  });

  it("applies OpenRouter defaults from any prior preset", () => {
    const next = applyEndpointPreset(
      { ...DEFAULT_SETTINGS, endpointPreset: "ollama" },
      "openrouter",
    );
    assert.equal(next.endpointPreset, "openrouter");
    assert.equal(next.model, ENDPOINT_PRESETS.openrouter.model);
    assert.equal(next.baseUrl, ENDPOINT_PRESETS.openrouter.baseUrl);
  });
});

describe("shouldUseApi", () => {
  it("uses API when a key is present, even for OpenAI", () => {
    assert.equal(
      shouldUseApi({ apiKey: "sk-test", endpointPreset: "openai" }),
      true,
    );
  });

  it("stays offline for keyed presets without a key", () => {
    assert.equal(shouldUseApi({ apiKey: "", endpointPreset: "openai" }), false);
    assert.equal(shouldUseApi({ apiKey: "  ", endpointPreset: "openrouter" }), false);
    assert.equal(shouldUseApi({ apiKey: "", endpointPreset: "custom" }), false);
  });

  it("allows Ollama without an API key", () => {
    assert.equal(shouldUseApi({ apiKey: "", endpointPreset: "ollama" }), true);
  });
});

describe("settings storage endpointPreset (memory fallback)", () => {
  it("defaults endpointPreset to openai and round-trips Ollama settings", async () => {
    await saveSettings({
      apiKey: "",
      model: "x",
      baseUrl: "http://x",
      endpointPreset: "openai",
    });
    let loaded = await loadSettings();
    assert.equal(loaded.endpointPreset, "openai");

    await saveSettings({
      apiKey: "  secret  ",
      model: "llama3.2",
      baseUrl: "http://localhost:11434/v1/",
      endpointPreset: "ollama",
    });
    loaded = await loadSettings();
    assert.equal(loaded.endpointPreset, "ollama");
    assert.equal(loaded.model, "llama3.2");
    assert.equal(loaded.baseUrl, "http://localhost:11434/v1");
    assert.equal(loaded.apiKey, "secret");
  });

  it("falls back to openai when a stored endpointPreset is invalid", async () => {
    await saveSettings({
      ...DEFAULT_SETTINGS,
      endpointPreset: "not-real" as unknown as "openai",
    });
    const loaded = await loadSettings();
    assert.equal(loaded.endpointPreset, DEFAULT_ENDPOINT_PRESET);
  });
});
