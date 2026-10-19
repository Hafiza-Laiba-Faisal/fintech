/**
 * Sentinel Wallet — Deterministic Policy Engine
 *
 * Evaluates a TransactionIntent against a fixed set of off-chain policy
 * checks. All checks are deterministic — no randomness, no LLM calls.
 *
 * IMPORTANT: These checks are OFF-CHAIN pre-flight validations.
 * The actual spending-limit, allowlist, and pause enforcement is
 * ON-CHAIN in the ERC-7579 hooks. This layer catches obvious violations
 * before spending gas on a doomed UserOp, and produces an audit record.
 *
 * What this module does NOT do:
 * - It does not replace on-chain hook enforcement.
 * - It does not read on-chain state (no RPC calls here).
 * - It does not sign anything.
 *
 * On-chain enforcement matrix (from code audit):
 *   SpendingLimitHook  → enforces per-token daily limits ON-CHAIN
 *   AllowlistHook      → enforces recipient allowlist ON-CHAIN
 *   EmergencyPauseHook → enforces pause state ON-CHAIN
 */

import type { Address } from "viem";
import type {
  TransactionIntent,
  PolicyDecision,
  PolicyCheckResult,
  PolicyCheckName,
} from "./types.js";
import { TRANSFER_SELECTOR } from "./intent.js";

// ─── Policy Config ────────────────────────────────────────────────────────────

export interface PolicyConfig {
  /** Chain ID this policy applies to */
  chainId: number;

  /** The wallet address this policy guards */
  walletAddress: Address;

  /** Approved recipient addresses — agent may only send to these */
  approvedRecipients: Address[];

  /**
   * Client-side daily spending limit in token's smallest unit.
   * This is a PRE-FLIGHT check — the on-chain SpendingLimitHook is the
   * authoritative enforcement. This catches obvious over-limit requests
   * before building a UserOp.
   */
  dailyLimitAmount: bigint;

  /**
   * Spent amount so far this period (tracked in-memory for mock/unit tests).
   * In a production system this would be read from on-chain state via
   * SpendingLimitHook.getRemainingAllowance().
   */
  spentSoFar?: bigint;

  /** Whether to treat the wallet as paused (for mock/test scenarios) */
  isPaused?: boolean;

  /**
   * Optional per-transaction ceiling (token's smallest unit). Enforced as a
   * separate PRE-FLIGHT check ("per_tx_ceiling") independent from the daily
   * limit. When unset (undefined / 0) the check passes with an advisory note.
   */
  perTxCeilingAmount?: bigint;
}

// ─── Used Intent IDs (in-memory replay protection) ───────────────────────────

/**
 * Tracks used intent IDs within this process lifetime.
 * Prevents the same intent from being executed twice.
 *
 * Scope: single process / single session.
 * Limitation: restarting the process clears this set. For production,
 * persist used IDs to a database or on-chain nonce mechanism.
 */
const _usedIntentIds = new Set<string>();

export function markIntentUsed(intentId: string): void {
  _usedIntentIds.add(intentId);
}

export function isIntentUsed(intentId: string): boolean {
  return _usedIntentIds.has(intentId);
}

/** For testing — reset the used-intents set */
export function _resetUsedIntents(): void {
  _usedIntentIds.clear();
}

// ─── Individual Policy Checks ─────────────────────────────────────────────────

function checkChainId(
  intent: TransactionIntent,
  config: PolicyConfig,
): PolicyCheckResult {
  const passed = intent.chainId === config.chainId;
  return {
    check: "chain_id",
    passed,
    detail: passed
      ? `Chain ID ${intent.chainId} matches policy`
      : `Chain ID mismatch: intent has ${intent.chainId}, policy requires ${config.chainId}`,
  };
}

function checkWalletBinding(
  intent: TransactionIntent,
  config: PolicyConfig,
): PolicyCheckResult {
  const passed =
    intent.walletAddress.toLowerCase() === config.walletAddress.toLowerCase();
  return {
    check: "wallet_binding",
    passed,
    detail: passed
      ? `Wallet binding confirmed: ${intent.walletAddress}`
      : `Wallet mismatch: intent targets ${intent.walletAddress}, policy guards ${config.walletAddress}`,
  };
}

