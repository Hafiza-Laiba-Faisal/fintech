/**
 * Tests: LLM-Powered Agent Planner
 * Environment: Unit (no real network — global fetch is mocked)
 *
 * These tests verify the TRUST BOUNDARY of the LLM planner:
 *   - the LLM's output is validated against a typed schema before use
 *   - no raw calldata ever comes from the LLM (it only yields recipient+amount)
 *   - failures never produce an intent
 *   - fallback to the regex planner preserves identical policy inputs
 */

import { describe, it, expect, afterEach } from "vitest";
import { parseUnits, type Address } from "viem";
import {
  parsePlannerRequestWithLLM,
  parsePlannerRequestWithLLMFallback,
  extractJSONFromModelOutput,
  LLM_SYSTEM_PROMPT,
  type LLMPlannerConfig,
} from "../llm-planner.js";
import { TRANSFER_SELECTOR } from "../intent.js";

const CHAIN_ID = 84532;
const WALLET: Address = "0x1111111111111111111111111111111111111111";
const TOKEN: Address = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const RECIPIENT: Address = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const OTHER_ADDRESS = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";

const BASEParams = {
  instruction: `send 10 USDC to ${RECIPIENT} for payroll`,
  chainId: CHAIN_ID,
  walletAddress: WALLET,
  tokenAddress: TOKEN,
  tokenDecimals: 6,
  tokenSymbol: "USDC",
};

const OPENAI_CONFIG: LLMPlannerConfig = {
  endpointUrl: "https://api.example.com/v1/chat/completions",
  apiKey: "test-key",
  model: "gpt-4o-mini",
  format: "openai",
  timeoutMs: 1000,
};

const ANTHROPIC_CONFIG: LLMPlannerConfig = {
  endpointUrl: "https://api.example.com/v1/messages",
  apiKey: "test-key",
  model: "claude-sonnet-4-20250514",
  format: "anthropic",
  timeoutMs: 1000,
};

const goodModelOutput = JSON.stringify({
  action: "transfer",
  recipient: RECIPIENT,
  amount: 10,
  token: "USDC",
});

function openAIResponse(content: string): unknown {
  return { choices: [{ message: { role: "assistant", content } }] };
}

function anthropicResponse(content: string): unknown {
  return { content: [{ type: "text", text: content }] };
}

// ─── fetch mock harness ──────────────────────────────────────────────────────

type FetchCall = { url: string; init: RequestInit };

type FetchStub = (url: string, init: RequestInit) => Response | Promise<Response>;

let lastCall: FetchCall | null = null;
let stubbedFetch: FetchStub | null = null;
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  stubbedFetch = null;
  lastCall = null;
});

function mockFetch(stub: FetchStub): void {
  stubbedFetch = stub;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).fetch = async (url: string, init: RequestInit) => {
    lastCall = { url, init };
    return await stub(url, init);
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

// ─── JSON extraction ─────────────────────────────────────────────────────────

describe("extractJSONFromModelOutput", () => {
  it("parses a clean JSON object", () => {
    const out = extractJSONFromModelOutput(goodModelOutput);
    expect(out).not.toBeNull();
    expect(out!["action"]).toBe("transfer");
  });

  it("parses JSON inside markdown fences", () => {
    const out = extractJSONFromModelOutput("```json\n" + goodModelOutput + "\n```");
    expect(out).not.toBeNull();
    expect(out!["recipient"]).toBe(RECIPIENT);
  });

  it("parses JSON with surrounding prose", () => {
    const out = extractJSONFromModelOutput("Sure! Here is the intent:\n" + goodModelOutput + " hope that helps");
    expect(out).not.toBeNull();
    expect(out!["amount"]).toBe(10);
  });

  it("returns null for text with no JSON object", () => {
    expect(extractJSONFromModelOutput("no json here")).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    expect(extractJSONFromModelOutput("{action: transfer")).toBeNull();
  });
});

// ─── Happy path ──────────────────────────────────────────────────────────────

describe("parsePlannerRequestWithLLM (OpenAI format)", () => {
  it("builds a validated intent from a well-formed LLM response", async () => {
    mockFetch(() => jsonResponse(200, openAIResponse(goodModelOutput)));

    const result = await parsePlannerRequestWithLLM({ ...BASEParams, llm: OPENAI_CONFIG });

    expect(result.success).toBe(true);
    expect(result.planner).toBe("llm");
    expect(result.intent).toBeDefined();
    expect(result.intent!.recipient.toLowerCase()).toBe(RECIPIENT.toLowerCase());
    expect(result.intent!.amount).toBe(parseUnits("10", 6));
    expect(result.intent!.functionSelector.toLowerCase()).toBe(TRANSFER_SELECTOR.toLowerCase());
    // Calldata is deterministically encoded — NOT taken from the model
    expect(result.intent!.calldata.toLowerCase()).toContain(RECIPIENT.slice(2).toLowerCase());
  });

  it("sends the system prompt and user instruction to the endpoint", async () => {
    mockFetch(() => jsonResponse(200, openAIResponse(goodModelOutput)));

    await parsePlannerRequestWithLLM({ ...BASEParams, llm: OPENAI_CONFIG });

    expect(lastCall).not.toBeNull();
    expect(lastCall!.url).toBe(OPENAI_CONFIG.endpointUrl);
    expect(lastCall!.init.method).toBe("POST");
    const headers = lastCall!.init.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer test-key");
    const body = JSON.parse(lastCall!.init.body as string);
    expect(body.model).toBe(OPENAI_CONFIG.model);
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[0].content).toBe(LLM_SYSTEM_PROMPT);
    expect(body.messages[1].content).toContain("send 10 USDC to");
  });

  it("strips markdown fences from model output", async () => {
    mockFetch(() =>
      jsonResponse(200, openAIResponse("```json\n" + goodModelOutput + "\n```")),
    );

    const result = await parsePlannerRequestWithLLM({ ...BASEParams, llm: OPENAI_CONFIG });
    expect(result.success).toBe(true);
    expect(result.intent).toBeDefined();
  });

  it("records the model + provenance in proposedBy", async () => {
    mockFetch(() => jsonResponse(200, openAIResponse(goodModelOutput)));

    const result = await parsePlannerRequestWithLLM({ ...BASEParams, llm: OPENAI_CONFIG });
    expect(result.intent!.proposedBy).toContain("llm-planner:gpt-4o-mini");
  });
});

