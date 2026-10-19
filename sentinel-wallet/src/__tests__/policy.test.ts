/**
 * Tests: Deterministic Policy Engine
 * Environment: Unit (no network, no mocks needed)
 *
 * Verifies every policy check in evaluateIntent():
 *   chain_id, wallet_binding, intent_expiry, intent_id_replay,
 *   amount_positive, selector_match, calldata_integrity,
 *   recipient_allowlist, spending_limit, wallet_paused
 */

import { describe, it, expect, beforeEach } from "vitest";
import { parseUnits, type Address, type Hex } from "viem";
import { buildTransferIntent, TRANSFER_SELECTOR } from "../intent.js";
import {
  evaluateIntent,
  _resetUsedIntents,
  markIntentUsed,
  type PolicyConfig,
} from "../policy.js";
import type { TransactionIntent } from "../types.js";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const CHAIN_ID = 84532;
const WALLET: Address   = "0x1111111111111111111111111111111111111111";
const TOKEN: Address    = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
// Real checksummed EIP-55 addresses
const RECIPIENT: Address = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const BLOCKED: Address   = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
const AMOUNT = parseUnits("10", 6); // 10 USDC
const DAILY_LIMIT = parseUnits("100", 6); // 100 USDC

function makeIntent(overrides: Partial<TransactionIntent> = {}): TransactionIntent {
  const base = buildTransferIntent({
    chainId: CHAIN_ID,
    walletAddress: WALLET,
    tokenAddress: TOKEN,
    recipient: RECIPIENT,
    amount: AMOUNT,
    amountHuman: "10 USDC",
  });
  return { ...base, ...overrides };
}

function makePolicy(overrides: Partial<PolicyConfig> = {}): PolicyConfig {
  return {
    chainId: CHAIN_ID,
    walletAddress: WALLET,
    approvedRecipients: [RECIPIENT],
    dailyLimitAmount: DAILY_LIMIT,
    spentSoFar: 0n,
    isPaused: false,
    ...overrides,
  };
}

beforeEach(() => {
  _resetUsedIntents();
});

// ─── Happy Path ───────────────────────────────────────────────────────────────

describe("evaluateIntent — happy path", () => {
  it("approves a valid intent that passes all checks", () => {
    const decision = evaluateIntent(makeIntent(), makePolicy());
    expect(decision.status).toBe("approved");
    expect(decision.failedCheck).toBeUndefined();
    expect(decision.checks.every((c) => c.passed)).toBe(true);
  });

  it("decision contains all 11 check results", () => {
    const decision = evaluateIntent(makeIntent(), makePolicy());
    expect(decision.checks).toHaveLength(11);
  });

  it("approved decision has a decidedAt timestamp", () => {
    const before = Math.floor(Date.now() / 1000);
    const decision = evaluateIntent(makeIntent(), makePolicy());
    const after = Math.floor(Date.now() / 1000);
    expect(decision.decidedAt).toBeGreaterThanOrEqual(before);
    expect(decision.decidedAt).toBeLessThanOrEqual(after);
  });
});

// ─── chain_id ─────────────────────────────────────────────────────────────────

describe("check: chain_id", () => {
  it("rejects when intent chain ID does not match policy", () => {
    const intent = makeIntent({ chainId: 1 }); // mainnet
    const decision = evaluateIntent(intent, makePolicy());
    expect(decision.status).toBe("rejected");
    expect(decision.failedCheck).toBe("chain_id");
    expect(decision.reason).toMatch(/chain id mismatch/i);
  });

  it("passes when chain IDs match", () => {
    const decision = evaluateIntent(makeIntent({ chainId: CHAIN_ID }), makePolicy());
    const chainCheck = decision.checks.find((c) => c.check === "chain_id");
    expect(chainCheck?.passed).toBe(true);
  });
});

// ─── wallet_binding ───────────────────────────────────────────────────────────

