/**
 * Sentinel Wallet — Transaction Intent Builder
 *
 * Constructs a strongly-typed TransactionIntent from AI-provided fields.
 * The intent fully specifies the desired transaction before any policy
 * check or UserOp construction occurs.
 *
 * Key property: calldata is deterministically derived from the intent
 * fields (recipient + amount), not accepted as an opaque blob from the
 * agent. This means a compromised agent cannot inject arbitrary calldata
 * — it can only specify recipient and amount within the typed schema.
 */

import {
  encodeFunctionData,
  isAddress,
  getAddress,
  keccak256,
  toHex,
  concat,
  type Address,
  type Hex,
} from "viem";
import type { TransactionIntent } from "./types.js";

// ─── ERC-20 ABI (minimal — transfer only) ────────────────────────────────────

export const ERC20_TRANSFER_ABI = [
  {
    name: "transfer",
    type: "function",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
  },
] as const;

/** ERC-20 transfer(address,uint256) selector — verified against ABI */
export const TRANSFER_SELECTOR: Hex = "0xa9059cbb";

// ─── Intent ID Generation ─────────────────────────────────────────────────────

/**
 * Generate a cryptographically random intent ID.
 * Format: "intent_<hex32>" — 264 bits of entropy.
 * Used for replay protection — each intent ID must be used exactly once.
 */
export function generateIntentId(): string {
  const randomBytes = new Uint8Array(32);
  crypto.getRandomValues(randomBytes);
  return "intent_" + toHex(randomBytes).slice(2);
}

// ─── Intent Builder ───────────────────────────────────────────────────────────

export interface BuildIntentParams {
  /** Chain ID (84532 = Base Sepolia) */
  chainId: number;

  /** The smart wallet address that will execute */
  walletAddress: Address;

  /** ERC-20 token contract to call */
  tokenAddress: Address;

  /** Recipient of the ERC-20 transfer */
  recipient: Address;

  /** Amount in token's smallest unit (e.g., 10_000000n for 10 USDC) */
  amount: bigint;

  /** Human-readable amount string for display */
  amountHuman: string;

  /** How many seconds until this intent expires (default: 300 = 5 minutes) */
  ttlSeconds?: number;

  /** Who is proposing this intent (agent name or "simulated-planner") */
  proposedBy?: string;

  /** Human-readable reason */
  reason?: string;
}

/**
 * Build a TransactionIntent for an ERC-20 transfer.
 *
 * The calldata is deterministically encoded from recipient + amount.
 * The agent cannot provide arbitrary calldata — only recipient and amount
 * are accepted as inputs. This is the core anti-injection property.
 */
export function buildTransferIntent(params: BuildIntentParams): TransactionIntent {
  const {
    chainId,
    walletAddress,
    tokenAddress,
    recipient,
    amount,
    amountHuman,
    ttlSeconds = 300,
    proposedBy = "simulated-planner",
    reason = "Agent-initiated ERC-20 transfer",
  } = params;

  // Validate addresses before building
  // Use isAddress with { strict: false } to accept both checksummed and lowercase
  if (!isAddress(walletAddress, { strict: false })) {
    throw new Error(`Invalid walletAddress: ${walletAddress}`);
  }
  if (!isAddress(tokenAddress, { strict: false })) {
    throw new Error(`Invalid tokenAddress: ${tokenAddress}`);
  }
  if (!isAddress(recipient, { strict: false })) {
    throw new Error(`Invalid recipient: ${recipient}`);
  }
  if (amount <= 0n) {
    throw new Error(`Amount must be positive, got: ${amount}`);
  }

  // Normalize addresses to checksum format
  const normalizedRecipient = getAddress(recipient);
  const normalizedToken = getAddress(tokenAddress);
  const normalizedWallet = getAddress(walletAddress);

  // Deterministically encode calldata from intent fields
  // The agent cannot inject arbitrary calldata — it only provides
  // typed (recipient, amount) which are encoded here.
  const calldata = encodeFunctionData({
    abi: ERC20_TRANSFER_ABI,
    functionName: "transfer",
    args: [normalizedRecipient, amount],
  });

  // Verify our selector constant matches the ABI encoding
  const derivedSelector = calldata.slice(0, 10) as Hex;
  if (derivedSelector.toLowerCase() !== TRANSFER_SELECTOR.toLowerCase()) {
    throw new Error(
      `Selector mismatch: expected ${TRANSFER_SELECTOR}, got ${derivedSelector}`,
    );
  }

  const now = Math.floor(Date.now() / 1000);

  return {
    intentId: generateIntentId(),
    chainId,
    walletAddress: normalizedWallet,
    targetContract: normalizedToken,
    functionSelector: TRANSFER_SELECTOR,
    tokenAddress: normalizedToken,
    recipient: normalizedRecipient,
    amount,
    amountHuman,
    calldata,
    expiresAt: now + ttlSeconds,
    createdAt: new Date().toISOString(),
    proposedBy,
    reason,
  };
}

// ─── Intent Serialization ─────────────────────────────────────────────────────

/**
 * Serialize an intent to a deterministic JSON string.
 * BigInt values are converted to decimal strings.
 */
export function serializeIntent(intent: TransactionIntent): string {
  return JSON.stringify(intent, (_key, value) =>
    typeof value === "bigint" ? value.toString() : value,
  );
}

/**
 * Compute a keccak256 hash of the serialized intent.
 * Used as a content fingerprint in TPDR records.
 */
export function hashIntent(intent: TransactionIntent): Hex {
  const serialized = serializeIntent(intent);
  return keccak256(concat([toHex(new TextEncoder().encode(serialized))]));
}
