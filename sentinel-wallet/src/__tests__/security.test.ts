/**
 * Tests: Five Required Negative Security Tests + TPDR Tests
 *
 * Environment: MOCK (MockSmartAgentKitClient from @smartagentkit/testing)
 *
 * IMPORTANT — what "mock" means here:
 *   MockSmartAgentKitClient simulates spending limits, allowlist, and pause
 *   in-memory. It does NOT run actual EVM/Solidity hook code.
 *   These tests verify the Sentinel Wallet SDK pipeline and TPDR layer.
 *
 *   For proof of ON-CHAIN enforcement, see:
 *     packages/contracts/test/unit/SpendingLimitHook.t.sol  (54 Forge tests)
 *     packages/contracts/test/unit/AllowlistHook.t.sol      (60+ Forge tests)
 *     packages/contracts/test/unit/EmergencyPauseHook.t.sol (50+ Forge tests)
 *     packages/contracts/test/integration/HookMultiPlexerIntegration.t.sol
 *
 * Test catalogue:
 *   [N1] Spending limit exceeded              → rejected by spending_limit check
 *   [N2] Unapproved recipient                 → rejected by recipient_allowlist check
 *   [N3] Admin bypass (call hook directly)    → rejected by selector_match check
 *   [N4] Emergency pause                      → rejected by wallet_paused check
 *   [N5] Delegatecall / wrong selector        → rejected by selector_match check
 *   [T1] Valid intent passes all checks       → approved + execution succeeds
 *   [T2] Tampered recipient (TPDR)            → integrity check fails
 *   [T3] Tampered amount (TPDR)               → integrity check fails
 *   [T4] Modified target (TPDR)               → integrity check fails
 *   [T5] Expired intent                       → rejected by intent_expiry
 *   [T6] Replayed intent                      → rejected by intent_id_replay
 *   [T7] Wrong chain ID binding               → rejected by chain_id
 *   [T8] Wrong wallet binding                 → rejected by wallet_binding
 */

import { describe, it, expect, beforeEach, beforeAll } from "vitest";
import { parseUnits, type Address, type Hex } from "viem";
import { baseSepolia } from "viem/chains";
import { buildTransferIntent, TRANSFER_SELECTOR } from "../intent.js";
import { evaluateIntent, _resetUsedIntents, markIntentUsed } from "../policy.js";
import { verifyIntegrity } from "../integrity.js";
import { MockSentinelWalletManager } from "../wallet.js";
import type { TransactionIntent } from "../types.js";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const CHAIN_ID = baseSepolia.id; // 84532
const TOKEN: Address     = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
// Real checksummed EIP-55 addresses
const APPROVED: Address  = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const BLOCKED: Address   = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
const DAILY_LIMIT        = parseUnits("100", 6); // 100 USDC

// WARNING: Foundry well-known test key — never use with real funds
const OWNER_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as Hex;
const OWNER_ADDR = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as Address;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mockClient: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mockWallet: any;
let manager: MockSentinelWalletManager;

beforeAll(async () => {
  const { MockSmartAgentKitClient } = await import("@smartagentkit/testing");

  mockClient = new MockSmartAgentKitClient({
    initialBalance: parseUnits("1", 18),
    verbose: false,
  });

  mockWallet = await mockClient.createWallet({
    owner: OWNER_ADDR,
    ownerPrivateKey: OWNER_KEY,
    preset: "payment-agent",
    presetParams: {
      approvedRecipients: [APPROVED],
      dailyLimit: DAILY_LIMIT,
      guardian: OWNER_ADDR,
    },
  });
});

beforeEach(() => {
  _resetUsedIntents();
  manager = new MockSentinelWalletManager({
    approvedRecipient: APPROVED,
    walletAddress: mockWallet.address as Address,
    dailyLimitAmount: DAILY_LIMIT,
  });
  manager.initialize(mockClient, mockWallet);
});

function validIntent(overrides: Partial<TransactionIntent> = {}): TransactionIntent {
  const base = buildTransferIntent({
    chainId: CHAIN_ID,
    walletAddress: (mockWallet?.address ?? OWNER_ADDR) as Address,
    tokenAddress: TOKEN,
    recipient: APPROVED,
    amount: parseUnits("10", 6),
    amountHuman: "10 USDC",
  });
  return { ...base, ...overrides };
}

// ─── [T1] Positive Test — Valid Approved Transfer ─────────────────────────────

