/**
 * Sentinel Wallet — Settings Sanitization (pure module)
 *
 * Single source of truth for how LLM settings are masked for the client,
 * how client updates are applied, and how masked display values are kept
 * from overwriting the real stored secret.
 *
 * SECURITY PROPERTY: the raw apiKey NEVER leaves the server. Every
 * client-facing settings view goes through sanitizeSettingsForClient(),
 * and every client-supplied update goes through applyLLMSettingsUpdate(),
 * which refuses to persist a masked placeholder in place of a real key.
 *
 * Pure module: no I/O, no process state, no side effects. Unit-testable
 * without importing the HTTP server.
 */

// ─── Masking ─────────────────────────────────────────────────────────────────

const MASK_CHAR = "•";
const VISIBLE_TAIL_CHARS = 4;

/**
 * Mask a secret for display. Returns "" for empty input; masks everything
 * except the last VISIBLE_TAIL_CHARS characters. A short key (< tail length)
 * is fully masked — never partially echoed.
 */
export function maskApiKey(key: string): string {
  if (!key) return "";
  if (key.length <= VISIBLE_TAIL_CHARS) return MASK_CHAR.repeat(key.length);
  return MASK_CHAR.repeat(key.length - VISIBLE_TAIL_CHARS) + key.slice(-VISIBLE_TAIL_CHARS);
}

/**
 * True if the value looks like a masked display string produced by
 * maskApiKey() (or an empty string) rather than a real credential.
 * Used so a client echoing a masked value back does not corrupt the
 * stored secret.
 *
 * This is heuristic, not cryptographic — masking bullets are chars a
 * realistic API key would not contain, and empty means "no change".
 */
export function looksLikeMaskedKey(value: string): boolean {
  if (value === "") return true;
  return value.includes(MASK_CHAR);
}

// ─── Client-facing sanitization ─────────────────────────────────────────────

/** Shape sanitized for the browser: no raw apiKey, only its masked view. */
export interface ClientSafeLLMSettings {
  enabled: boolean;
  provider: string;
  model: string;
  endpoint: string;
  apiKeyMasked: string;
  regexFallback: boolean;
  /** Always undefined on sanitized views — guards accidental spread leaks */
  apiKey?: undefined;
}

export interface LLMSettings {
  enabled: boolean;
  provider: string;
  model: string;
  endpoint: string;
  apiKey: string; // server-side only
  regexFallback: boolean;
}

/**
 * Produce the browser-safe view of LLM settings. The `apiKey: undefined`
 * marker makes any accidental spread of this object leak-safe at the type
 * level and removes the raw key at runtime.
 */
export function sanitizeLLMForClient(llm: LLMSettings): ClientSafeLLMSettings {
  const { apiKey, ...rest } = llm;
  return {
    ...rest,
    apiKey: undefined,
    apiKeyMasked: maskApiKey(apiKey),
  };
}

// ─── Update application ──────────────────────────────────────────────────────

/**
 * Apply a client-supplied partial LLM settings update to the stored settings.
 *
 * Rules:
 *   - `enabled`, `provider`, `model`, `endpoint`, `regexFallback`: applied if
 *     the supplied value has the right type (partial update — unrelated
 *     fields and the stored key are untouched unless explicitly sent).
 *   - `apiKey`: applied ONLY if it does not look like a masked placeholder.
 *     A masked/empty value is IGNORED (the existing stored key survives).
 *     To actually clear a key, clients send apiKey: null.
 *
 * Mutates and returns `stored` for ergonomic call sites; also returns the
 * same object so the caller can serialize the result.
 */
export type LLMSettingsUpdate =
  Partial<Omit<LLMSettings, "apiKey"> & { apiKey?: string | null }>;

export function applyLLMSettingsUpdate(
  stored: LLMSettings,
  update: LLMSettingsUpdate,
): LLMSettings {
  if (typeof update.enabled === "boolean") stored.enabled = update.enabled;
  if (typeof update.provider === "string") stored.provider = update.provider;
  if (typeof update.model === "string") stored.model = update.model;
  if (typeof update.endpoint === "string") stored.endpoint = update.endpoint;
  if (typeof update.regexFallback === "boolean") stored.regexFallback = update.regexFallback;

  if (update.apiKey === null) {
    // Explicit clear request.
    stored.apiKey = "";
  } else if (typeof update.apiKey === "string" && update.apiKey.length > 0) {
    // Only persist values that do NOT look like a masked placeholder —
    // this is the guard that stops "••••4c7d" from replacing the real key.
    if (!looksLikeMaskedKey(update.apiKey)) {
      stored.apiKey = update.apiKey;
    }
  }
  // Empty string / masked strings / missing field: no change to stored key.

  return stored;
}
