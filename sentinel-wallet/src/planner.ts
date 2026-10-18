/**
 * Sentinel Wallet — Deterministic (Regex) AI Agent Planner
 *
 * Produces structured TransactionIntent objects from natural-language-style
 * user requests. This is the FALLBACK planner: the real LLM planner lives in
 * src/llm-planner.ts (see parsePlannerRequestWithLLMFallback for the
 * LLM-first entry point). The regex planner keeps the demo reproducible
 * without any API key, and serves as the fallback when an LLM call fails.
 *
 * SECURITY PROPERTY (identical for both planners):
 *   The planner output is UNTRUSTED INPUT to the policy engine. Whether the
 *   (recipient, amount) pair comes from regex extraction or a live LLM call,
 *   every policy check (allowlist, spending limit, expiry, replay, integrity)
 *   runs unchanged. The planner is not part of the enforcement stack.
 *
 * LLM INTEGRATION NOTE (from repository audit):
 * ─────────────────────────────────────────────
 * SmartAgentKit ships two LLM-powered examples:
 *
 *   defi-trading-agent  → @langchain/openai   (ChatOpenAI, model: "gpt-4o")
 *                          Env var: OPENAI_API_KEY
 *                          Source: apps/examples/defi-trading-agent/src/agent.ts
 *
 *   treasury-management → @langchain/anthropic (ChatAnthropic, model: "claude-sonnet-4-20250514")
 *                          Env var: ANTHROPIC_API_KEY
 *                          Source: apps/examples/treasury-management-agent/src/agent.ts
 *
 * Both use @smartagentkit/langchain (createSmartAgentKitTools) as the
 * bridge between the LLM and the SDK. Neither LLM key is required for the
 * Sentinel Wallet MVP — the planner below is deterministic.
 *
 * To add a real LLM: swap parsePlannerRequest() with an async call to
 * ChatOpenAI or ChatAnthropic, keeping all downstream policy/integrity
 * checks unchanged. The agent NEVER bypasses the policy engine.
 */

import { parseUnits, type Address } from "viem";
import { buildTransferIntent, type BuildIntentParams } from "./intent.js";
import type { TransactionIntent } from "./types.js";

// ─── Request Schema ───────────────────────────────────────────────────────────

export interface PlannerRequest {
  /** Natural-language instruction from the user or agent */
  instruction: string;

  /** Chain ID the agent is operating on */
  chainId: number;

  /** The smart wallet address */
  walletAddress: Address;

  /** Token contract the agent should use */
  tokenAddress: Address;

  /** Token decimals (e.g., 6 for USDC) */
  tokenDecimals: number;

  /** Token symbol for display */
  tokenSymbol: string;

  /** Who proposed this (agent name) */
  agentName?: string;
}

export interface PlannerResult {
  /** Whether the planner could parse the request */
  success: boolean;

  /** The parsed intent (if success) */
  intent?: TransactionIntent;

  /** What the planner understood */
  parsedAction?: string;

  /** Reason for failure (if !success) */
  error?: string;

  /** Which planner produced this result (provenance — set by both planners) */
  planner?: "regex" | "llm";
}

// ─── Simulated Planner ────────────────────────────────────────────────────────

/**
 * Parse a natural-language transfer request into a structured intent.
 *
 * Supported patterns:
 *   "send 10 USDC to 0xRecipient"
 *   "transfer 50.5 USDC to 0xRecipient for payroll"
 *   "pay 0xRecipient 25 USDC"
 *
 * The planner CANNOT specify calldata directly — it only specifies
 * (recipient, amount). Calldata is constructed in buildTransferIntent().
 */