describe("[T1] Happy Path — Valid Intent Approved and Executed", () => {
  it("approves a valid 10 USDC transfer to approved recipient", async () => {
    const intent = validIntent();
    const record = await manager.executeIntent(intent);

    // Policy must approve the intent
    expect(record.decision.status).toBe("approved");
    // TPDR integrity check must pass
    expect(record.integrityCheck?.passed).toBe(true);
    // Execution was attempted (mock client may return success or simulate tx)
    // Key: decision was approved and execution record exists
    expect(record.execution).toBeDefined();
    if (record.execution?.success) {
      // Mock client returned a tx hash
      expect(record.execution.txHash).toMatch(/^0x/);
    }
  });

  it("TPDR record captures all required fields", async () => {
    const intent = validIntent();
    const record = await manager.executeIntent(intent);

    expect(record.intent.intentId).toBe(intent.intentId);
    expect(record.intent.recipient).toBe(intent.recipient);
    expect(record.intent.amount).toBe(intent.amount);
    expect(record.decision.decidedAt).toBeGreaterThan(0);
    expect(record.recordedAt).toBeTruthy();
  });
});

// ─── [N1] Spending Limit Exceeded ────────────────────────────────────────────

describe("[N1] Spending Limit — MUST BE REJECTED", () => {
  /**
   * Enforcement: OFF-CHAIN pre-flight (policy engine) + ON-CHAIN (SpendingLimitHook)
   * On-chain error: SpendingLimitHook.SpendingLimitExceeded
   * Forge test evidence: SpendingLimitHook.t.sol::test_nativeTransfer_exceedsLimit_reverts
   */
  it("rejects transfer of 150 USDC when daily limit is 100 USDC", async () => {
    const overAmount = parseUnits("150", 6);
    const selector = TRANSFER_SELECTOR.slice(2);
    const recipientPadded = APPROVED.slice(2).padStart(64, "0");
    const amountHex = overAmount.toString(16).padStart(64, "0");
    const calldata = ("0x" + selector + recipientPadded + amountHex) as Hex;

    const intent: TransactionIntent = {
      ...validIntent(),
      amount: overAmount,
      amountHuman: "150 USDC",
      calldata,
    };

    const record = await manager.executeIntent(intent);

    expect(record.decision.status).toBe("rejected");
    expect(record.decision.failedCheck).toBe("spending_limit");
    expect(record.execution).toBeUndefined(); // never reached execution
    console.log(`    [N1] Rejected: ${record.decision.reason}`);
  });

  it("rejects after cumulative spend would exceed limit", async () => {
    // Spend 95 USDC first
    manager.addSpentAmount(parseUnits("95", 6));

    // Now attempt 10 USDC (total would be 105 > 100 limit)
    const record = await manager.executeIntent(validIntent());

    expect(record.decision.status).toBe("rejected");
    expect(record.decision.failedCheck).toBe("spending_limit");
  });
});

// ─── [N2] Unapproved Recipient ────────────────────────────────────────────────

describe("[N2] Unapproved Recipient — MUST BE REJECTED", () => {
  /**
   * Enforcement: OFF-CHAIN (policy engine) + ON-CHAIN (AllowlistHook)
   * On-chain error: AllowlistHook.TargetNotAllowed
   * Forge test evidence: AllowlistHook.t.sol::test_disallowedTarget_blockedByMultiplexer
   */
  it("rejects transfer to address not in the approved list", async () => {
    const selector = TRANSFER_SELECTOR.slice(2);
    const recipientPadded = BLOCKED.slice(2).toLowerCase().padStart(64, "0");
    const amountHex = parseUnits("10", 6).toString(16).padStart(64, "0");
    const calldata = ("0x" + selector + recipientPadded + amountHex) as Hex;

    const intent: TransactionIntent = {
      ...validIntent(),
      recipient: BLOCKED,
      calldata,
    };

    const record = await manager.executeIntent(intent);

    expect(record.decision.status).toBe("rejected");
    expect(record.decision.failedCheck).toBe("recipient_allowlist");
    expect(record.decision.reason).toMatch(/not in the approved list/i);
    console.log(`    [N2] Rejected: ${record.decision.reason}`);
  });

  it("approves transfer to an address that IS in the approved list", async () => {
    const record = await manager.executeIntent(validIntent());
    expect(record.decision.status).toBe("approved");
  });
});

// ─── [N3] Admin Bypass Attempt ────────────────────────────────────────────────