function checkIntentExpiry(intent: TransactionIntent): PolicyCheckResult {
  const now = Math.floor(Date.now() / 1000);
  const passed = intent.expiresAt > now;
  return {
    check: "intent_expiry",
    passed,
    detail: passed
      ? `Intent valid until ${new Date(intent.expiresAt * 1000).toISOString()} (${intent.expiresAt - now}s remaining)`
      : `Intent expired at ${new Date(intent.expiresAt * 1000).toISOString()} (${now - intent.expiresAt}s ago)`,
  };
}

function checkIntentReplay(intent: TransactionIntent): PolicyCheckResult {
  const used = isIntentUsed(intent.intentId);
  return {
    check: "intent_id_replay",
    passed: !used,
    detail: used
      ? `Intent ID ${intent.intentId} has already been used — replay rejected`
      : `Intent ID ${intent.intentId} is fresh`,
  };
}

function checkAmountPositive(intent: TransactionIntent): PolicyCheckResult {
  const passed = intent.amount > 0n;
  return {
    check: "amount_positive",
    passed,
    detail: passed
      ? `Amount ${intent.amount} is positive`
      : `Amount must be positive, got ${intent.amount}`,
  };
}

function checkSelectorMatch(intent: TransactionIntent): PolicyCheckResult {
  const passed =
    intent.functionSelector.toLowerCase() === TRANSFER_SELECTOR.toLowerCase();
  return {
    check: "selector_match",
    passed,
    detail: passed
      ? `Function selector ${intent.functionSelector} matches ERC-20 transfer`
      : `Unexpected selector ${intent.functionSelector} — only ERC-20 transfer (${TRANSFER_SELECTOR}) is supported`,
  };
}

function checkRecipientAllowlist(
  intent: TransactionIntent,
  config: PolicyConfig,
): PolicyCheckResult {
  const approved = config.approvedRecipients.map((a) => a.toLowerCase());
  const passed = approved.includes(intent.recipient.toLowerCase());
  return {
    check: "recipient_allowlist",
    passed,
    detail: passed
      ? `Recipient ${intent.recipient} is in the approved list`
      : `Recipient ${intent.recipient} is NOT in the approved list. Approved: [${config.approvedRecipients.join(", ")}]`,
  };
}

function checkSpendingLimit(
  intent: TransactionIntent,
  config: PolicyConfig,
): PolicyCheckResult {
  const spent = config.spentSoFar ?? 0n;
  const remaining =
    spent >= config.dailyLimitAmount ? 0n : config.dailyLimitAmount - spent;
  const passed = intent.amount <= remaining;
  return {
    check: "spending_limit",
    passed,
    detail: passed
      ? `Amount ${intent.amount} fits within remaining limit ${remaining} (limit: ${config.dailyLimitAmount}, spent: ${spent})`
      : `Amount ${intent.amount} exceeds remaining limit ${remaining} (limit: ${config.dailyLimitAmount}, spent: ${spent})`,
  };
}

function checkPerTxCeiling(
  intent: TransactionIntent,
  config: PolicyConfig,
): PolicyCheckResult {
  const ceiling = config.perTxCeilingAmount ?? 0n;
  if (ceiling === 0n) {
    return {
      check: "per_tx_ceiling",
      passed: true,
      detail: "No per-transaction ceiling configured — daily limit governs",
    };
  }
  const passed = intent.amount <= ceiling;
  return {
    check: "per_tx_ceiling",
    passed,
    detail: passed
      ? `Amount ${intent.amount} fits within per-transaction ceiling ${ceiling}`
      : `Amount ${intent.amount} exceeds per-transaction ceiling ${ceiling}`,
  };
}