describe("check: wallet_binding", () => {
  it("rejects when intent walletAddress does not match policy", () => {
    const intent = makeIntent({
      walletAddress: "0x2222222222222222222222222222222222222222" as Address,
    });
    const decision = evaluateIntent(intent, makePolicy());
    expect(decision.status).toBe("rejected");
    expect(decision.failedCheck).toBe("wallet_binding");
  });

  it("passes with matching wallet address (case-insensitive)", () => {
    const intent = makeIntent({ walletAddress: WALLET.toLowerCase() as Address });
    const decision = evaluateIntent(intent, makePolicy({ walletAddress: WALLET.toUpperCase() as Address }));
    const check = decision.checks.find((c) => c.check === "wallet_binding");
    expect(check?.passed).toBe(true);
  });
});

// ─── intent_expiry ────────────────────────────────────────────────────────────

describe("check: intent_expiry", () => {
  it("rejects an expired intent", () => {
    const intent = makeIntent({
      expiresAt: Math.floor(Date.now() / 1000) - 1,
    });
    const decision = evaluateIntent(intent, makePolicy());
    expect(decision.status).toBe("rejected");
    expect(decision.failedCheck).toBe("intent_expiry");
    expect(decision.reason).toMatch(/expired/i);
  });

  it("rejects an intent expiring exactly at epoch 0", () => {
    const intent = makeIntent({ expiresAt: 0 });
    const decision = evaluateIntent(intent, makePolicy());
    expect(decision.failedCheck).toBe("intent_expiry");
  });

  it("approves an intent expiring 1 second from now", () => {
    const intent = makeIntent({
      expiresAt: Math.floor(Date.now() / 1000) + 1,
    });
    const decision = evaluateIntent(intent, makePolicy());
    const check = decision.checks.find((c) => c.check === "intent_expiry");
    expect(check?.passed).toBe(true);
  });
});

// ─── intent_id_replay ────────────────────────────────────────────────────────

describe("check: intent_id_replay", () => {
  it("rejects a replayed intent ID", () => {
    const intent = makeIntent();
    markIntentUsed(intent.intentId);
    const decision = evaluateIntent(intent, makePolicy());
    expect(decision.status).toBe("rejected");
    expect(decision.failedCheck).toBe("intent_id_replay");
    expect(decision.reason).toMatch(/replay/i);
  });

  it("approves a fresh intent ID", () => {
    const intent = makeIntent();
    const decision = evaluateIntent(intent, makePolicy());
    const check = decision.checks.find((c) => c.check === "intent_id_replay");
    expect(check?.passed).toBe(true);
  });

  it("different intents with different IDs do not interfere", () => {
    const i1 = makeIntent();
    const i2 = makeIntent();
    expect(i1.intentId).not.toBe(i2.intentId);
    markIntentUsed(i1.intentId);
    // i2 should still pass
    const decision = evaluateIntent(i2, makePolicy());
    const check = decision.checks.find((c) => c.check === "intent_id_replay");
    expect(check?.passed).toBe(true);
  });
});

// ─── amount_positive ──────────────────────────────────────────────────────────

describe("check: amount_positive", () => {
  it("rejects zero amount", () => {
    // buildTransferIntent throws on 0n — test directly via policy check
    // by constructing the object manually
    const base = makeIntent();
    const intent: TransactionIntent = { ...base, amount: 0n };
    const decision = evaluateIntent(intent, makePolicy());
    expect(decision.status).toBe("rejected");
    expect(decision.failedCheck).toBe("amount_positive");
  });

  it("approves positive amount", () => {
    const decision = evaluateIntent(makeIntent({ amount: 1n }), makePolicy({
      dailyLimitAmount: parseUnits("1000", 6),
    }));
    const check = decision.checks.find((c) => c.check === "amount_positive");
    expect(check?.passed).toBe(true);
  });
});

// ─── selector_match ───────────────────────────────────────────────────────────

describe("check: selector_match", () => {
  it("rejects non-transfer selector", () => {
    const intent = makeIntent({ functionSelector: "0x00000000" as Hex });
    const decision = evaluateIntent(intent, makePolicy());
    expect(decision.status).toBe("rejected");
    expect(decision.failedCheck).toBe("selector_match");
  });

  it("approves the ERC-20 transfer selector", () => {
    const decision = evaluateIntent(makeIntent(), makePolicy());
    const check = decision.checks.find((c) => c.check === "selector_match");
    expect(check?.passed).toBe(true);
  });
});