describe("[N3] Admin Bypass — MUST BE REJECTED", () => {
  /**
   * Agent tries to call SpendingLimitHook.removeSpendingLimit() directly.
   *
   * Enforcement: OFF-CHAIN (selector_match rejects non-transfer selector)
   * On-chain equivalent: AllowlistHook.ProtectedTargetBlocked
   *   SpendingLimitHook is a protectedAddress in AllowlistHook.
   *   Direct calls to it are blocked regardless of mode/permissions.
   * Forge test evidence:
   *   HookMultiPlexerIntegration.t.sol::test_crossModuleProtection_blocksEmergencyPauseAdmin
   *   SpendingLimitHook.t.sol::test_selfCall_setSpendingLimit_reverts
   */
  it("rejects intent with removeSpendingLimit selector", async () => {
    const removeSpendingLimitSelector = "0x139d7fed" as Hex; // removeSpendingLimit(address)
    const HOOK_ADDRESS: Address = "0xd67a5E6784A66Ddf4C09EA7bbf81Ab89532624E4"; // SpendingLimitHook

    const intent: TransactionIntent = {
      ...validIntent(),
      targetContract: HOOK_ADDRESS,
      functionSelector: removeSpendingLimitSelector,
      calldata: ("0x" + "139d7fed" + TOKEN.slice(2).padStart(64, "0")) as Hex,
    };

    const record = await manager.executeIntent(intent);

    expect(record.decision.status).toBe("rejected");
    // selector_match catches non-transfer selectors
    expect(record.decision.failedCheck).toBe("selector_match");
    console.log(`    [N3] Rejected: ${record.decision.reason}`);
  });

  it("rejects intent targeting the hook contract with transfer selector", async () => {
    // Agent changes targetContract from TOKEN to HOOK_ADDRESS.
    // calldata_integrity check catches this: approved intent's target was TOKEN.
    // On-chain equivalent: AllowlistHook.ProtectedTargetBlocked
    const HOOK_ADDRESS: Address = "0xd67a5E6784A66Ddf4C09EA7bbf81Ab89532624E4";
    const selector = TRANSFER_SELECTOR.slice(2);
    const recipientPadded = APPROVED.slice(2).padStart(64, "0");
    const amountHex = parseUnits("10", 6).toString(16).padStart(64, "0");
    const intent: TransactionIntent = {
      ...validIntent(),
      targetContract: HOOK_ADDRESS,
      calldata: ("0x" + selector + recipientPadded + amountHex) as Hex,
    };

    const record = await manager.executeIntent(intent);
    // Policy rejects because calldata_integrity detects targetContract mismatch
    // OR recipient_allowlist rejects — either way it must NOT be approved
    expect(record.decision.status).toBe("rejected");
    console.log(`    [N3b] Rejected: ${record.decision.reason}`);
  });
});

// ─── [N4] Emergency Pause ─────────────────────────────────────────────────────

describe("[N4] Emergency Pause — MUST BE REJECTED", () => {
  /**
   * Enforcement: OFF-CHAIN (wallet_paused check) + ON-CHAIN (EmergencyPauseHook)
   * On-chain error: EmergencyPauseHook.WalletPaused
   * Forge test evidence: EmergencyPauseHook.t.sol::test_preCheck_paused_reverts
   *   testFuzz_pauseBlocks_anyTransaction — fuzz-tested against all targets
   */
  it("rejects all transfers when wallet is paused", async () => {
    manager.setPausedState(true);

    const record = await manager.executeIntent(validIntent());

    expect(record.decision.status).toBe("rejected");
    expect(record.decision.failedCheck).toBe("wallet_paused");
    expect(record.decision.reason).toMatch(/paused/i);
    console.log(`    [N4] Rejected: ${record.decision.reason}`);
  });

  it("approves after wallet is unpaused", async () => {
    manager.setPausedState(true);
    const pausedRecord = await manager.executeIntent(validIntent());
    expect(pausedRecord.decision.status).toBe("rejected");

    // Unpause
    manager.setPausedState(false);
    _resetUsedIntents();

    const unpausedRecord = await manager.executeIntent(validIntent());
    expect(unpausedRecord.decision.status).toBe("approved");
  });
});

// ─── [N5] Delegatecall / Wrong Selector ──────────────────────────────────────

