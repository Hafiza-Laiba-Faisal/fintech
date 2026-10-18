/**
 * Tests: Transaction Intent Builder
 * Environment: Unit (no network, no mocks)
 */

import { describe, it, expect } from "vitest";
import { parseUnits, type Address } from "viem";
import {
  buildTransferIntent,
  TRANSFER_SELECTOR,
  generateIntentId,
  serializeIntent,
  hashIntent,
} from "../intent.js";

const CHAIN_ID = 84532; // Base Sepolia
const WALLET: Address    = "0x1111111111111111111111111111111111111111";
const TOKEN: Address     = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
// Real checksummed addresses (EIP-55)
const RECIPIENT: Address = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const AMOUNT = parseUnits("10", 6); // 10 USDC

describe("buildTransferIntent", () => {
  it("builds a valid intent with all required fields", () => {
    const intent = buildTransferIntent({
      chainId: CHAIN_ID,
      walletAddress: WALLET,
      tokenAddress: TOKEN,
      recipient: RECIPIENT,
      amount: AMOUNT,
      amountHuman: "10 USDC",
    });

    expect(intent.chainId).toBe(CHAIN_ID);
    expect(intent.walletAddress.toLowerCase()).toBe(WALLET.toLowerCase());
    expect(intent.tokenAddress.toLowerCase()).toBe(TOKEN.toLowerCase());
    expect(intent.targetContract.toLowerCase()).toBe(TOKEN.toLowerCase());
    expect(intent.recipient.toLowerCase()).toBe(RECIPIENT.toLowerCase());
    expect(intent.amount).toBe(AMOUNT);
    expect(intent.amountHuman).toBe("10 USDC");
    expect(intent.functionSelector.toLowerCase()).toBe(TRANSFER_SELECTOR.toLowerCase());
    expect(intent.intentId).toMatch(/^intent_[0-9a-f]{64}$/);
    expect(intent.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
    expect(intent.createdAt).toBeTruthy();
  });

  it("encodes calldata deterministically from recipient + amount", () => {
    const intent = buildTransferIntent({
      chainId: CHAIN_ID,
      walletAddress: WALLET,
      tokenAddress: TOKEN,
      recipient: RECIPIENT,
      amount: AMOUNT,
      amountHuman: "10 USDC",
    });

    // Verify calldata structure: 0x + selector(4) + recipient(32) + amount(32) = 0x + 136 hex chars
    expect(intent.calldata).toHaveLength(2 + 136); // "0x" + 136 hex chars
    expect(intent.calldata.slice(0, 10).toLowerCase()).toBe(TRANSFER_SELECTOR.toLowerCase());

    // Recipient should appear in bytes 4-35 (last 20 bytes of 32-byte slot)
    const recipientInCalldata = "0x" + intent.calldata.slice(10 + 24, 10 + 24 + 40);
    expect(recipientInCalldata.toLowerCase()).toBe(RECIPIENT.toLowerCase());
  });

  it("two intents built from same params have different intentIds", () => {
    const i1 = buildTransferIntent({ chainId: CHAIN_ID, walletAddress: WALLET, tokenAddress: TOKEN, recipient: RECIPIENT, amount: AMOUNT, amountHuman: "10 USDC" });
    const i2 = buildTransferIntent({ chainId: CHAIN_ID, walletAddress: WALLET, tokenAddress: TOKEN, recipient: RECIPIENT, amount: AMOUNT, amountHuman: "10 USDC" });
    expect(i1.intentId).not.toBe(i2.intentId);
  });

  it("intent expires at now + ttlSeconds", () => {
    const before = Math.floor(Date.now() / 1000);
    const intent = buildTransferIntent({
      chainId: CHAIN_ID, walletAddress: WALLET, tokenAddress: TOKEN,
      recipient: RECIPIENT, amount: AMOUNT, amountHuman: "10 USDC",
      ttlSeconds: 120,
    });
    const after = Math.floor(Date.now() / 1000);
    expect(intent.expiresAt).toBeGreaterThanOrEqual(before + 120);
    expect(intent.expiresAt).toBeLessThanOrEqual(after + 120);
  });

  it("throws on zero amount", () => {
    expect(() =>
      buildTransferIntent({
        chainId: CHAIN_ID, walletAddress: WALLET, tokenAddress: TOKEN,
        recipient: RECIPIENT, amount: 0n, amountHuman: "0 USDC",
      }),
    ).toThrow("Amount must be positive");
  });

  it("throws on invalid wallet address", () => {
    expect(() =>
      buildTransferIntent({
        chainId: CHAIN_ID, walletAddress: "not-an-address" as Address,
        tokenAddress: TOKEN, recipient: RECIPIENT,
        amount: AMOUNT, amountHuman: "10 USDC",
      }),
    ).toThrow("Invalid walletAddress");
  });

  it("throws on invalid recipient address", () => {
    expect(() =>
      buildTransferIntent({
        chainId: CHAIN_ID, walletAddress: WALLET, tokenAddress: TOKEN,
        recipient: "0xZZZZ" as Address, amount: AMOUNT, amountHuman: "10 USDC",
      }),
    ).toThrow("Invalid recipient");
  });
});

describe("generateIntentId", () => {
  it("produces a string matching intent_<64hex>", () => {
    const id = generateIntentId();
    expect(id).toMatch(/^intent_[0-9a-f]{64}$/);
  });

  it("produces unique IDs on every call", () => {
    const ids = Array.from({ length: 20 }, generateIntentId);
    const unique = new Set(ids);
    expect(unique.size).toBe(20);
  });
});

describe("serializeIntent / hashIntent", () => {
  it("serializes BigInt fields as decimal strings", () => {
    const intent = buildTransferIntent({
      chainId: CHAIN_ID, walletAddress: WALLET, tokenAddress: TOKEN,
      recipient: RECIPIENT, amount: AMOUNT, amountHuman: "10 USDC",
    });
    const json = serializeIntent(intent);
    // Amount should be a string "10000000", not a number (which JS can't represent exactly)
    expect(json).toContain(`"${AMOUNT.toString()}"`);
    // Should not throw when parsed back
    const parsed = JSON.parse(json);
    expect(parsed.intentId).toBe(intent.intentId);
  });

  it("produces a 0x-prefixed 32-byte hex hash", () => {
    const intent = buildTransferIntent({
      chainId: CHAIN_ID, walletAddress: WALLET, tokenAddress: TOKEN,
      recipient: RECIPIENT, amount: AMOUNT, amountHuman: "10 USDC",
    });
    const hash = hashIntent(intent);
    expect(hash).toMatch(/^0x[0-9a-fA-F]{64}$/);
  });

  it("same intent produces same hash", () => {
    const intent = buildTransferIntent({
      chainId: CHAIN_ID, walletAddress: WALLET, tokenAddress: TOKEN,
      recipient: RECIPIENT, amount: AMOUNT, amountHuman: "10 USDC",
    });
    expect(hashIntent(intent)).toBe(hashIntent(intent));
  });

  it("different intents produce different hashes", () => {
    const i1 = buildTransferIntent({ chainId: CHAIN_ID, walletAddress: WALLET, tokenAddress: TOKEN, recipient: RECIPIENT, amount: AMOUNT, amountHuman: "10 USDC" });
    const i2 = buildTransferIntent({ chainId: CHAIN_ID, walletAddress: WALLET, tokenAddress: TOKEN, recipient: RECIPIENT, amount: AMOUNT, amountHuman: "10 USDC" });
    // Different intentIds → different hashes
    expect(hashIntent(i1)).not.toBe(hashIntent(i2));
  });
});