// ─── calldata_integrity ───────────────────────────────────────────────────────

describe("check: calldata_integrity", () => {
  it("rejects tampered calldata (wrong recipient)", () => {
    const intent = makeIntent();
    const badRecipient = BLOCKED.slice(2).padStart(64, "0");
    const amountHex = AMOUNT.toString(16).padStart(64, "0");
    const tampered = ("0x" + TRANSFER_SELECTOR.slice(2) + badRecipient + amountHex) as Hex;
    const tamperedIntent: TransactionIntent = { ...intent, calldata: tampered };
    const decision = evaluateIntent(tamperedIntent, makePolicy());
    expect(decision.status).toBe("rejected");
    expect(decision.failedCheck).toBe("calldata_integrity");
    expect(decision.reason).toMatch(/calldata mismatch/i);
  });

  it("rejects tampered calldata (wrong amount)", () => {
    const intent = makeIntent();
    const recipientPadded = RECIPIENT.slice(2).padStart(64, "0");
    const badAmount = parseUnits("999", 6).toString(16).padStart(64, "0");
    const tampered = ("0x" + TRANSFER_SELECTOR.slice(2) + recipientPadded + badAmount) as Hex;
    const tamperedIntent: TransactionIntent = { ...intent, calldata: tampered };
    const decision = evaluateIntent(tamperedIntent, makePolicy());
    expect(decision.failedCheck).toBe("calldata_integrity");
  });

  it("passes when calldata matches deterministic encoding", () => {
    const decision = evaluateIntent(makeIntent(), makePolicy());
    const check = decision.checks.find((c) => c.check === "calldata_integrity");
    expect(check?.passed).toBe(true);
  });
});

// ─── recipient_allowlist ──────────────────────────────────────────────────────

describe("check: recipient_allowlist", () => {
  it("rejects transfer to address not in approved list", () => {
    const intent = makeIntent({ recipient: BLOCKED });
    // Also fix calldata for this recipient so we bypass calldata_integrity check
    const selector = TRANSFER_SELECTOR.slice(2);
    const recipientPadded = BLOCKED.slice(2).toLowerCase().padStart(64, "0");
    const amountHex = AMOUNT.toString(16).padStart(64, "0");
    const calldata = ("0x" + selector + recipientPadded + amountHex) as Hex;
    const intentWithCorrectCalldata: TransactionIntent = { ...intent, calldata };
    const decision = evaluateIntent(intentWithCorrectCalldata, makePolicy());
    expect(decision.status).toBe("rejected");
    expect(decision.failedCheck).toBe("recipient_allowlist");
    expect(decision.reason).toMatch(/not in the approved list/i);
  });

  it("approves transfer to approved recipient", () => {
    const decision = evaluateIntent(makeIntent(), makePolicy());
    const check = decision.checks.find((c) => c.check === "recipient_allowlist");
    expect(check?.passed).toBe(true);
  });

  it("allowlist check is case-insensitive", () => {
    const intentLower = makeIntent({ recipient: RECIPIENT.toLowerCase() as Address });
    // Fix calldata to match lowercase recipient
    const selector = TRANSFER_SELECTOR.slice(2);
    const recipientPadded = RECIPIENT.toLowerCase().slice(2).padStart(64, "0");
    const amountHex = AMOUNT.toString(16).padStart(64, "0");
    const calldata = ("0x" + selector + recipientPadded + amountHex) as Hex;
    const intent: TransactionIntent = { ...intentLower, calldata };
    const decision = evaluateIntent(intent, makePolicy({ approvedRecipients: [RECIPIENT.toUpperCase() as Address] }));
    const check = decision.checks.find((c) => c.check === "recipient_allowlist");
    expect(check?.passed).toBe(true);
  });
});

// ─── spending_limit ───────────────────────────────────────────────────────────