describe("[N5] Delegatecall / Unsupported Selector — MUST BE REJECTED", () => {
  /**
   * Enforcement: OFF-CHAIN (selector_match) + ON-CHAIN (AllowlistHook.DelegateCallNotAllowed)
   * All three hooks revert on CALLTYPE_DELEGATECALL.
   * Forge test evidence:
   *   EmergencyPauseHook.t.sol::test_delegatecall_blocked
   *   AllowlistHook.t.sol::test_delegateCall_reverts
   *   SpendingLimitHook.t.sol::test_delegateCall_reverts
   */
  it("rejects intent with a non-ERC20-transfer function selector", async () => {
    const intent: TransactionIntent = {
      ...validIntent(),
      functionSelector: "0x00000000" as Hex,
      calldata: "0x00000000" as Hex,
    };

    const record = await manager.executeIntent(intent);

    expect(record.decision.status).toBe("rejected");
    expect(record.decision.failedCheck).toBe("selector_match");
    console.log(`    [N5] Rejected: ${record.decision.reason}`);
  });

  it("rejects intent with approve() selector (only transfer is supported)", async () => {
    const intent: TransactionIntent = {
      ...validIntent(),
      functionSelector: "0x095ea7b3" as Hex, // approve(address,uint256)
      calldata: ("0x095ea7b3" + APPROVED.slice(2).padStart(64, "0") +
        parseUnits("10", 6).toString(16).padStart(64, "0")) as Hex,
    };

    const record = await manager.executeIntent(intent);

    expect(record.decision.status).toBe("rejected");
    expect(record.decision.failedCheck).toBe("selector_match");
  });
});

// ─── TPDR Tests ───────────────────────────────────────────────────────────────

describe("[T2] TPDR — Tampered Recipient", () => {
  it("detects when calldata recipient differs from approved intent recipient", () => {
    const intent = validIntent();
    const evilPadded = BLOCKED.slice(2).toLowerCase().padStart(64, "0");
    const amountHex = parseUnits("10", 6).toString(16).padStart(64, "0");
    const tampered = ("0x" + TRANSFER_SELECTOR.slice(2) + evilPadded + amountHex) as Hex;

    const result = verifyIntegrity(intent, {
      target: intent.targetContract,
      value: 0n,
      calldata: tampered,
      chainId: CHAIN_ID,
      walletAddress: intent.walletAddress,
    });

    expect(result.passed).toBe(false);
    expect(result.verifiedFields.calldata).toBe(false);
    console.log(`    [T2] TPDR caught: mismatch on ${result.mismatchedField}`);
  });
});

describe("[T3] TPDR — Tampered Amount", () => {
  it("detects when calldata amount differs from approved intent amount", () => {
    const intent = validIntent();
    const recipientPadded = APPROVED.slice(2).padStart(64, "0");
    const inflatedAmount = parseUnits("9999", 6).toString(16).padStart(64, "0");
    const tampered = ("0x" + TRANSFER_SELECTOR.slice(2) + recipientPadded + inflatedAmount) as Hex;

    const result = verifyIntegrity(intent, {
      target: intent.targetContract,
      value: 0n,
      calldata: tampered,
      chainId: CHAIN_ID,
      walletAddress: intent.walletAddress,
    });

    expect(result.passed).toBe(false);
    expect(result.verifiedFields.amount).toBe(false);
    console.log(`    [T3] TPDR caught: mismatch on ${result.mismatchedField}`);
  });
});

describe("[T4] TPDR — Modified Target Contract", () => {
  it("detects when execute target differs from approved intent target", () => {
    const intent = validIntent();
    const maliciousTarget: Address = "0xCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC";

    const result = verifyIntegrity(intent, {
      target: maliciousTarget, // different from intent.targetContract
      value: 0n,
      calldata: intent.calldata,
      chainId: CHAIN_ID,
      walletAddress: intent.walletAddress,
    });

    expect(result.passed).toBe(false);
    expect(result.verifiedFields.targetContract).toBe(false);
    expect(result.mismatchedField).toBe("targetContract");
    console.log(`    [T4] TPDR caught: mismatch on ${result.mismatchedField}`);
  });
});

describe("[T5] Expired Intent", () => {
  it("rejects intent whose expiresAt is in the past", async () => {
    const expired: TransactionIntent = {
      ...validIntent(),
      expiresAt: Math.floor(Date.now() / 1000) - 60,
    };

    const record = await manager.executeIntent(expired);

    expect(record.decision.status).toBe("rejected");
    expect(record.decision.failedCheck).toBe("intent_expiry");
    expect(record.execution).toBeUndefined();
    console.log(`    [T5] Rejected: ${record.decision.reason}`);
  });
});

