/**
 * Tests: TPDR Transaction Integrity Verifier
 * Environment: Unit (no network)
 *
 * Verifies that verifyIntegrity() correctly catches:
 *   - Modified recipient in calldata
 *   - Modified amount in calldata
 *   - Modified target contract
 *   - Modified chain ID
 *   - Modified wallet address
 *   - Mismatched function selector
 *
 * And confirms it passes when all fields match.
 */

import { describe, it, expect } from "vitest";
import { parseUnits, type Address, type Hex } from "viem";
import { buildTransferIntent, TRANSFER_SELECTOR } from "../intent.js";
import { verifyIntegrity, decodeTransferCalldata } from "../integrity.js";
import type { TransactionIntent } from "../types.js";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const CHAIN_ID = 84532;
const WALLET: Address    = "0x1111111111111111111111111111111111111111";
const TOKEN: Address     = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
// Real checksummed addresses (EIP-55)
const RECIPIENT: Address = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const EVIL: Address      = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
const AMOUNT = parseUnits("10", 6);

function makeIntent(): TransactionIntent {
  return buildTransferIntent({
    chainId: CHAIN_ID, walletAddress: WALLET, tokenAddress: TOKEN,
    recipient: RECIPIENT, amount: AMOUNT, amountHuman: "10 USDC",
  });
}

function validParams(intent: TransactionIntent) {
  return {
    target: intent.targetContract,
    value: 0n,
    calldata: intent.calldata,
    chainId: CHAIN_ID,
    walletAddress: intent.walletAddress,
  };
}

// ─── Happy Path ───────────────────────────────────────────────────────────────

describe("verifyIntegrity — happy path", () => {
  it("passes when all execute params match the approved intent", () => {
    const intent = makeIntent();
    const result = verifyIntegrity(intent, validParams(intent));
    expect(result.passed).toBe(true);
    expect(result.mismatchedField).toBeUndefined();
    expect(Object.values(result.verifiedFields).every(Boolean)).toBe(true);
  });
});

// ─── Calldata tampering ───────────────────────────────────────────────────────

describe("verifyIntegrity — calldata tampering", () => {
  it("detects tampered recipient in calldata", () => {
    const intent = makeIntent();
    const evilRecipientPadded = EVIL.slice(2).toLowerCase().padStart(64, "0");
    const amountHex = AMOUNT.toString(16).padStart(64, "0");
    const tampered = ("0x" + TRANSFER_SELECTOR.slice(2) + evilRecipientPadded + amountHex) as Hex;

    const result = verifyIntegrity(intent, { ...validParams(intent), calldata: tampered });

    expect(result.passed).toBe(false);
    expect(result.verifiedFields.calldata).toBe(false);
    // After calldata mismatch, individual field decode should also catch recipient
    expect(result.verifiedFields.recipient).toBe(false);
  });

  it("detects tampered amount in calldata", () => {
    const intent = makeIntent();
    const recipientPadded = RECIPIENT.slice(2).toLowerCase().padStart(64, "0");
    const badAmountHex = parseUnits("999", 6).toString(16).padStart(64, "0");
    const tampered = ("0x" + TRANSFER_SELECTOR.slice(2) + recipientPadded + badAmountHex) as Hex;

    const result = verifyIntegrity(intent, { ...validParams(intent), calldata: tampered });

    expect(result.passed).toBe(false);
    expect(result.verifiedFields.calldata).toBe(false);
    expect(result.verifiedFields.amount).toBe(false);
  });

  it("detects tampered selector in calldata", () => {
    const intent = makeIntent();
    const recipientPadded = RECIPIENT.slice(2).toLowerCase().padStart(64, "0");
    const amountHex = AMOUNT.toString(16).padStart(64, "0");
    // Use approve selector instead of transfer
    const tampered = ("0x" + "095ea7b3" + recipientPadded + amountHex) as Hex;

    const result = verifyIntegrity(intent, { ...validParams(intent), calldata: tampered });

    expect(result.passed).toBe(false);
  });

  it("exposes expected vs actual calldata in result", () => {
    const intent = makeIntent();
    const tampered = ("0x" + "00".repeat(68)) as Hex;

    const result = verifyIntegrity(intent, { ...validParams(intent), calldata: tampered });

    expect(result.expectedCalldata).toBe(intent.calldata);
    expect(result.decodedCalldata).toBe(tampered);
  });
});

// ─── Target contract tampering ────────────────────────────────────────────────

describe("verifyIntegrity — target contract tampering", () => {
  it("detects replaced target contract address", () => {
    const intent = makeIntent();
    const maliciousTarget: Address = "0xCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC";

    const result = verifyIntegrity(intent, {
      ...validParams(intent),
      target: maliciousTarget,
    });

    expect(result.passed).toBe(false);
    expect(result.verifiedFields.targetContract).toBe(false);
    expect(result.mismatchedField).toBe("targetContract");
  });
});

// ─── Chain ID tampering ───────────────────────────────────────────────────────

describe("verifyIntegrity — chain ID mismatch", () => {
  it("detects wrong chain ID", () => {
    const intent = makeIntent();

    const result = verifyIntegrity(intent, {
      ...validParams(intent),
      chainId: 1, // mainnet instead of Base Sepolia
    });

    expect(result.passed).toBe(false);
    expect(result.verifiedFields.chainId).toBe(false);
    expect(result.mismatchedField).toBe("chainId");
  });
});

// ─── Wallet address tampering ────────────────────────────────────────────────

describe("verifyIntegrity — wallet address mismatch", () => {
  it("detects wrong wallet address", () => {
    const intent = makeIntent();
    const wrongWallet: Address = "0x9999999999999999999999999999999999999999";

    const result = verifyIntegrity(intent, {
      ...validParams(intent),
      walletAddress: wrongWallet,
    });

    expect(result.passed).toBe(false);
    expect(result.verifiedFields.walletAddress).toBe(false);
    expect(result.mismatchedField).toBe("walletAddress");
  });
});

// ─── decodeTransferCalldata ───────────────────────────────────────────────────

describe("decodeTransferCalldata", () => {
  it("decodes valid transfer calldata", () => {
    const intent = makeIntent();
    const decoded = decodeTransferCalldata(intent.calldata);

    expect(decoded).not.toBeNull();
    expect(decoded!.selector.toLowerCase()).toBe(TRANSFER_SELECTOR.toLowerCase());
    expect(decoded!.recipient.toLowerCase()).toBe(RECIPIENT.toLowerCase());
    expect(decoded!.amount).toBe(AMOUNT);
  });

  it("returns null for calldata that is too short", () => {
    expect(decodeTransferCalldata("0x1234" as Hex)).toBeNull();
  });

  it("returns null for non-transfer selector", () => {
    const recipientPadded = RECIPIENT.slice(2).padStart(64, "0");
    const amountHex = AMOUNT.toString(16).padStart(64, "0");
    const nonTransfer = ("0x" + "095ea7b3" + recipientPadded + amountHex) as Hex; // approve
    expect(decodeTransferCalldata(nonTransfer)).toBeNull();
  });

  it("decodes maximum uint256 amount without overflow", () => {
    const maxAmount = 2n ** 256n - 1n;
    const recipientPadded = RECIPIENT.slice(2).padStart(64, "0");
    const amountHex = maxAmount.toString(16).padStart(64, "0");
    const calldata = ("0x" + TRANSFER_SELECTOR.slice(2) + recipientPadded + amountHex) as Hex;
    const decoded = decodeTransferCalldata(calldata);
    expect(decoded!.amount).toBe(maxAmount);
  });
});
