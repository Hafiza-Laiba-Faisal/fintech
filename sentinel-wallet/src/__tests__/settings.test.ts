/**
 * Tests: Settings Sanitization (API-key confidentiality)
 * Environment: Unit (pure functions — no server, no network)
 *
 * What these tests verify:
 *   - The raw apiKey NEVER appears in a client-facing settings view
 *     (both POST /api/settings and GET /api/settings sanitize through
 *     sanitizeLLMForClient — tested here at the unit level).
 *   - A masked display value ("••••4c7d") echoed by the client can NOT
 *     overwrite the stored secret (applyLLMSettingsUpdate refuses it).
 *   - Updating unrelated settings (enabled/model/endpoint/…) does not
 *     erase or alter the stored key unexpectedly.
 *   - An error-ish path: empty/malformed apiKey values fail safe (no change).
 *
 * NOTE: synthetic keys only — "sk-synthetic-test-1234567890", never a
 * real credential.
 */

import { describe, it, expect } from "vitest";
import {
  maskApiKey,
  looksLikeMaskedKey,
  sanitizeLLMForClient,
  applyLLMSettingsUpdate,
  type LLMSettings,
} from "../settings.js";

const SYNTHETIC_KEY = "sk-synthetic-test-1234567890";

function makeLLM(overrides: Partial<LLMSettings> = {}): LLMSettings {
  return {
    enabled: true,
    provider: "LLM (http://localhost:3001/v1/chat/completions)",
    model: "auto",
    endpoint: "http://localhost:3001/v1/chat/completions",
    apiKey: SYNTHETIC_KEY,
    regexFallback: true,
    ...overrides,
  };
}

// ─── maskApiKey ──────────────────────────────────────────────────────────────

describe("maskApiKey", () => {
  it("masks all but the last 4 characters", () => {
    const masked = maskApiKey(SYNTHETIC_KEY);
    expect(masked.endsWith("7890")).toBe(true);
    expect(masked).toMatch(/^•+7890$/);
    expect(masked).not.toContain("synthetic");
  });

  it("fully masks short keys (never partially echoes a secret)", () => {
    const masked = maskApiKey("abc");
    expect(masked).toBe("•••");
    expect(masked).not.toContain("a");
  });

  it("returns empty string for empty key", () => {
    expect(maskApiKey("")).toBe("");
  });
});

// ─── Client-facing sanitization ──────────────────────────────────────────────

describe("sanitizeLLMForClient — browser-facing responses", () => {
  it("never includes the raw apiKey", () => {
    const sanitized = sanitizeLLMForClient(makeLLM());
    const roundTrip = JSON.parse(JSON.stringify(sanitized)) as Record<string, unknown>;
    expect("apiKey" in roundTrip).toBe(false);
  });

  it("always includes a masked view usable by the UI", () => {
    const sanitized = sanitizeLLMForClient(makeLLM());
    expect(sanitized.apiKeyMasked).toBe(maskApiKey(SYNTHETIC_KEY));
    expect(sanitized.apiKeyMasked).not.toBe(SYNTHETIC_KEY);
  });

  it("keeps non-secret fields intact (UI still functional)", () => {
    const sanitized = sanitizeLLMForClient(makeLLM({ model: "groq/x", enabled: false }));
    expect(sanitized.model).toBe("groq/x");
    expect(sanitized.enabled).toBe(false);
    expect(sanitized.endpoint).toContain("localhost:3001");
  });

  it("sanitizing an empty key yields an empty mask (no undefined leakage)", () => {
    const sanitized = sanitizeLLMForClient(makeLLM({ apiKey: "" }));
    expect(sanitized.apiKeyMasked).toBe("");
  });
});

// ─── Masked-value overwrite guard ────────────────────────────────────────────

describe("looksLikeMaskedKey", () => {
  it("detects masked placeholder strings", () => {
    expect(looksLikeMaskedKey("•••••••••••••••••••••••4c7d")).toBe(true);
    expect(looksLikeMaskedKey("abc")).toBe(false);
  });

  it("treats empty string as no-op (fail safe)", () => {
    expect(looksLikeMaskedKey("")).toBe(true);
  });
});

describe("applyLLMSettingsUpdate — stored-secret preservation", () => {
  it("a masked display value echoed back does NOT overwrite the real key", () => {
    const stored = makeLLM();
    const maskedEcho = maskApiKey(SYNTHETIC_KEY); // what the UI shows
    applyLLMSettingsUpdate(stored, { apiKey: maskedEcho });
    expect(stored.apiKey).toBe(SYNTHETIC_KEY); // unchanged — guard held
  });

  it("an empty string apiKey does NOT erase the stored key", () => {
    const stored = makeLLM();
    applyLLMSettingsUpdate(stored, { apiKey: "" });
    expect(stored.apiKey).toBe(SYNTHETIC_KEY);
  });

  it("a real new key IS persisted (rotation still possible)", () => {
    const stored = makeLLM();
    const newKey = "sk-new-real-credential-9876543210";
    applyLLMSettingsUpdate(stored, { apiKey: newKey });
    expect(stored.apiKey).toBe(newKey);
  });

  it("apiKey: null IS an explicit clear (intentional erasure supported)", () => {
    const stored = makeLLM();
    applyLLMSettingsUpdate(stored, { apiKey: null });
    expect(stored.apiKey).toBe("");
  });
});

// ─── Unrelated-update preservation ───────────────────────────────────────────

describe("applyLLMSettingsUpdate — unrelated fields", () => {
  it("updating model/endpoint/enabled leaves the stored key untouched", () => {
    const stored = makeLLM();
    const originalKey = stored.apiKey;

    applyLLMSettingsUpdate(stored, {
      model: "gemini/gemini-2.5-flash",
      endpoint: "http://other.example/v1",
      enabled: false,
      regexFallback: false,
      provider: "LLM (manual)",
    });

    expect(stored.apiKey).toBe(originalKey);
    expect(stored.model).toBe("gemini/gemini-2.5-flash");
    expect(stored.enabled).toBe(false);
    expect(stored.provider).toBe("LLM (manual)");
  });

  it("malformed update payload (wrong types) is ignored, key safe", () => {
    const stored = makeLLM();
    const before = JSON.stringify(stored);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    applyLLMSettingsUpdate(stored, { enabled: "yes" as any, model: 42 as any });
    expect(JSON.stringify(stored)).toBe(before);
  });

  it("partial update leaves unset fields at their previous values", () => {
    const stored = makeLLM({ model: "before", endpoint: "http://before" });
    // apiKey omitted entirely: no change to the stored secret
    applyLLMSettingsUpdate(stored, { model: "after" });
    expect(stored.model).toBe("after");
    expect(stored.endpoint).toBe("http://before");
  });
});