// ─── Anthropic wire format ───────────────────────────────────────────────────

describe("parsePlannerRequestWithLLM (Anthropic format)", () => {
  it("uses x-api-key + anthropic-version headers and parses the text block", async () => {
    mockFetch(() => jsonResponse(200, anthropicResponse(goodModelOutput)));

    const result = await parsePlannerRequestWithLLM({ ...BASEParams, llm: ANTHROPIC_CONFIG });

    expect(result.success).toBe(true);
    expect(result.intent).toBeDefined();
    const headers = lastCall!.init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("test-key");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    const body = JSON.parse(lastCall!.init.body as string);
    expect(body.system).toBe(LLM_SYSTEM_PROMPT);
    expect(body.max_tokens).toBeGreaterThan(0);
  });

  it("rejects an Anthropic error status", async () => {
    mockFetch(() => jsonResponse(401, { error: { type: "authentication_error" } }));

    const result = await parsePlannerRequestWithLLM({ ...BASEParams, llm: ANTHROPIC_CONFIG });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/HTTP 401/);
    expect(result.intent).toBeUndefined();
  });
});

// ─── Validation failures: no intent is ever built ────────────────────────────

describe("parsePlannerRequestWithLLM (validation)", () => {
  it("rejects an invalid recipient (malformed address)", async () => {
    mockFetch(() =>
      jsonResponse(
        200,
        openAIResponse(
          JSON.stringify({ action: "transfer", recipient: "0xdeadbeef", amount: 10, token: "USDC" }),
        ),
      ),
    );

    const result = await parsePlannerRequestWithLLM({ ...BASEParams, llm: OPENAI_CONFIG });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/invalid recipient/i);
    expect(result.intent).toBeUndefined();
  });

  it("rejects a zero amount", async () => {
    mockFetch(() =>
      jsonResponse(
        200,
        openAIResponse(JSON.stringify({ action: "transfer", recipient: RECIPIENT, amount: 0, token: "USDC" })),
      ),
    );

    const result = await parsePlannerRequestWithLLM({ ...BASEParams, llm: OPENAI_CONFIG });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/invalid amount/i);
    expect(result.intent).toBeUndefined();
  });

  it("rejects a scientific-notation amount trick", async () => {
    mockFetch(() =>
      jsonResponse(
        200,
        openAIResponse(
          JSON.stringify({ action: "transfer", recipient: RECIPIENT, amount: "1e7", token: "USDC" }),
        ),
      ),
    );

    const result = await parsePlannerRequestWithLLM({ ...BASEParams, llm: OPENAI_CONFIG });
    expect(result.success).toBe(false);
    expect(result.intent).toBeUndefined();
  });

  it("rejects a mismatched token symbol", async () => {
    mockFetch(() =>
      jsonResponse(
        200,
        openAIResponse(JSON.stringify({ action: "transfer", recipient: RECIPIENT, amount: 10, token: "WETH" })),
      ),
    );

    const result = await parsePlannerRequestWithLLM({ ...BASEParams, llm: OPENAI_CONFIG });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/wrong token/i);
  });

  it("rejects an 'invalid' action (LLM could not parse)", async () => {
    mockFetch(() =>
      jsonResponse(
        200,
        openAIResponse(JSON.stringify({ action: "invalid", reason: "no address in message" })),
      ),
    );

    const result = await parsePlannerRequestWithLLM({ ...BASEParams, llm: OPENAI_CONFIG });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/could not parse/i);
  });

  it("fails when model output contains no JSON", async () => {
    mockFetch(() => jsonResponse(200, openAIResponse("I cannot help with that.")));

    const result = await parsePlannerRequestWithLLM({ ...BASEParams, llm: OPENAI_CONFIG });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/no parseable JSON/i);
    expect(result.rawModelOutput).toBe("I cannot help with that.");
  });

  it("fails on HTTP 500 with error detail", async () => {
    mockFetch(() => jsonResponse(500, { error: { message: "model overloaded" } }));

    const result = await parsePlannerRequestWithLLM({ ...BASEParams, llm: OPENAI_CONFIG });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/HTTP 500/);
    expect(result.error).toMatch(/model overloaded/);
  });

  it("fails on network error", async () => {
    mockFetch(() => {
      throw new TypeError("Network request failed");
    });

    const result = await parsePlannerRequestWithLLM({ ...BASEParams, llm: OPENAI_CONFIG });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/LLM request failed/);
  });
});