describe("check: spending_limit", () => {
  it("rejects when amount exceeds remaining limit", () => {
    const intent = makeIntent({ amount: parseUnits("150", 6) });
    const selector = TRANSFER_SELECTOR.slice(2);
    const recipientPadded = RECIPIENT.slice(2).padStart(64, "0");
    const amountHex = parseUnits("150", 6).toString(16).padStart(64, "0");
    const calldata = ("0x" + selector + recipientPadded + amountHex) as Hex;
    const i: TransactionIntent = { ...intent, calldata };
    const decision = evaluateIntent(i, makePolicy());
    expect(decision.status).toBe("rejected");
    expect(decision.failedCheck).toBe("spending_limit");
    expect(decision.reason).toMatch(/exceeds remaining limit/i);
  });

  it("rejects when cumulative spend would exceed limit", () => {
    // Already spent 95 USDC, trying to spend 10 more (total 105 > 100)
    const intent = makeIntent(); // 10 USDC
    const decision = evaluateIntent(
      intent,
      makePolicy({ spentSoFar: parseUnits("95", 6) }),
    );
    expect(decision.status).toBe("rejected");
    expect(decision.failedCheck).toBe("spending_limit");
  });

  it("approves when amount equals remaining limit exactly", () => {
    // Limit 100, spent 90, attempting 10 — exactly fits
    const decision = evaluateIntent(
      makeIntent(),
      makePolicy({ spentSoFar: parseUnits("90", 6) }),
    );
    const check = decision.checks.find((c) => c.check === "spending_limit");
    expect(check?.passed).toBe(true);
  });

  it("approves when spentSoFar is 0 and amount is within limit", () => {
    const decision = evaluateIntent(makeIntent(), makePolicy({ spentSoFar: 0n }));
    const check = decision.checks.find((c) => c.check === "spending_limit");
    expect(check?.passed).toBe(true);
  });
});

// ─── per_tx_ceiling ───────────────────────────────────────────────────────

describe("check: per_tx_ceiling", () => {
  it("rejects when amount exceeds the per-transaction ceiling", () => {
    const decision = evaluateIntent(
      makeIntent(), // 10 USDC
      makePolicy({ perTxCeilingAmount: parseUnits("5", 6) }),
    );
    expect(decision.status).toBe("rejected");
    expect(decision.failedCheck).toBe("per_tx_ceiling");
    expect(decision.riskLevel).toBe("medium");
    expect(decision.reason).toMatch(/per-transaction ceiling/i);
  });

  it("approves when amount fits within the ceiling", () => {
    const decision = evaluateIntent(
      makeIntent(),
      makePolicy({ perTxCeilingAmount: parseUnits("50", 6) }),
    );
    const check = decision.checks.find((c) => c.check === "per_tx_ceiling");
    expect(check?.passed).toBe(true);
  });

  it("approves with advisory note when no ceiling is configured", () => {
    const decision = evaluateIntent(makeIntent(), makePolicy());
    const check = decision.checks.find((c) => c.check === "per_tx_ceiling");
    expect(check?.passed).toBe(true);
    expect(check?.detail).toMatch(/no per-transaction ceiling configured/i);
  });

  it("enforces the ceiling even when the daily limit would allow more", () => {
    // Daily limit 100 allows 10, but a per-tx ceiling of 2 blocks it first
    const decision = evaluateIntent(
      makeIntent(),
      makePolicy({ perTxCeilingAmount: parseUnits("2", 6) }),
    );
    expect(decision.status).toBe("rejected");
    expect(decision.failedCheck).toBe("per_tx_ceiling");
    const spendingCheck = decision.checks.find((c) => c.check === "spending_limit");
    expect(spendingCheck?.passed).toBe(true); // daily limit fine; ceiling is stricter
  });

  it("approves an amount EXACTLY equal to the ceiling (<= boundary)", () => {
    const decision = evaluateIntent(
      makeIntent(), // 10 USDC
      makePolicy({ perTxCeilingAmount: parseUnits("10", 6) }),
    );
    const check = decision.checks.find((c) => c.check === "per_tx_ceiling");
    expect(check?.passed).toBe(true);
    expect(decision.status).toBe("approved");
  });

  it("enforces token-unit precision: 1 wei above the ceiling is rejected", () => {
    // Ceiling = 5.000000 USDC; attempt 5.000001 USDC (smallest-unit step)
    const intent = makeIntent({ amount: 5_000001n });
    // Re-encode calldata so calldata_integrity does not fail first —
    // isolating the ceiling boundary itself
    const selector = TRANSFER_SELECTOR.slice(2);
    const recipientPadded = RECIPIENT.slice(2).toLowerCase().padStart(64, "0");
    const calldata = ("0x" + selector + recipientPadded + 5000001n.toString(16).padStart(64, "0")) as Hex;
    const decision = evaluateIntent(
      { ...intent, amount: 5000001n, calldata },
      makePolicy({ perTxCeilingAmount: 5_000000n }),
    );
    expect(decision.failedCheck).toBe("per_tx_ceiling");
  });

  it("amount checked by policy is the amount bound to execution", () => {
    // The intent amount is embedded in deterministic calldata; the
    // calldata_integrity check ties them: change one without the other
    // and the intent is rejected before execution.
    const intent = makeIntent();
    // Attempt to swap a bigger amount into calldata while leaving intent.amount intact
    const selector = TRANSFER_SELECTOR.slice(2);
    const recipientPadded = RECIPIENT.slice(2).toLowerCase().padStart(64, "0");
    const tamperedCalldata = ("0x" + selector + recipientPadded + parseUnits("999", 6).toString(16).padStart(64, "0")) as Hex;
    const decision = evaluateIntent(
      { ...intent, calldata: tamperedCalldata },
      makePolicy({ perTxCeilingAmount: parseUnits("50", 6) }), // ceiling would allow 999's per-tx? no—but daily allows too
    );
    expect(decision.failedCheck).toBe("calldata_integrity");
    expect(decision.status).toBe("rejected");
  });
});