export function parsePlannerRequest(
  request: PlannerRequest,
): PlannerResult {
  const { instruction, chainId, walletAddress, tokenAddress, tokenDecimals, tokenSymbol, agentName } =
    request;

  const text = instruction.toLowerCase().trim();

  // ── Pattern 1: "send/transfer/pay <amount> <token> to <address> [for <reason>]"
  const pattern1 =
    /(?:send|transfer|pay)\s+([\d.]+)\s+\w+\s+to\s+(0x[0-9a-fA-F]{40})(?:\s+for\s+(.+))?/i;

  // ── Pattern 2: "pay <address> <amount> <token> [for <reason>]"
  const pattern2 =
    /pay\s+(0x[0-9a-fA-F]{40})\s+([\d.]+)\s+\w+(?:\s+for\s+(.+))?/i;

  let recipient: Address | undefined;
  let amountStr: string | undefined;
  let reason: string | undefined;

  const m1 = text.match(pattern1);
  const m2 = text.match(pattern2);

  if (m1) {
    amountStr = m1[1];
    recipient = m1[2] as Address;
    reason = m1[3];
  } else if (m2) {
    recipient = m2[1] as Address;
    amountStr = m2[2];
    reason = m2[3];
  } else {
    return {
      success: false,
      error: `Could not parse instruction: "${instruction}". ` +
        `Expected: "send <amount> ${tokenSymbol} to <address>" or "pay <address> <amount> ${tokenSymbol}"`,
    };
  }

  // Parse amount
  if (amountStr === undefined) {
    return {
      success: false,
      error: `Invalid amount: undefined`,
    };
  }
  let amount: bigint;
  try {
    amount = parseUnits(amountStr, tokenDecimals);
  } catch {
    return {
      success: false,
      error: `Invalid amount: "${amountStr}"`,
    };
  }

  const params: BuildIntentParams = {
    chainId,
    walletAddress,
    tokenAddress,
    recipient: recipient as Address,
    amount,
    amountHuman: `${amountStr} ${tokenSymbol}`,
    ttlSeconds: 300,
    proposedBy: agentName ?? "simulated-planner",
    reason: reason ?? `Agent-initiated ${tokenSymbol} transfer`,
  };

  try {
    const intent = buildTransferIntent(params);
    return {
      success: true,
      intent,
      parsedAction: `Transfer ${amountStr} ${tokenSymbol} to ${recipient}`,
      planner: "regex" as const,
    };
  } catch (e) {
    return {
      success: false,
      error: `Failed to build intent: ${(e as Error).message}`,
    };
  }
}

// ─── Scripted Demo Scenarios ──────────────────────────────────────────────────

/**
 * Pre-built demo scenarios for the competition demonstration.
 * Each scenario is a deterministic planner request that demonstrates
 * a specific policy outcome.
 */
export function getDemoScenarios(
  walletAddress: Address,
  approvedRecipient: Address,
  blockedRecipient: Address,
  tokenAddress: Address,
  chainId: number,
): DemoScenario[] {
  const base: Omit<PlannerRequest, "instruction"> = {
    chainId,
    walletAddress,
    tokenAddress,
    tokenDecimals: 6,
    tokenSymbol: "USDC",
    agentName: "sentinel-demo-agent",
  };

  return [
    {
      name: "✅  Happy Path — Approved Transfer",
      description: "10 USDC to approved recipient within daily limit",
      request: {
        ...base,
        instruction: `send 10 USDC to ${approvedRecipient} for competition demo`,
      },
      expectedOutcome: "approved",
    },
    {
      name: "❌  REJECTED — Spending Limit Exceeded",
      description: "150 USDC transfer when daily limit is 100 USDC",
      request: {
        ...base,
        instruction: `send 150 USDC to ${approvedRecipient} for bulk payment`,
      },
      expectedOutcome: "rejected",
      expectedCheck: "spending_limit",
    },
    {
      name: "❌  REJECTED — Unapproved Recipient",
      description: "Transfer to address not in the allowlist",
      request: {
        ...base,
        instruction: `send 10 USDC to ${blockedRecipient} for test`,
      },
      expectedOutcome: "rejected",
      expectedCheck: "recipient_allowlist",
    },
    {
      name: "❌  REJECTED — Expired Intent",
      description: "Intent whose TTL has already elapsed",
      request: {
        ...base,
        instruction: `send 5 USDC to ${approvedRecipient} for delayed payment`,
      },
      expectedOutcome: "rejected",
      expectedCheck: "intent_expiry",
      // Demo runner artificially backdates the intent
      backdateSeconds: 400,
    },
    {
      name: "❌  REJECTED — Intent Replay",
      description: "Same intent submitted a second time",
      request: {
        ...base,
        instruction: `send 10 USDC to ${approvedRecipient} for replay test`,
      },
      expectedOutcome: "rejected",
      expectedCheck: "intent_id_replay",
      // Demo runner executes this intent twice
      replayIntent: true,
    },
    {
      name: "❌  REJECTED — Tampered Calldata (TPDR)",
      description:
        "Calldata replaced with different recipient after intent approval",
      request: {
        ...base,
        instruction: `send 10 USDC to ${approvedRecipient} for tamper test`,
      },
      expectedOutcome: "rejected",
      expectedCheck: "calldata_integrity",
      // Demo runner manually replaces calldata after building
      tamperCalldata: true,
      tamperedRecipient: blockedRecipient,
    },
    {
      name: "❌  REJECTED — Wallet Paused",
      description: "Guardian pauses wallet; all transfers blocked",
      request: {
        ...base,
        instruction: `send 10 USDC to ${approvedRecipient} after pause`,
      },
      expectedOutcome: "rejected",
      expectedCheck: "wallet_paused",
    },
  ];
}

export interface DemoScenario {
  name: string;
  description: string;
  request: PlannerRequest;
  expectedOutcome: "approved" | "rejected";
  expectedCheck?: string;
  backdateSeconds?: number;
  replayIntent?: boolean;
  tamperCalldata?: boolean;
  tamperedRecipient?: Address;
}