// ─── Injection resistance at the prompt level ────────────────────────────────

describe("validation (prompt injection resistance)", () => {
  it("an injected fake recipient in instruction text is ignored — only model output counts", async () => {
    // Model "obeys" the injection and coins a new recipient that is NOT validated context.
    // The planner still builds the intent, but the POLICY engine is the authority —
    // this test proves the planner passes through only the model's (recipient, amount)
    // pair and does not let the instruction text directly alter calldata.
    mockFetch(() =>
      jsonResponse(
        200,
        openAIResponse(
          JSON.stringify({
            action: "transfer",
            recipient: OTHER_ADDRESS,
            amount: 10,
            token: "USDC",
          }),
        ),
      ),
    );

    const result = await parsePlannerRequestWithLLM({ ...BASEParams, llm: OPENAI_CONFIG });
    expect(result.success).toBe(true);
    // The intent carries exactly what the model said — no more, no less.
    // It is the POLICY ENGINE's job to reject OTHER_ADDRESS (not in allowlist).
    expect(result.intent!.recipient.toLowerCase()).toBe(OTHER_ADDRESS.toLowerCase());
    expect(result.intent!.calldata.toLowerCase()).toContain(OTHER_ADDRESS.slice(2).toLowerCase());
  });
});

// ─── Fallback wrapper ────────────────────────────────────────────────────────

describe("parsePlannerRequestWithLLMFallback", () => {
  const FALLBACK_REQUEST = {
    instruction: `send 10 USDC to ${RECIPIENT} for fallback test`,
    chainId: CHAIN_ID,
    walletAddress: WALLET,
    tokenAddress: TOKEN,
    tokenDecimals: 6,
    tokenSymbol: "USDC",
    agentName: "test-agent",
  };

  it("uses the LLM when it succeeds", async () => {
    mockFetch(() => jsonResponse(200, openAIResponse(goodModelOutput)));

    const result = await parsePlannerRequestWithLLMFallback(FALLBACK_REQUEST, OPENAI_CONFIG);
    expect(result.success).toBe(true);
    expect(result.planner).toBe("llm");
  });

  it("falls back to the regex planner when the LLM errors", async () => {
    mockFetch(() => jsonResponse(500, { error: { message: "down" } }));

    const result = await parsePlannerRequestWithLLMFallback(FALLBACK_REQUEST, OPENAI_CONFIG);
    expect(result.success).toBe(true);
    expect(result.planner).toBe("regex");
    expect(result.intent).toBeDefined();
    expect(result.intent!.recipient.toLowerCase()).toBe(RECIPIENT.toLowerCase());
    expect(result.intent!.proposedBy).toBe("test-agent");
  });

  it("returns a failure when BOTH planners fail (unparseable instruction)", async () => {
    mockFetch(() => jsonResponse(500, { error: { message: "down" } }));

    const result = await parsePlannerRequestWithLLMFallback(
      { ...FALLBACK_REQUEST, instruction: "nonsense that no parser can read" },
      OPENAI_CONFIG,
    );
    expect(result.success).toBe(false);
    expect(result.planner).toBe("regex");
    expect(result.error).toMatch(/regex fallback/);
  });

  it("skips the LLM entirely when config is null", async () => {
    mockFetch(() => jsonResponse(200, openAIResponse(goodModelOutput)));

    const result = await parsePlannerRequestWithLLMFallback(FALLBACK_REQUEST, null);
    expect(result.success).toBe(true);
    expect(result.planner).toBe("regex");
    expect(lastCall).toBeNull(); // fetch never called
  });
});
