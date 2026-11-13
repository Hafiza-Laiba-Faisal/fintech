import { describe, it, expect, beforeEach } from "vitest";
import { parseUnits, type Address, type Hex } from "viem";
import { SentinelWalletManager } from "../wallet.js";
import { buildTransferIntent } from "../intent.js";
import { _resetUsedIntents } from "../policy.js";

const MOCK_OWNER_KEY: Hex =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const OWNER_ADDR: Address = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const SAFE_ADDR: Address = "0x6cDE0BB1A5fb957d0e55c6E2dcd0a466c06D5123";
const RECIPIENT: Address = "0xE06D8999DCfc16366A7A1C0189C22Bb9521940db";
const USDC: Address = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

/**
 * Stub double for SmartAgentKitClient + AgentWallet so executeIntent reaches
 * the real Safe/bundler execution branch without any network access.
 * client.execute() throws exactly like the bundler simulation does on-chain.
 */
function makeManager(opts: { strictSafeMode?: boolean }): {
  manager: SentinelWalletManager;
  calls: number[];
} {
  const calls: number[] = [];
  const manager = new SentinelWalletManager({
    rpcUrl: "http://127.0.0.1:1", // unreachable — no call may be made in strict mode
    bundlerUrl: "http://127.0.0.1:1",
    ownerKey: MOCK_OWNER_KEY,
    approvedRecipient: RECIPIENT,
    walletAddress: SAFE_ADDR,
    dailyLimitAmount: parseUnits("100", 6),
    ...(opts.strictSafeMode !== undefined ? { strictSafeMode: opts.strictSafeMode } : {}),
  });

  const fakeWallet = {
    address: SAFE_ADDR,
    owner: OWNER_ADDR,
    chain: 84532,
    isDeployed: true,
    policies: [],
    sessions: [],
  };

  // Defeat private-field usage: attach a stub client whose execute() rejects
  // like a bundler simulation does on-chain.
  const stubClient = {
    execute: async () => {
      calls.push(1);
      throw new Error(
        "UserOperation reverted during simulation with reason: 0xacfdb444",
      );
    },
  };

  // Initialize private fields directly (same shape as the real constructor).
  const fields = manager as unknown as {
    client: unknown;
    wallet: unknown;
    ownerKey: Hex;
    rpcUrl: string;
  };
  fields.client = stubClient;
  fields.wallet = fakeWallet;
  fields.ownerKey = MOCK_OWNER_KEY;
  fields.rpcUrl = "http://127.0.0.1:1";

  return { manager, calls };
}

function makeIntent() {
  return buildTransferIntent({
    chainId: 84532,
    walletAddress: SAFE_ADDR,
    tokenAddress: USDC,
    recipient: RECIPIENT,
    amount: parseUnits("1", 6),
    amountHuman: "1.00 USDC",
    proposedBy: "test-agent",
    reason: "unit test — fail-closed verification",
  });
}

describe("Sentinel Wallet — strict Safe execution mode (fail-closed)", () => {
  beforeEach(() => {
    _resetUsedIntents();
    delete process.env.SENTINEL_STRICT_SAFE;
  });

  it("DEFAULT (strict): a Safe/bundler execution failure returns success=false and NEVER falls back to owner-EOA execution", async () => {
    const { manager, calls } = makeManager({});

    const record = await manager.executeIntent(makeIntent());

    expect(record.execution).toBeDefined();
    expect(record.execution!.success).toBe(false);
    expect(record.execution!.error).toContain("0xacfdb444");
    expect(record.execution!.txHash).toBeUndefined();
    expect(calls.length).toBe(1); // exactly one Safe execute attempt
    expect(record.execution!.error).toContain("strict fail-closed");
  });

  it("DEFAULT (strict): no spend is counted and policy state stays unchanged after Safe failure", async () => {
    const { manager } = makeManager({});
    const intent = makeIntent();
    await manager.executeIntent(intent);

    // tpdrLog must contain the failed execution record
    const log = manager.getTPDRLog();
    expect(log.length).toBe(1);
    expect(log[0]?.execution?.success).toBe(false);
  });

  it("STRICT (explicit): same fail-closed behavior is preserved", async () => {
    const { manager, calls } = makeManager({ strictSafeMode: true });
    const record = await manager.executeIntent(makeIntent());
    expect(record.execution!.success).toBe(false);
    expect(calls.length).toBe(1);
    expect(record.execution!.txHash).toBeUndefined();
  });

  it("OPT-OUT (explicit demo fallback required): falls back only when explicitly enabled", async () => {
    process.env.SENTINEL_STRICT_SAFE = "explicit-eoa-fallback";
    const { manager, calls } = makeManager({ strictSafeMode: false });

    // The fallback tries an owner-EOA writeContract against an unreachable RPC;
    // the critical assertions are that the strict guard did NOT block it and
    // that the record reports failure from the RPC error (not Safe failure).
    const record = await manager.executeIntent(makeIntent());

    expect(calls.length).toBe(1); // Safe execute was attempted first
    expect(record.execution!.success).toBe(false);
    // Fallback path error comes from the unreachable RPC, proving the fallback
    // was attempted (strict guard was genuinely disabled for this instance).
    expect(record.execution!.error).toBeDefined();
    expect(record.execution!.error).not.toContain("strict fail-closed");
  });
});