describe("[T6] Replay Attack", () => {
  it("rejects the same intent ID on second submission", async () => {
    const intent = validIntent();

    // First execution — should succeed
    const first = await manager.executeIntent(intent);
    expect(first.decision.status).toBe("approved");

    // Replay — same intentId
    const replay = await manager.executeIntent(intent);
    expect(replay.decision.status).toBe("rejected");
    expect(replay.decision.failedCheck).toBe("intent_id_replay");
    console.log(`    [T6] Replay rejected: ${replay.decision.reason}`);
  });

  it("accepts a fresh intent after a successful one", async () => {
    const intent1 = validIntent();
    await manager.executeIntent(intent1);

    // Different intent (different intentId, but limit now reduced)
    const intent2 = buildTransferIntent({
      chainId: CHAIN_ID,
      walletAddress: mockWallet.address,
      tokenAddress: TOKEN,
      recipient: APPROVED,
      amount: parseUnits("5", 6),
      amountHuman: "5 USDC",
    });

    const second = await manager.executeIntent(intent2);
    // 10 + 5 = 15, within 100 USDC limit
    expect(second.decision.status).toBe("approved");
  });
});

describe("[T7] Wrong Chain ID", () => {
  it("rejects intent with mainnet chain ID on Base Sepolia policy", async () => {
    const intent: TransactionIntent = {
      ...validIntent(),
      chainId: 1, // Ethereum mainnet
    };

    const record = await manager.executeIntent(intent);

    expect(record.decision.status).toBe("rejected");
    expect(record.decision.failedCheck).toBe("chain_id");
    console.log(`    [T7] Rejected: ${record.decision.reason}`);
  });
});

describe("[T8] Wrong Wallet Binding", () => {
  it("rejects intent targeting a different wallet address", async () => {
    const intent: TransactionIntent = {
      ...validIntent(),
      walletAddress: "0x9999999999999999999999999999999999999999" as Address,
    };
  const record = await manager.executeIntent(intent);

  expect(record.decision.status).toBe("rejected");
  expect(record.decision.failedCheck).toBe("wallet_binding");
  console.log(`    [T8] Rejected: ${record.decision.reason}`);
});
});

// ─── [S1] State & Reliability: concurrent duplicate submission ───────────────

describe("[S1] Concurrent duplicate submission — replay protection under race", () => {
  it("only ONE of two parallel submissions of the same intent is approved", async () => {
    const intent = validIntent();

    // Two identical submissions fired in the same tick: the manager marks
    // the intent used synchronously before the first await, so the second
    // evaluation must see it as used regardless of interleaving.
    const [a, b] = await Promise.all([
      manager.executeIntent(intent),
      manager.executeIntent(intent),
    ]);

    const approvedOuts = [a, b].filter((r) => r.decision.status === "approved");
    const replayOuts = [a, b].filter(
      (r) => r.decision.status === "rejected" && r.decision.failedCheck === "intent_id_replay",
    );

    expect(approvedOuts.length).toBe(1);
    expect(replayOuts.length).toBe(1);
    expect(approvedOuts[0]!.intent.intentId).toBe(intent.intentId);
    expect(replayOuts[0]!.decision.reason).toMatch(/replay/i);
  });

  it("fresh intent IDs do NOT reset the session spending accumulator (no limit bypass)", async () => {
    // The session accumulator increments only AFTER a confirmed on-chain
    // success. The mock EVM may not confirm ERC-20 transfers, so we simulate
    // three CONFIRMED 10-USDC spends explicitly (the exact state update the
    // manager performs after a real confirmation), then attempt 80 USDC.
    for (let i = 0; i < 3; i++) {
      const intent = validIntent();
      const r = await manager.executeIntent(intent);
      expect(r.decision.status).toBe("approved");
      manager.addSpentAmount(parseUnits("10", 6)); // = post-confirmation accounting path
    }
    expect(manager.getSpentSoFar()).toBe(parseUnits("30", 6));

    const oversized = buildTransferIntent({
      chainId: CHAIN_ID,
      walletAddress: mockWallet.address,
      tokenAddress: TOKEN,
      recipient: APPROVED,
      amount: parseUnits("80", 6),
      amountHuman: "80 USDC",
    });
    const record = await manager.executeIntent(oversized);
    expect(record.decision.status).toBe("rejected");
    expect(record.decision.failedCheck).toBe("spending_limit");
    expect(record.decision.reason).toMatch(/exceeds remaining limit/i);
  });
});
