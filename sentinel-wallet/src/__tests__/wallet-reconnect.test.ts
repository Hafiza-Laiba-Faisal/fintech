import { describe, it, expect, beforeEach } from "vitest";
import { parseUnits, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { SentinelWalletManager, MockSentinelWalletManager } from "../wallet.js";
import { buildTransferIntent } from "../intent.js";
import { _resetUsedIntents } from "../policy.js";

const TEST_OWNER_KEY: Hex =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const EXPECTED_OWNER_ADDR = privateKeyToAccount(TEST_OWNER_KEY).address;
const DEPLOYED_SAFE: Address = "0x6cDE0BB1A5fb957d0e55c6E2dcd0a466c06D5123";
const RECIPIENT: Address = "0xE06D8999DCfc16366A7A1C0189C22Bb9521940db";
const USDC: Address = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

describe("Sentinel Wallet — Reconnection & Policy Integrity", () => {
  beforeEach(() => {
    _resetUsedIntents();
  });

  it("connectWallet() reconstructs full account state with owner EOA and installed hooks", async () => {
    const manager = new SentinelWalletManager({
      rpcUrl: "http://127.0.0.1:8545",
      bundlerUrl: "http://127.0.0.1:4337",
      ownerKey: TEST_OWNER_KEY,
      approvedRecipient: RECIPIENT,
      walletAddress: "0x0000000000000000000000000000000000000001", // initial placeholder
      dailyLimitAmount: parseUnits("50", 6),
    });

    // Mock client.connectWallet
    const fields = manager as unknown as {
      client: { connectWallet: (addr: Address, key: Hex) => Promise<void> };
    };
    fields.client = {
      connectWallet: async () => {},
    };

    const wallet = await manager.connectWallet(DEPLOYED_SAFE);

    // 1. Safe address must match connected wallet
    expect(wallet.address).toBe(DEPLOYED_SAFE);
    expect(manager.getWalletAddress()).toBe(DEPLOYED_SAFE);

    // 2. Owner must be the human owner EOA address, NOT the Safe proxy address
    expect(wallet.owner.toLowerCase()).toBe(EXPECTED_OWNER_ADDR.toLowerCase());
    expect(wallet.owner.toLowerCase()).not.toBe(DEPLOYED_SAFE.toLowerCase());

    // 3. Deployed state must be true
    expect(wallet.isDeployed).toBe(true);

    // 4. Must reconstruct the payment-agent preset hooks
    expect(wallet.policies.length).toBe(3);

    const spendingHook = wallet.policies.find((p) => p.name === "SpendingLimitHook");
    expect(spendingHook).toBeDefined();
    expect(spendingHook?.moduleAddress.toLowerCase()).toBe(
      "0xd67a5E6784A66Ddf4C09EA7bbf81Ab89532624E4".toLowerCase(),
    );

    const allowlistHook = wallet.policies.find((p) => p.name === "AllowlistHook");
    expect(allowlistHook).toBeDefined();
    expect(allowlistHook?.moduleAddress.toLowerCase()).toBe(
      "0x7899b03386A3874393A3769D637977d947A9Fc66".toLowerCase(),
    );

    const emergencyHook = wallet.policies.find((p) => p.name === "EmergencyPauseHook");
    expect(emergencyHook).toBeDefined();
    expect(emergencyHook?.moduleAddress.toLowerCase()).toBe(
      "0xAc0cE5672aED1Bfe5549b885f883a770Acd8cAE3".toLowerCase(),
    );
  });

  it("connectWallet() synchronizes runtime policyConfig with connected wallet address", async () => {
    const manager = new SentinelWalletManager({
      rpcUrl: "http://127.0.0.1:8545",
      bundlerUrl: "http://127.0.0.1:4337",
      ownerKey: TEST_OWNER_KEY,
      approvedRecipient: RECIPIENT,
      walletAddress: "0x1111111111111111111111111111111111111111", // Old address
      dailyLimitAmount: parseUnits("50", 6),
    });

    const fields = manager as unknown as {
      client: {
        connectWallet: (addr: Address, key: Hex) => Promise<void>;
        execute: () => Promise<Hex>;
      };
    };
    fields.client = {
      connectWallet: async () => {},
      execute: async () => "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890" as Hex,
    };

    await manager.connectWallet(DEPLOYED_SAFE);

    // Intent built with DEPLOYED_SAFE must NOT be rejected with wallet_address_mismatch
    const intent = buildTransferIntent({
      chainId: 84532,
      walletAddress: DEPLOYED_SAFE,
      tokenAddress: USDC,
      recipient: RECIPIENT,
      amount: parseUnits("5", 6),
      amountHuman: "5.00 USDC",
      proposedBy: "test-agent",
      reason: "verification after reconnection",
    });

    const record = await manager.executeIntent(intent);
    expect(record.decision.status).toBe("approved");
    expect(record.integrityCheck?.passed).toBe(true);
    expect(record.execution?.success).toBe(true);
  });

  it("MockSentinelWalletManager supports connectWallet with identical account reconstruction", () => {
    const mockManager = new MockSentinelWalletManager({
      approvedRecipient: RECIPIENT,
      walletAddress: "0x1111111111111111111111111111111111111111",
      dailyLimitAmount: parseUnits("50", 6),
    });

    const wallet = mockManager.connectWallet(DEPLOYED_SAFE, EXPECTED_OWNER_ADDR);

    expect(wallet.address).toBe(DEPLOYED_SAFE);
    expect(wallet.owner).toBe(EXPECTED_OWNER_ADDR);
    expect(wallet.policies.length).toBe(3);
    expect(mockManager.getWalletAddress()).toBe(DEPLOYED_SAFE);
  });
});