// ─── riskLevel (advisory, deterministic) ─────────────────────────────────────────

describe("riskLevel — advisory risk tiers", () => {
  it("approved decisions always carry riskLevel 'low'", () => {
    const decision = evaluateIntent(makeIntent(), makePolicy());
    expect(decision.status).toBe("approved");
    expect(decision.riskLevel).toBe("low");
  });

  it("hard security rejections map to 'high'", () => {
    const cases: Array<Partial<TransactionIntent> | null> = [
      { recipient: BLOCKED }, // recipient_allowlist
      { functionSelector: "0x00000000" as Hex }, // selector_match
    ];
    for (const override of cases) {
      if (!override) continue;
      const base = buildTransferIntent({
        chainId: CHAIN_ID,
        walletAddress: WALLET,
        tokenAddress: TOKEN,
        recipient: override.recipient ?? RECIPIENT,
        amount: AMOUNT,
        amountHuman: "10 USDC",
      });
      const intent: TransactionIntent = { ...base, ...override };
      const decision = evaluateIntent(intent, makePolicy());
      expect(decision.status).toBe("rejected");
      expect(decision.riskLevel).toBe("high");
    }
  });

  it("limit-type rejections map to 'medium'", () => {
    const decision = evaluateIntent(
      makeIntent(),
      makePolicy({ spentSoFar: parseUnits("95", 6) }),
    );
    expect(decision.failedCheck).toBe("spending_limit");
    expect(decision.riskLevel).toBe("medium");
  });

  it("riskLevel never overrides a rejection or an approval", () => {
    // A deterministic invariant: status is the sole enforcement signal.
    const approved = evaluateIntent(makeIntent(), makePolicy());
    expect(approved.status).toBe("approved"); // low risk does not mean auto-allow change
    const rejected = evaluateIntent(makeIntent({ chainId: 1 }), makePolicy());
    expect(rejected.status).toBe("rejected"); // advisory risk cannot revive a rejected intent
  });
});

// ─── wallet_paused ────────────────────────────────────────────────────────────

describe("check: wallet_paused", () => {
  it("rejects all intents when wallet is paused", () => {
    const decision = evaluateIntent(makeIntent(), makePolicy({ isPaused: true }));
    expect(decision.status).toBe("rejected");
    expect(decision.failedCheck).toBe("wallet_paused");
    expect(decision.reason).toMatch(/paused/i);
  });

  it("approves when wallet is not paused", () => {
    const decision = evaluateIntent(makeIntent(), makePolicy({ isPaused: false }));
    const check = decision.checks.find((c) => c.check === "wallet_paused");
    expect(check?.passed).toBe(true);
  });
});