function checkWalletPaused(config: PolicyConfig): PolicyCheckResult {
  const paused = config.isPaused ?? false;
  return {
    check: "wallet_paused",
    passed: !paused,
    detail: paused
      ? "Wallet is currently paused by guardian — all transactions blocked"
      : "Wallet is active (not paused)",
  };
}

function checkCalldataIntegrity(intent: TransactionIntent): PolicyCheckResult {
  // Re-encode calldata deterministically from intent fields and compare.
  // Also verify targetContract matches tokenAddress (agent cannot redirect to another contract).
  // Selector (4 bytes) + recipient padded to 32 bytes + amount padded to 32 bytes.
  try {
    // Check 1: targetContract must equal tokenAddress
    if (intent.targetContract.toLowerCase() !== intent.tokenAddress.toLowerCase()) {
      return {
        check: "calldata_integrity",
        passed: false,
        detail: `Target contract ${intent.targetContract} does not match token address ${intent.tokenAddress}`,
      };
    }

    const selector = TRANSFER_SELECTOR.slice(2); // "a9059cbb"
    const recipientPadded = intent.recipient.slice(2).toLowerCase().padStart(64, "0");
    const amountHex = intent.amount.toString(16).padStart(64, "0");
    const expected = ("0x" + selector + recipientPadded + amountHex).toLowerCase();
    const actual = intent.calldata.toLowerCase();
    const passed = expected === actual;
    return {
      check: "calldata_integrity",
      passed,
      detail: passed
        ? "Calldata matches deterministic encoding of (recipient, amount)"
        : `Calldata mismatch: expected ${expected.slice(0, 18)}..., got ${actual.slice(0, 18)}...`,
    };
  } catch (e) {
    return {
      check: "calldata_integrity",
      passed: false,
      detail: `Calldata integrity check failed: ${(e as Error).message}`,
    };
  }
}

// ─── Main Policy Evaluation ───────────────────────────────────────────────────

/**
 * Evaluate a TransactionIntent against the Sentinel Wallet policy.
 *
 * Returns a PolicyDecision with all check results.
 * Checks run in order: earlier checks short-circuit on failure only for
 * critical structural checks (chain, wallet, expiry). All policy checks
 * are run and reported even if one fails.
 */
export function evaluateIntent(
  intent: TransactionIntent,
  config: PolicyConfig,
): PolicyDecision {
  const checks: PolicyCheckResult[] = [];

  // Run all checks
  checks.push(checkChainId(intent, config));
  checks.push(checkWalletBinding(intent, config));
  checks.push(checkIntentExpiry(intent));
  checks.push(checkIntentReplay(intent));
  checks.push(checkAmountPositive(intent));
  checks.push(checkSelectorMatch(intent));
  checks.push(checkCalldataIntegrity(intent));
  checks.push(checkRecipientAllowlist(intent, config));
  checks.push(checkSpendingLimit(intent, config));
  checks.push(checkPerTxCeiling(intent, config));
  checks.push(checkWalletPaused(config));

  // Find first failure
  const failed = checks.find((c) => !c.passed);

  const now = Math.floor(Date.now() / 1000);

  // ── Deterministic risk level (advisory only) ─────────────────────────────────
  // Maps the failed check (or approval) to a stable risk tier. This never
  // overrides status — enforcement is status, not riskLevel.
  const HIGH_RISK_CHECKS: ReadonlySet<string> = new Set([
    "recipient_allowlist",
    "calldata_integrity",
    "selector_match",
    "chain_id",
    "wallet_binding",
    "intent_id_replay",
    "wallet_paused",
    "amount_positive",
  ]);

  if (failed) {
    return {
      intentId: intent.intentId,
      status: "rejected",
      riskLevel: HIGH_RISK_CHECKS.has(failed.check) ? "high" : "medium",
      reason: failed.detail,
      failedCheck: failed.check as PolicyCheckName,
      checks,
      decidedAt: now,
    };
  }

  return {
    intentId: intent.intentId,
    status: "approved",
    riskLevel: "low",
    reason: `All ${checks.length} policy checks passed`,
    checks,
    decidedAt: now,
  };
}
