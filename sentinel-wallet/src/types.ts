/**
 * Sentinel Wallet — Core Types
 *
 * All types used across intent validation, policy checks, and execution.
 */

import type { Address, Hex } from "viem";

// ─── Transaction Intent ──────────────────────────────────────────────────────

/**
 * A structured, typed representation of a transaction intent proposed by the
 * AI agent. This is the INPUT to the policy engine — not the final UserOp.
 *
 * The intent is validated, policy-checked, and then used to construct the
 * actual transaction. The final calldata is compared against the intent
 * before the UserOp is submitted.
 *
 * Design note: The intent captures exactly what the agent WANTS to do.
 * The TPDR layer verifies that what gets EXECUTED matches this exactly.
 */
export interface TransactionIntent {
  /** Unique identifier for this intent — prevents replay */
  intentId: string;

  /** Chain ID — must match the deployed wallet's chain */
  chainId: number;

  /** The smart wallet address that will execute the transaction */
  walletAddress: Address;

  /** Target contract (e.g., USDC contract address) */
  targetContract: Address;

  /** ERC-20 function selector being called */
  functionSelector: Hex; // e.g. "0xa9059cbb" for transfer(address,uint256)

  /** Token contract address (same as targetContract for ERC-20 transfers) */
  tokenAddress: Address;

  /** Recipient of the ERC-20 transfer */
  recipient: Address;

  /** Transfer amount in token's smallest unit (e.g., wei for ETH, 6-decimal units for USDC) */
  amount: bigint;

  /** Human-readable amount string for display (e.g., "10 USDC") */
  amountHuman: string;

  /** The exact ABI-encoded calldata — deterministically constructed from intent fields */
  calldata: Hex;

  /** Unix timestamp after which this intent is rejected (seconds) */
  expiresAt: number;

  /** ISO 8601 timestamp when the intent was created */
  createdAt: string;

  /** The AI agent or planner that proposed this intent */
  proposedBy: string;

  /** Human-readable reason for the transfer */
  reason: string;
}

// ─── Policy Decision ─────────────────────────────────────────────────────────

export type PolicyDecisionStatus = "approved" | "rejected";

/**
 * The deterministic policy engine's verdict on a TransactionIntent.
 * Produced before any transaction is constructed or submitted.
 */
export interface PolicyDecision {
  /** The intent this decision applies to */
  intentId: string;

  /** Whether the intent was approved or rejected */
  status: PolicyDecisionStatus;

  /** Human-readable reason for the decision */
  reason: string;

  /** Which policy check caused a rejection (if applicable) */
  failedCheck?: PolicyCheckName;

  /** All checks that were performed and their results */
  checks: PolicyCheckResult[];

  /** Unix timestamp when the decision was made */
  decidedAt: number;
}

export type PolicyCheckName =
  | "chain_id"
  | "wallet_binding"
  | "intent_expiry"
  | "intent_id_replay"
  | "recipient_allowlist"
  | "spending_limit"
  | "wallet_paused"
  | "calldata_integrity"
  | "amount_positive"
  | "selector_match";

export interface PolicyCheckResult {
  check: PolicyCheckName;
  passed: boolean;
  detail: string;
}

// ─── TPDR Record ─────────────────────────────────────────────────────────────

/**
 * Tamper-Evident Policy Decision Record (TPDR).
 *
 * Captures the complete audit trail for one transaction:
 *   intent → policy decision → execution (if approved).
 *
 * Security guarantee: the "executedCalldata" field is decoded from the
 * final UserOp BEFORE submission, then compared field-by-field against
 * the approved intent. A mismatch causes the submission to be aborted.
 *
 * Limitation: this comparison is off-chain. It catches SDK-level calldata
 * mutation and programming errors. It does not prevent a malicious bundler
 * from submitting a different UserOp after the SDK builds it. See docs/
 * security-model.md for the full threat model.
 */
export interface TPDRRecord {
  /** The original intent */
  intent: TransactionIntent;

  /** The deterministic policy decision */
  decision: PolicyDecision;

  /**
   * Pre-submission integrity check result.
   * Only populated if the intent was approved and the UserOp was built.
   */
  integrityCheck?: IntegrityCheckResult;

  /**
   * On-chain result.
   * Only populated after the transaction is confirmed on-chain.
   */
  execution?: ExecutionResult;

  /** ISO 8601 timestamp when this record was created */
  recordedAt: string;
}

export interface IntegrityCheckResult {
  /** Did the decoded UserOp calldata match the approved intent? */
  passed: boolean;

  /** Fields that were verified */
  verifiedFields: {
    chainId: boolean;
    walletAddress: boolean;
    targetContract: boolean;
    recipient: boolean;
    amount: boolean;
    functionSelector: boolean;
    calldata: boolean;
  };

  /** If a mismatch was detected, which field mismatched */
  mismatchedField?: string;

  /** The calldata that was actually decoded from the built UserOp */
  decodedCalldata?: Hex;

  /** The calldata that was expected from the approved intent */
  expectedCalldata: Hex;
}

export interface ExecutionResult {
  /** Whether the on-chain execution succeeded */
  success: boolean;

  /** The transaction hash (Base Sepolia explorer URL can be constructed from this) */
  txHash?: Hex;

  /** Error message if execution failed */
  error?: string;

  /** Unix timestamp of execution */
  executedAt: number;
}

// ─── Sentinel Wallet Config ──────────────────────────────────────────────────

export interface SentinelWalletConfig {
  /** Base Sepolia RPC URL */
  rpcUrl: string;

  /** Pimlico bundler URL */
  bundlerUrl: string;

  /** Owner/guardian address (has override control) */
  ownerAddress: Address;

  /** The ONLY approved recipient the agent may send to */
  approvedRecipient: Address;

  /** Daily spending limit in USDC (6 decimals). Default: 100 USDC */
  dailyLimitUsdc: bigint;

  /** USDC contract address on the target chain */
  usdcAddress: Address;
}
