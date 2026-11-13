import { describe, it, expect } from "vitest";
import { evaluateIntent } from "../policy.js";
import { buildTransferIntent } from "../intent.js";
import { parseUnits } from "viem";

describe("Sentinel Wallet — Multi-User Policy Isolation", () => {
  const SAFE_ADDR = "0x6cDE0BB1A5fb957d0e55c6E2dcd0a466c06D5123";
  const TOKEN_ADDR = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
  const APPROVED_RECIPIENT = "0xe06d8999dcfc16366a7a1c0189c22bb9521940db";

  // Simulate User A and User B policy configurations pointing to the same Safe Smart Account
  const userAPolicy = {
    chainId: 84532,
    walletAddress: SAFE_ADDR as `0x${string}`,
    approvedRecipients: [APPROVED_RECIPIENT as `0x${string}`],
    dailyLimitAmount: parseUnits("20", 6), // $20 daily
    perTxCeilingAmount: parseUnits("10", 6), // $10 max per tx
    spentSoFar: 0n,
    isPaused: false,
  };

  const userBPolicy = {
    chainId: 84532,
    walletAddress: SAFE_ADDR as `0x${string}`,
    approvedRecipients: [APPROVED_RECIPIENT as `0x${string}`],
    dailyLimitAmount: parseUnits("200", 6), // $200 daily
    perTxCeilingAmount: parseUnits("100", 6), // $100 max per tx
    spentSoFar: 0n,
    isPaused: false,
  };

  it("User A's per-tx ceiling ($10) strictly rejects a $15 intent", () => {
    const amount = parseUnits("15", 6);
    const intent = buildTransferIntent({
      chainId: 84532,
      walletAddress: SAFE_ADDR as `0x${string}`,
      tokenAddress: TOKEN_ADDR as `0x${string}`,
      recipient: APPROVED_RECIPIENT as `0x${string}`,
      amount,
      amountHuman: "15.00 USDC",
    });

    const decisionA = evaluateIntent(intent, userAPolicy);
    expect(decisionA.status).toBe("rejected");
    expect(decisionA.failedCheck).toBe("per_tx_ceiling");
    expect(decisionA.reason).toContain("exceeds per-transaction ceiling 10000000");
  });

  it("User B's per-tx ceiling ($100) approves the exact same $15 intent", () => {
    const amount = parseUnits("15", 6);
    const intent = buildTransferIntent({
      chainId: 84532,
      walletAddress: SAFE_ADDR as `0x${string}`,
      tokenAddress: TOKEN_ADDR as `0x${string}`,
      recipient: APPROVED_RECIPIENT as `0x${string}`,
      amount,
      amountHuman: "15.00 USDC",
    });

    const decisionB = evaluateIntent(intent, userBPolicy);
    expect(decisionB.status).toBe("approved");
    expect(decisionB.checks.every((c) => c.passed)).toBe(true);
  });

  it("Emergency pause on User A does NOT affect User B's capability to execute", () => {
    const userAPaused = { ...userAPolicy, isPaused: true };
    const amount = parseUnits("5", 6);

    const intentA = buildTransferIntent({
      chainId: 84532,
      walletAddress: SAFE_ADDR as `0x${string}`,
      tokenAddress: TOKEN_ADDR as `0x${string}`,
      recipient: APPROVED_RECIPIENT as `0x${string}`,
      amount,
      amountHuman: "5.00 USDC",
    });

    const decisionA = evaluateIntent(intentA, userAPaused);
    expect(decisionA.status).toBe("rejected");
    expect(decisionA.failedCheck).toBe("wallet_paused");

    const intentB = buildTransferIntent({
      chainId: 84532,
      walletAddress: SAFE_ADDR as `0x${string}`,
      tokenAddress: TOKEN_ADDR as `0x${string}`,
      recipient: APPROVED_RECIPIENT as `0x${string}`,
      amount,
      amountHuman: "5.00 USDC",
    });

    const decisionB = evaluateIntent(intentB, userBPolicy);
    expect(decisionB.status).toBe("approved");
  });
});
