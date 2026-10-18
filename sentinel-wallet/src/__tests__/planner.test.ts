/**
 * Tests: Simulated AI Agent Planner
 * Environment: Unit (no network)
 */

import { describe, it, expect } from "vitest";
import { parseUnits, type Address } from "viem";
import { parsePlannerRequest } from "../planner.js";
import { TRANSFER_SELECTOR } from "../intent.js";

const CHAIN_ID = 84532;
const WALLET: Address   = "0x1111111111111111111111111111111111111111";
const TOKEN: Address    = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
// Real checksummed EIP-55 address
const RECIPIENT: Address = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

const BASE_REQUEST = {
  chainId: CHAIN_ID,
  walletAddress: WALLET,
  tokenAddress: TOKEN,
  tokenDecimals: 6,
  tokenSymbol: "USDC",
};

describe("parsePlannerRequest", () => {
  it("parses 'send N USDC to <address>'", () => {
    const result = parsePlannerRequest({
      ...BASE_REQUEST,
      instruction: `send 10 USDC to ${RECIPIENT}`,
    });

    expect(result.success).toBe(true);
    expect(result.intent).toBeDefined();
    expect(result.intent!.recipient.toLowerCase()).toBe(RECIPIENT.toLowerCase());
    expect(result.intent!.amount).toBe(parseUnits("10", 6));
    expect(result.intent!.functionSelector.toLowerCase()).toBe(TRANSFER_SELECTOR.toLowerCase());
  });

  it("parses 'transfer N USDC to <address> for <reason>'", () => {
    const result = parsePlannerRequest({
      ...BASE_REQUEST,
      instruction: `transfer 25.5 USDC to ${RECIPIENT} for payroll cycle`,
    });

    expect(result.success).toBe(true);
    expect(result.intent!.amount).toBe(parseUnits("25.5", 6));
    expect(result.intent!.reason).toMatch(/payroll cycle/i);
  });

  it("parses 'pay <address> N USDC'", () => {
    const result = parsePlannerRequest({
      ...BASE_REQUEST,
      instruction: `pay ${RECIPIENT} 50 USDC`,
    });

    expect(result.success).toBe(true);
    expect(result.intent!.recipient.toLowerCase()).toBe(RECIPIENT.toLowerCase());
    expect(result.intent!.amount).toBe(parseUnits("50", 6));
  });

  it("sets proposedBy from agentName", () => {
    const result = parsePlannerRequest({
      ...BASE_REQUEST,
      instruction: `send 10 USDC to ${RECIPIENT}`,
      agentName: "test-agent-v1",
    });

    expect(result.intent!.proposedBy).toBe("test-agent-v1");
  });

  it("uses 'simulated-planner' as default proposedBy", () => {
    const result = parsePlannerRequest({
      ...BASE_REQUEST,
      instruction: `send 10 USDC to ${RECIPIENT}`,
    });

    expect(result.intent!.proposedBy).toBe("simulated-planner");
  });

  it("fails on unrecognized instruction format", () => {
    const result = parsePlannerRequest({
      ...BASE_REQUEST,
      instruction: "do something with tokens",
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/could not parse/i);
  });

  it("fails on invalid amount", () => {
    const result = parsePlannerRequest({
      ...BASE_REQUEST,
      instruction: `send abc USDC to ${RECIPIENT}`,
    });

    expect(result.success).toBe(false);
  });

  it("generates valid calldata (deterministic encoding)", () => {
    const result = parsePlannerRequest({
      ...BASE_REQUEST,
      instruction: `send 10 USDC to ${RECIPIENT}`,
    });

    expect(result.intent!.calldata).toHaveLength(138); // 0x + 136 hex chars
    expect(result.intent!.calldata.slice(0, 10).toLowerCase()).toBe(
      TRANSFER_SELECTOR.toLowerCase(),
    );
  });

  it("two calls produce different intentIds (no replay)", () => {
    const r1 = parsePlannerRequest({ ...BASE_REQUEST, instruction: `send 10 USDC to ${RECIPIENT}` });
    const r2 = parsePlannerRequest({ ...BASE_REQUEST, instruction: `send 10 USDC to ${RECIPIENT}` });

    expect(r1.intent!.intentId).not.toBe(r2.intent!.intentId);
  });
});
