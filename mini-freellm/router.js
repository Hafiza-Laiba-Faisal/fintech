/**
 * Mini-FreeLLM — self-hosted OpenAI-compatible LLM router (zero dependencies)
 *
 * Puts multiple free LLM provider API keys behind ONE unified endpoint:
 *   POST http://localhost:3001/v1/chat/completions   (Authorization: Bearer <unified key>)
 *   GET  http://localhost:3001/v1/models
 *   GET  http://localhost:3001/                      (dashboard: add keys, view unified key)
 *
 * Automatic failover: tries providers in priority order; on 429/408/5xx or
 * network error it moves to the next configured provider.
 *
 * Keys are stored in keys.json (provider keys + unified key), created on
 * first run. Nothing here is committed to any repo. Run: node router.js
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const KEYS_FILE = join(__dirname, "keys.json");
const PORT = Number(process.env["PORT"] ?? "") > 0 ? Number(process.env["PORT"]) : 3001;

// ─── Provider registry (all have OpenAI-compatible chat-completions) ─────────

const PROVIDERS = {
  groq: {
    url: "https://api.groq.com/openai/v1/chat/completions",
    auth: "bearer",
    defaultModel: "openai/gpt-oss-120b", // valid in 2026 — llama-3.3-70b-versatile retired
    getKeyUrl: "https://console.groq.com/keys",
    label: "Groq",
  },
  gemini: {
    url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    auth: "bearer",
    defaultModel: "gemini-3.8-flash", // verified live — older 2.x IDs blocked for new keys
    getKeyUrl: "https://aistudio.google.com/apikey",
    label: "Google AI Studio (Gemini)",
  },
  openrouter: {
    url: "https://openrouter.ai/api/v1/chat/completions",
    auth: "bearer",
    defaultModel: "nvidia/nemotron-3-ultra-550b-a55b:free", // FREE tier only — user preference
    getKeyUrl: "https://openrouter.ai/keys",
    label: "OpenRouter",
  },
  deepseek: {
    url: "https://api.deepseek.com/chat/completions",
    auth: "bearer",
    defaultModel: "deepseek-chat",
    getKeyUrl: "https://platform.deepseek.com/api_keys",
    label: "DeepSeek",
  },
  mistral: {
    url: "https://api.mistral.ai/v1/chat/completions",
    auth: "bearer",
    defaultModel: "mistral-small-latest",
    getKeyUrl: "https://console.mistral.ai/api-keys",
    label: "Mistral",
  },
  cerebras: {
    url: "https://api.cerebras.ai/v1/chat/completions",
    auth: "bearer",
    defaultModel: "llama-3.3-70b",
    getKeyUrl: "https://cloud.cerebras.ai",
    label: "Cerebras",
  },
};

// ─── Keys store ──────────────────────────────────────────────────────────────

function loadKeys() {
  if (!existsSync(KEYS_FILE)) {
    const initial = {
      unifiedKey: "mfa-" + randomBytes(24).toString("hex"),
      keys: {}, // provider id → API key
    };
    writeFileSync(KEYS_FILE, JSON.stringify(initial, null, 2));
    return initial;
  }
  return JSON.parse(readFileSync(KEYS_FILE, "utf8"));
}

function saveKeys(store) {
  writeFileSync(KEYS_FILE, JSON.stringify(store, null, 2));
}

let store = loadKeys();

function configuredProviders() {
  return Object.keys(PROVIDERS).filter((p) => store.keys[p] && store.keys[p].length > 0);
}

// ─── Routing ─────────────────────────────────────────────────────────────────

function buildChain(model) {
  const cfg = configuredProviders();
  if (cfg.length === 0) return [];

  // "groq/llama-3.3-70b-versatile" → force provider + model
  const forced = Object.keys(PROVIDERS).find((p) => model && model.startsWith(p + "/") && store.keys[p]);
  if (forced) return [{ provider: forced, model: model.slice(forced.length + 1) }];

  // A concrete model with no provider prefix → try every configured provider
  if (model && model !== "auto") {
    return cfg.map((p) => ({ provider: p, model }));
  }

  // "auto" / default → each configured provider with its default model
  return cfg.map((p) => ({ provider: p, model: PROVIDERS[p].defaultModel }));
}

async function callUpstream(provider, apiKey, body, modelOverride) {
  const p = PROVIDERS[provider];
  const payload = { ...body, stream: false };
  if (modelOverride) payload.model = modelOverride;
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` };
  if (provider === "openrouter") {
    headers["HTTP-Referer"] = "http://localhost:3001";
    headers["X-Title"] = "Sentinel Wallet";
  }

  const res = await fetch(p.url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30_000),
  });

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Non-JSON response (HTTP ${res.status}): ${text.slice(0, 200)}`);
  }

  const status = res.status;
  if (!res.ok) {
    const retryable = status === 429 || status === 408 || status === 503 || status >= 500;
    const retryWithoutJsonMode = status === 400 && payload.response_format;
    return { status, json, retryable, retryWithoutJsonMode };
  }
  return { status, json, retryable: false, retryWithoutJsonMode: false };
}

// ─── Dashboard ───────────────────────────────────────────────────────────────

function dashboardHTML() {
  const rows = Object.entries(PROVIDERS)
    .map(([id, p]) => {
      const configured = !!store.keys[id];
      return `<tr>
        <td><b>${p.label}</b><br><span class="dim">${id} · default model: ${p.defaultModel}</span></td>
        <td class="${configured ? "ok" : "dim"}">${configured ? "✅ configured" : "— not configured"}</td>
        <td><a href="${p.getKeyUrl}" target="_blank">get key ↗</a>
            ${configured ? `<form method="POST" action="/remove" style="display:inline"><input type="hidden" name="provider" value="${id}"><button>remove</button></form>` : ""}
            <form method="POST" action="/add" style="margin-top:6px">
              <input type="hidden" name="provider" value="${id}">
              <input name="key" placeholder="paste ${p.label} API key" style="width:320px" autocomplete="off">
              <button>save</button>
            </form></td>
      </tr>`;
    })
    .join("\n");

  return `<!DOCTYPE html><html><head><title>Mini-FreeLLM — Keys & Endpoint</title><style>
  body{font-family:system-ui,sans-serif;max-width:900px;margin:40px auto;padding:0 20px;background:#0b0f19;color:#e2e8f0}
  h1{font-size:22px} code{background:#1a2235;padding:2px 6px;border-radius:4px}
  table{width:100%;border-collapse:collapse;margin-top:16px} td{padding:10px;border-bottom:1px solid #1f2e45;vertical-align:top;font-size:13px}
  input{background:#1a2235;border:1px solid #1f2e45;color:#e2e8f0;padding:6px 10px;border-radius:6px}
  button{background:#3b82f6;color:#fff;border:none;padding:6px 14px;border-radius:6px;cursor:pointer}
  .key{background:#10b981;color:#000;padding:8px 12px;border-radius:8px;font-family:monospace;display:inline-block;margin:8px 0}
  .ok{color:#10b981}.dim{color:#64748b}
  .err{background:rgba(239,68,68,.12);border:1px solid rgba(239,68,68,.4);padding:10px;border-radius:8px;margin:10px 0}
  .note{background:#1a2235;padding:10px 14px;border-radius:8px;margin:10px 0;font-size:13px}
  </style></head><body>
  <h1>🛰️ Mini-FreeLLM — one key, every free provider</h1>
  <div class="note">Unified OpenAI-compatible endpoint:<br><code>http://localhost:3001/v1/chat/completions</code><br><br>
  Unified key (use as <code>LLM_API_KEY</code> in .env, or the password field in the UI):<br>
  <span class="key">${store.unifiedKey}</span></div>
  ${globalThis._lastError ? `<div class="err">${globalThis._lastError}</div>` : ""}
  <table><tr class="dim"><td>Provider</td><td>Status</td><td>Add key</td></tr>${rows}</table>
  <div class="note">Model routing: <code>auto</code> → tries every configured provider (default models, failover on rate-limit).
  <code>groq/&lt;model&gt;</code> → forces that provider. Any other model name → tried on each configured provider.</div>
  </body></html>`;
}

// ─── Server ──────────────────────────────────────────────────────────────────

function send(res, status, body, contentType = "application/json") {
  res.writeHead(status, { "Content-Type": contentType });
  res.end(typeof body === "object" ? JSON.stringify(body) : body);
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8");
}

function storeError(err) {
  globalThis._lastError = `${new Date().toLocaleTimeString()} — ${String(err.message ?? err).slice(0, 400)}`;
  console.error(globalThis._lastError);
}

const server = createServer(async (req, res) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.url}`);
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);

  try {
    // Dashboard + key management (local only)
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      return send(res, 200, dashboardHTML(), "text/html");
    }

    if (req.method === "POST" && url.pathname === "/add") {
      const form = new URLSearchParams(await readBody(req));
      const provider = form.get("provider");
      const key = (form.get("key") ?? "").trim();
      if (!PROVIDERS[provider]) return send(res, 400, { error: "unknown provider" });
      if (!key) return send(res, 400, { error: "empty key" });
      store.keys[provider] = key;
      saveKeys(store);
      globalThis._lastError = null;
      res.writeHead(302, { Location: "/" });
      return res.end();
    }

    if (req.method === "POST" && url.pathname === "/remove") {
      const form = new URLSearchParams(await readBody(req));
      delete store.keys[form.get("provider") ?? ""];
      saveKeys(store);
      res.writeHead(302, { Location: "/" });
      return res.end();
    }

    // Readiness probe
    if (url.pathname === "/healthz") {
      return send(res, 200, { ok: true, providers: configuredProviders() });
    }

    // Unified key check for /v1/*
    if (url.pathname.startsWith("/v1/")) {
      const auth = req.headers["authorization"] ?? "";
      if (auth !== `Bearer ${store.unifiedKey}`) {
        return send(res, 401, { error: "Invalid unified key. Get it at http://localhost:3001/" });
      }

      if (req.method === "GET" && url.pathname === "/v1/models") {
        const ids = buildChain(null).map((c) => `${c.provider}/${c.model}`);
        return send(res, 200, { object: "list", data: ids.map((id) => ({ object: "model", id })) });
      }

      if (req.method === "POST" && url.pathname === "/v1/chat/completions") {
        const ids = new Set(configuredProviders());
        if (ids.size === 0) {
          return send(res, 503, { error: { message: "No provider keys configured yet. Open http://localhost:3001/ and add at least one free API key." } });
        }

        let body;
        try {
          body = JSON.parse(await readBody(req));
        } catch {
          return send(res, 400, { error: { message: "Invalid JSON body" } });
        }
        const chain = buildChain(body.model ?? "auto");
        const attempts = [];

        for (const step of chain) {
          attempts.push(`${step.provider}`);
          try {
            const out = await callUpstream(step.provider, store.keys[step.provider], body, step.model);

            if (out.status < 300) {
              console.log(`  ↳ served by ${step.provider} (${out.json?.model ?? step.model})`);
              return send(res, 200, out.json);
            }

            if (out.retryable) {
              storeError(`HTTP ${out.status} from ${step.provider} → failure over`);
              continue;
            }

            // 4xx: try stripping unsupported json_object mode once, then fail over
            if (out.retryWithoutJsonMode) {
              const retryBody = { ...body };
              delete retryBody.response_format;
              try {
                const out2 = await callUpstream(step.provider, store.keys[step.provider], retryBody, step.model);
                if (out2.status < 300) {
                  console.log(`  ↳ served by ${step.provider} (json mode stripped)`);
                  return send(res, 200, out2.json);
                }
              } catch { /* fail over */ }
            }

            storeError(`HTTP ${out.status} from ${step.provider}: ${JSON.stringify(out.json?.error ?? out.json).slice(0, 300)} → failure over`);
            continue;
          } catch (e) {
            storeError(`${step.provider} request failed: ${e.message} → failure over`);
            continue;
          }
        }

        return send(res, 502, {
          error: { message: `All configured providers failed (tried: ${attempts.join(", ")}). Last error above. Check http://localhost:3001/ dashboard.` },
        });
      }

      return send(res, 404, { error: { message: "Unknown /v1 route" } });
    }

    return send(res, 404, { error: "Not found" });
  } catch (e) {
    storeError(e);
    if (!res.headersSent) {
      return send(res, 500, { error: { message: String(e.message ?? e) } });
    }
    return; // response already committed
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`\n🛰️ Mini-FreeLLM router running:  http://localhost:${PORT}`);
  console.log(`   Endpoint: POST http://localhost:${PORT}/v1/chat/completions`);
  console.log(`   Unified key: ${store.unifiedKey}`);
  console.log(`   Provider keys configured: ${configuredProviders().join(", ") || "NONE — open the dashboard to add"}\n`);
});
