/**
 * Sentinel Wallet — Competition Demo
 *
 * Run modes:
 *   pnpm demo:mock   → Full demo, no network, no API keys needed (recommended)
 *   pnpm demo:llm    → Mock demo with a REAL LLM planner (LLM_ENDPOINT_URL/LLM_MODEL in .env)
 *   pnpm demo        → Live testnet demo (requires .env with keys + funded wallet)
 *
 * Demo flow:
 *   1. Setup: wallet creation / connection
 *   2. Happy path: approved ERC-20 transfer → real or mock tx hash
 *   3. Policy rejections: over-limit, wrong recipient, paused wallet
 *   4. TPDR layer: tampered calldata detection, expired intent, replay
 *   5. Summary: TPDR log, on-chain enforcement labels
 */

import "dotenv/config";
import { parseUnits, formatUnits, type Address, type Hex } from "viem";
import { baseSepolia } from "viem/chains";
import { buildTransferIntent } from "./intent.js";
import { evaluateIntent, _resetUsedIntents } from "./policy.js";
import { verifyIntegrity } from "./integrity.js";
import { parsePlannerRequest, getDemoScenarios } from "./planner.js";
import { parsePlannerRequestWithLLMFallback, getLLMConfigFromEnv } from "./llm-planner.js";
import { MockSentinelWalletManager } from "./wallet.js";
import type { TPDRRecord, TransactionIntent } from "./types.js";

// ─── Constants ────────────────────────────────────────────────────────────────

const CHAIN_ID = baseSepolia.id; // 84532
const USDC_DECIMALS = 6;
const USDC_BASE_SEPOLIA: Address = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const DAILY_LIMIT_USDC = parseUnits("100", USDC_DECIMALS); // 100 USDC

// Demo addresses — EIP-55 checksummed (Foundry well-known test accounts)
const MOCK_WALLET: Address         = "0x1111111111111111111111111111111111111111";
const APPROVED_RECIPIENT: Address  = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const BLOCKED_RECIPIENT: Address   = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";

const IS_MOCK = process.argv.includes("--mock");
const IS_LLM = process.argv.includes("--llm");

// ─── Display helpers ──────────────────────────────────────────────────────────

const RESET  = "\x1b[0m";
const BOLD   = "\x1b[1m";
const GREEN  = "\x1b[32m";
const RED    = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN   = "\x1b[36m";
const DIM    = "\x1b[2m";

function banner(title: string): void {
  const line = "═".repeat(60);
  console.log(`\n${CYAN}${line}${RESET}`);
  console.log(`${BOLD}${CYAN}  ${title}${RESET}`);
  console.log(`${CYAN}${line}${RESET}`);
}

function section(title: string): void {
  console.log(`\n${BOLD}${YELLOW}── ${title} ──${RESET}`);
}

function pass(msg: string): void {
  console.log(`  ${GREEN}✔  ${msg}${RESET}`);
}

function fail(msg: string): void {
  console.log(`  ${RED}✘  ${msg}${RESET}`);
}

function info(msg: string): void {
  console.log(`  ${DIM}${msg}${RESET}`);
}

function warn(msg: string): void {
  console.log(`  ${YELLOW}⚠  ${msg}${RESET}`);
}

function printTPDR(record: TPDRRecord, index: number): void {
  const statusColor = record.decision.status === "approved" ? GREEN : RED;
  const statusSymbol = record.decision.status === "approved" ? "✔" : "✘";

  console.log(`\n  ${BOLD}[${index}] ${record.intent.proposedBy}${RESET}`);
  console.log(`      Intent  : ${DIM}${record.intent.intentId.slice(0, 24)}...${RESET}`);
  console.log(`      Transfer: ${record.intent.amountHuman} → ${record.intent.recipient.slice(0, 10)}...`);
  console.log(`      Decision: ${statusColor}${statusSymbol} ${record.decision.status.toUpperCase()}${RESET}`);
  console.log(`      Reason  : ${record.decision.reason}`);

  if (record.integrityCheck) {
    const ic = record.integrityCheck;
    const icColor = ic.passed ? GREEN : RED;
    console.log(`      TPDR    : ${icColor}${ic.passed ? "✔ Integrity verified" : `✘ MISMATCH on ${ic.mismatchedField}`}${RESET}`);
  }

  if (record.execution?.txHash) {
    console.log(`      TX Hash : ${BOLD}${record.execution.txHash}${RESET}`);
    if (!IS_MOCK) {
      console.log(
        `      Explorer: ${CYAN}https://sepolia.basescan.org/tx/${record.execution.txHash}${RESET}`,
      );
    }
  }
}

// ─── Mock Demo ────────────────────────────────────────────────────────────────

async function runMockDemo(): Promise<void> {
  banner("SENTINEL WALLET — COMPETITION DEMO (MOCK MODE)");

  console.log(`\n${BOLD}Architecture:${RESET}`);
  console.log("  User Request → AI Planner → Policy Engine → TPDR Verifier → Wallet Execute");
  console.log("\n  On-chain enforcement (Base Sepolia, verified in audit):");
  console.log("    SpendingLimitHook  @ 0xd67a5E6784A66Ddf4C09EA7bbf81Ab89532624E4");
  console.log("    AllowlistHook      @ 0x7899b03386A3874393A3769D637977d947A9Fc66");
  console.log("    EmergencyPauseHook @ 0xAc0cE5672aED1Bfe5549b885f883a770Acd8cAE3");

  // ── Setup mock client ──────────────────────────────────────────────────────
  section("1. WALLET SETUP");

  const { MockSmartAgentKitClient } = await import("@smartagentkit/testing");
  const mockClient = new MockSmartAgentKitClient({
    initialBalance: parseUnits("1", 18),
    verbose: false,
  });

  // WARNING: Foundry well-known test key — never use with real funds
  const OWNER_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as Hex;
  const OWNER_ADDR = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as Address;

  const mockWallet = await mockClient.createWallet({
    owner: OWNER_ADDR,
    ownerPrivateKey: OWNER_KEY,
    preset: "payment-agent",
    presetParams: {
      approvedRecipients: [APPROVED_RECIPIENT],
      dailyLimit: DAILY_LIMIT_USDC,
      guardian: OWNER_ADDR,
    },
  });

  const manager = new MockSentinelWalletManager({
    approvedRecipient: APPROVED_RECIPIENT,
    walletAddress: mockWallet.address,
    dailyLimitAmount: DAILY_LIMIT_USDC,
  });
  await manager.initialize(mockClient, mockWallet);

  pass(`Wallet created: ${mockWallet.address}`);
  info(`Preset: payment-agent (100 USDC/day limit, allowlist: [${APPROVED_RECIPIENT.slice(0, 10)}...])`);
  info("Enforcement: SpendingLimitHook + AllowlistHook + EmergencyPauseHook (simulated in mock)");

  // ── Reset intent tracking for clean demo ──────────────────────────────────
  _resetUsedIntents();

  // ── Happy path ────────────────────────────────────────────────────────────
  section("2. HAPPY PATH — AI Agent Requests Approved Transfer");

  const happyInstruction = `send 10 USDC to ${APPROVED_RECIPIENT} for competition demo payment`;

  // Planner provenance: --llm uses the real LLM (env config) with regex fallback.
  // Either way, the policy engine receives the same untrusted (recipient, amount) pair.
  const llmConfig = IS_LLM ? getLLMConfigFromEnv() : null;
  if (IS_LLM && !llmConfig) {
    warn("--llm passed but LLM_ENDPOINT_URL / LLM_MODEL missing in .env — falling back to regex planner");
  }

  const planResult = llmConfig
    ? await parsePlannerRequestWithLLMFallback(
        {
          chainId: CHAIN_ID,
          walletAddress: mockWallet.address,
          tokenAddress: USDC_BASE_SEPOLIA,
          tokenDecimals: USDC_DECIMALS,
          tokenSymbol: "USDC",
          instruction: happyInstruction,
          agentName: "sentinel-demo-agent",
        },
        llmConfig,
      )
    : parsePlannerRequest({
        chainId: CHAIN_ID,
        walletAddress: mockWallet.address,
        tokenAddress: USDC_BASE_SEPOLIA,
        tokenDecimals: USDC_DECIMALS,
        tokenSymbol: "USDC",
        instruction: happyInstruction,
        agentName: "sentinel-demo-agent",
      });

  if (!planResult.success || !planResult.intent) {
    fail(`Planner failed: ${planResult.error}`);
    process.exit(1);
  }

  pass(
    planResult.planner === "llm"
      ? `Planner parsed WITH LLM (${llmConfig!.model}): "${planResult.parsedAction}"`
      : `Planner parsed (deterministic regex planner): "${planResult.parsedAction}"`,
  );
  info("Planner output is untrusted input — policy checks are identical for LLM and regex");
  info(`Intent ID: ${planResult.intent.intentId.slice(0, 32)}...`);
  info(`Expires at: ${new Date(planResult.intent.expiresAt * 1000).toISOString()}`);
  info(`Calldata: ${planResult.intent.calldata.slice(0, 34)}... (deterministically encoded)`);

  const happyRecord = await manager.executeIntent(planResult.intent);

  if (happyRecord.decision.status === "approved") {
    pass(`Policy: APPROVED — ${happyRecord.decision.reason}`);
    pass(`TPDR integrity: ${happyRecord.integrityCheck?.passed ? "VERIFIED" : "FAILED"}`);
    if (happyRecord.execution?.success) {
      pass(`Execution: SUCCESS — TX: ${happyRecord.execution.txHash}`);
    } else {
      pass(`Execution: ATTEMPTED (mock mode — no live tx)`);
      info(`Intent ID recorded in TPDR audit log`);
    }
  } else {
    fail(`Unexpected rejection: ${happyRecord.decision.reason}`);
  }

  // ── Security tests ────────────────────────────────────────────────────────
  section("3. SECURITY TESTS — Policy Enforcement");

  // Test 1: Spending limit
  console.log(`\n  ${BOLD}[Test 1] Spending Limit Exceeded${RESET}`);
  info("Attempting 150 USDC transfer (limit: 100 USDC)...");

  const overLimitIntent = buildTransferIntent({
    chainId: CHAIN_ID,
    walletAddress: mockWallet.address,
    tokenAddress: USDC_BASE_SEPOLIA,
    recipient: APPROVED_RECIPIENT,
    amount: parseUnits("150", USDC_DECIMALS),
    amountHuman: "150 USDC",
    proposedBy: "malicious-agent",
    reason: "over-limit test",
  });
  const r1 = await manager.executeIntent(overLimitIntent);
  if (r1.decision.status === "rejected" && r1.decision.failedCheck === "spending_limit") {
    pass(`REJECTED — ${r1.decision.reason}`);
    info("On-chain equivalent: SpendingLimitHook.SpendingLimitExceeded revert");
  } else {
    fail(`Expected rejection but got: ${r1.decision.status}`);
  }

  // Test 2: Unapproved recipient
  console.log(`\n  ${BOLD}[Test 2] Unapproved Recipient${RESET}`);
  info(`Attempting transfer to ${BLOCKED_RECIPIENT.slice(0, 12)}... (not in allowlist)...`);

  const blockedIntent = buildTransferIntent({
    chainId: CHAIN_ID,
    walletAddress: mockWallet.address,
    tokenAddress: USDC_BASE_SEPOLIA,
    recipient: BLOCKED_RECIPIENT,
    amount: parseUnits("10", USDC_DECIMALS),
    amountHuman: "10 USDC",
    proposedBy: "malicious-agent",
    reason: "blocked recipient test",
  });
  const r2 = await manager.executeIntent(blockedIntent);
  if (r2.decision.status === "rejected" && r2.decision.failedCheck === "recipient_allowlist") {
    pass(`REJECTED — ${r2.decision.reason}`);
    info("On-chain equivalent: AllowlistHook.TargetNotAllowed revert");
  } else {
    fail(`Expected rejection but got: ${r2.decision.status}`);
  }

  // Test 3: Administrative bypass attempt
  console.log(`\n  ${BOLD}[Test 3] Admin Bypass — Agent Tries to Call Hook Directly${RESET}`);
  info("SpendingLimitHook is a protectedTarget in AllowlistHook — direct calls blocked on-chain");
  info("In TPDR layer: selector check rejects non-transfer calls");

  const adminIntent = buildTransferIntent({
    chainId: CHAIN_ID,
    walletAddress: mockWallet.address,
    tokenAddress: USDC_BASE_SEPOLIA,
    recipient: APPROVED_RECIPIENT,
    amount: parseUnits("1", USDC_DECIMALS),
    amountHuman: "1 USDC",
    proposedBy: "malicious-agent",
    reason: "admin bypass test",
  });
  // Tamper: replace calldata with removeSpendingLimit call
  const tamperedAdminIntent: TransactionIntent = {
    ...adminIntent,
    targetContract: "0xd67a5E6784A66Ddf4C09EA7bbf81Ab89532624E4", // SpendingLimitHook address
    // calldata deliberately left as transfer — integrity check catches target mismatch
    calldata: ("0x" + "139d7fed" + USDC_BASE_SEPOLIA.slice(2).padStart(64, "0")) as Hex,
    functionSelector: "0x139d7fed" as Hex, // removeSpendingLimit selector
  };
  const r3 = await manager.executeIntent(tamperedAdminIntent);
  if (r3.decision.status === "rejected") {
    pass(`REJECTED — ${r3.decision.reason}`);
    info("On-chain equivalent: AllowlistHook.ProtectedTargetBlocked revert");
  } else {
    fail(`Expected rejection but got: ${r3.decision.status}`);
  }

  // Test 4: Emergency pause
  console.log(`\n  ${BOLD}[Test 4] Emergency Pause${RESET}`);
  info("Setting wallet to paused state...");

  manager.setPausedState(true);
  const pausedIntent = buildTransferIntent({
    chainId: CHAIN_ID,
    walletAddress: mockWallet.address,
    tokenAddress: USDC_BASE_SEPOLIA,
    recipient: APPROVED_RECIPIENT,
    amount: parseUnits("5", USDC_DECIMALS),
    amountHuman: "5 USDC",
    proposedBy: "agent",
    reason: "pause test",
  });
  const r4 = await manager.executeIntent(pausedIntent);
  if (r4.decision.status === "rejected" && r4.decision.failedCheck === "wallet_paused") {
    pass(`REJECTED — ${r4.decision.reason}`);
    info("On-chain equivalent: EmergencyPauseHook.WalletPaused revert");
  } else {
    fail(`Expected rejection but got: ${r4.decision.status}`);
  }
  manager.setPausedState(false); // restore

  // Test 5: Delegatecall (policy engine check)
  console.log(`\n  ${BOLD}[Test 5] Delegatecall / Wrong Selector${RESET}`);
  info("Intent with non-transfer selector is rejected by selector_match check...");
  const wrongSelectorIntent: TransactionIntent = {
    ...buildTransferIntent({
      chainId: CHAIN_ID,
      walletAddress: mockWallet.address,
      tokenAddress: USDC_BASE_SEPOLIA,
      recipient: APPROVED_RECIPIENT,
      amount: parseUnits("5", USDC_DECIMALS),
      amountHuman: "5 USDC",
    }),
    functionSelector: "0x00000000" as Hex, // not a transfer selector
    calldata: "0x00000000" as Hex,
  };
  const r5 = await manager.executeIntent(wrongSelectorIntent);
  if (r5.decision.status === "rejected") {
    pass(`REJECTED — ${r5.decision.reason}`);
    info("On-chain equivalent: AllowlistHook.DelegateCallNotAllowed revert");
  } else {
    fail(`Expected rejection but got: ${r5.decision.status}`);
  }

  // ── TPDR Tamper Tests ─────────────────────────────────────────────────────
  section("4. TPDR — Transaction Integrity Tests");

  // TPDR Test 1: Tampered recipient in calldata
  console.log(`\n  ${BOLD}[TPDR-1] Tampered Calldata — Different Recipient${RESET}`);
  info("Approved intent has recipient A, calldata manually replaced with recipient B...");

  const originalIntent = buildTransferIntent({
    chainId: CHAIN_ID,
    walletAddress: mockWallet.address,
    tokenAddress: USDC_BASE_SEPOLIA,
    recipient: APPROVED_RECIPIENT,
    amount: parseUnits("10", USDC_DECIMALS),
    amountHuman: "10 USDC",
    proposedBy: "agent",
    reason: "tpdr test",
  });

  // Simulate calldata mutation: replace recipient in calldata
  const maliciousRecipient = BLOCKED_RECIPIENT;
  const selector = "a9059cbb";
  const badRecipientPadded = maliciousRecipient.slice(2).padStart(64, "0");
  const amountHex = parseUnits("10", USDC_DECIMALS).toString(16).padStart(64, "0");
  const tamperedCalldata = ("0x" + selector + badRecipientPadded + amountHex) as Hex;

  // Run policy check on original (should pass)
  const policy = evaluateIntent(originalIntent, {
    chainId: CHAIN_ID,
    walletAddress: mockWallet.address,
    approvedRecipients: [APPROVED_RECIPIENT],
    dailyLimitAmount: DAILY_LIMIT_USDC,
    spentSoFar: parseUnits("10", USDC_DECIMALS), // 10 already spent from happy path
    isPaused: false,
  });

  // Run integrity check with tampered calldata
  const integrityResult = verifyIntegrity(originalIntent, {
    target: originalIntent.targetContract,
    value: 0n,
    calldata: tamperedCalldata, // TAMPERED
    chainId: CHAIN_ID,
    walletAddress: mockWallet.address,
  });

  if (!integrityResult.passed && integrityResult.mismatchedField) {
    pass(`TPDR caught tampering: mismatch on field "${integrityResult.mismatchedField}"`);
    info(`Expected calldata: ${originalIntent.calldata.slice(0, 34)}...`);
    info(`Received calldata: ${tamperedCalldata.slice(0, 34)}...`);
  } else {
    fail("TPDR failed to detect calldata tampering");
  }

  // TPDR Test 2: Expired intent
  console.log(`\n  ${BOLD}[TPDR-2] Expired Intent${RESET}`);
  info("Intent with expiresAt in the past is rejected by policy engine...");

  const expiredIntent: TransactionIntent = {
    ...buildTransferIntent({
      chainId: CHAIN_ID,
      walletAddress: mockWallet.address,
      tokenAddress: USDC_BASE_SEPOLIA,
      recipient: APPROVED_RECIPIENT,
      amount: parseUnits("5", USDC_DECIMALS),
      amountHuman: "5 USDC",
    }),
    expiresAt: Math.floor(Date.now() / 1000) - 60, // 1 minute ago
  };
  const expiredResult = await manager.executeIntent(expiredIntent);
  if (expiredResult.decision.failedCheck === "intent_expiry") {
    pass(`REJECTED — ${expiredResult.decision.reason}`);
  } else {
    fail(`Expected expiry rejection, got: ${expiredResult.decision.failedCheck}`);
  }

  // TPDR Test 3: Replay attack
  console.log(`\n  ${BOLD}[TPDR-3] Replay Attack — Same Intent ID Used Twice${RESET}`);
  info("Executing intent once (should succeed), then replaying same intentId...");

  const replayIntent = buildTransferIntent({
    chainId: CHAIN_ID,
    walletAddress: mockWallet.address,
    tokenAddress: USDC_BASE_SEPOLIA,
    recipient: APPROVED_RECIPIENT,
    amount: parseUnits("5", USDC_DECIMALS),
    amountHuman: "5 USDC",
    proposedBy: "replay-test",
    reason: "first execution",
  });

  const firstExec = await manager.executeIntent(replayIntent);
  info(`First execution: ${firstExec.decision.status}`);

  // Attempt to replay — same intentId
  const replayExec = await manager.executeIntent(replayIntent);
  if (replayExec.decision.failedCheck === "intent_id_replay") {
    pass(`REPLAY REJECTED — ${replayExec.decision.reason}`);
  } else {
    fail(`Expected replay rejection, got: ${replayExec.decision.failedCheck}`);
  }

  // ── TPDR Log Summary ──────────────────────────────────────────────────────
  section("5. TPDR AUDIT LOG");

  const log = manager.getTPDRLog();
  console.log(`\n  Total records: ${BOLD}${log.length}${RESET}`);
  console.log(
    `  Approved: ${GREEN}${log.filter((r) => r.decision.status === "approved").length}${RESET}  ` +
    `Rejected: ${RED}${log.filter((r) => r.decision.status === "rejected").length}${RESET}`,
  );

  log.forEach((record, i) => printTPDR(record, i + 1));

  // ── Final summary ─────────────────────────────────────────────────────────
  section("6. ENFORCEMENT SUMMARY");

  console.log(`
  ${BOLD}ON-CHAIN (EVM-level, cannot be bypassed by agent):${RESET}
    ${GREEN}✔${RESET}  SpendingLimitHook   → per-token daily limits
    ${GREEN}✔${RESET}  AllowlistHook       → approved recipients only + delegatecall blocked
    ${GREEN}✔${RESET}  EmergencyPauseHook  → guardian pause/unpause
    ${GREEN}✔${RESET}  ERC-4337 EntryPoint → nonce replay protection

  ${BOLD}OFF-CHAIN (TPDR layer — pre-submission checks):${RESET}
    ${GREEN}✔${RESET}  Chain ID binding
    ${GREEN}✔${RESET}  Wallet address binding
    ${GREEN}✔${RESET}  Intent expiry
    ${GREEN}✔${RESET}  Intent ID replay protection (in-memory, this session)
    ${GREEN}✔${RESET}  Calldata integrity (decoded and compared pre-submission)
    ${GREEN}✔${RESET}  Recipient allowlist (pre-flight, on-chain authoritative)
    ${GREEN}✔${RESET}  Spending limit (pre-flight, on-chain authoritative)
    ${GREEN}✔${RESET}  Wallet pause state (pre-flight, on-chain authoritative)

  ${BOLD}NOT PROTECTED:${RESET}
    ${YELLOW}⚠${RESET}  Malicious bundler censorship or delay
    ${YELLOW}⚠${RESET}  Compromised owner key
    ${YELLOW}⚠${RESET}  Token-wrapping bypass (ETH→WETH evades ETH limit)
    ${YELLOW}⚠${RESET}  Non-standard ERC-20 (permit, multicall) not tracked by SpendingLimitHook
  `);

  if (IS_MOCK) {
    console.log(`${BOLD}${CYAN}  Run 'pnpm demo' with a funded .env for live Base Sepolia transaction.${RESET}\n`);
  }
}

// ─── Live Demo (requires .env) ────────────────────────────────────────────────

async function runLiveDemo(): Promise<void> {
  banner("SENTINEL WALLET — LIVE TESTNET DEMO (BASE SEPOLIA)");

  const rpcUrl       = process.env["RPC_URL"];
  const bundlerUrl   = process.env["BUNDLER_URL"];
  const ownerAddress = process.env["OWNER_ADDRESS"] as Address | undefined;
  const ownerKey     = process.env["OWNER_PRIVATE_KEY"] as Hex | undefined;
  const approvedRecipient = process.env["APPROVED_RECIPIENT"] as Address | undefined;
  const guardianAddress   = process.env["GUARDIAN_ADDRESS"] as Address | undefined;

  const missing: string[] = [];
  if (!rpcUrl)            missing.push("RPC_URL");
  if (!bundlerUrl)        missing.push("BUNDLER_URL");
  if (!ownerAddress)      missing.push("OWNER_ADDRESS");
  if (!ownerKey)          missing.push("OWNER_PRIVATE_KEY");
  if (!approvedRecipient) missing.push("APPROVED_RECIPIENT");

  if (missing.length > 0) {
    console.error(`\n${RED}Missing environment variables: ${missing.join(", ")}${RESET}`);
    console.error(`Copy .env.example to .env and fill in the values.\n`);
    process.exit(1);
  }

  console.log(`\n${YELLOW}⚠  This demo will broadcast real transactions on Base Sepolia.${RESET}`);
  console.log(`${YELLOW}⚠  Ensure ${ownerAddress} has Base Sepolia ETH for gas.${RESET}`);
  console.log(`${DIM}   (Press Ctrl+C in the next 3 seconds to abort...)${RESET}`);

  await new Promise((r) => setTimeout(r, 3000));

  const { SentinelWalletManager } = await import("./wallet.js");

  section("1. DEPLOYING WALLET");

  const walletManager = new SentinelWalletManager({
    rpcUrl: rpcUrl!,
    bundlerUrl: bundlerUrl!,
    ownerKey: ownerKey!,
    approvedRecipient: approvedRecipient!,
    walletAddress: ownerAddress!, // placeholder, updated after deploy
    dailyLimitAmount: DAILY_LIMIT_USDC,
  });

  info("Deploying Safe + ERC-7579 hooks via payment-agent preset...");
  info("(This sends one UserOperation to Base Sepolia — may take 15-30s)");

  const wallet = await walletManager.deployWallet({
    ownerAddress: ownerAddress!,
    approvedRecipient: approvedRecipient!,
    guardianAddress: guardianAddress ?? ownerAddress!,
    dailyLimitAmount: DAILY_LIMIT_USDC,
    usdcAddress: USDC_BASE_SEPOLIA,
  });

  pass(`Wallet deployed: ${wallet.address}`);
  console.log(
    `  ${CYAN}https://sepolia.basescan.org/address/${wallet.address}${RESET}`,
  );

  section("2. APPROVED TRANSFER");

  _resetUsedIntents();

  const planResult = parsePlannerRequest({
    chainId: CHAIN_ID,
    walletAddress: wallet.address,
    tokenAddress: USDC_BASE_SEPOLIA,
    tokenDecimals: USDC_DECIMALS,
    tokenSymbol: "USDC",
    instruction: `send 10 USDC to ${approvedRecipient} for fintech competition demo`,
    agentName: "sentinel-live-agent",
  });

  if (!planResult.success || !planResult.intent) {
    fail(`Planner error: ${planResult.error}`);
    process.exit(1);
  }

  info(`Intent: ${planResult.parsedAction}`);
  info("Submitting UserOperation to Pimlico bundler...");

  const record = await walletManager.executeIntent(planResult.intent!);

  if (record.execution?.success && record.execution.txHash) {
    pass(`Transaction SUCCESS`);
    console.log(`\n  ${BOLD}TX Hash: ${record.execution.txHash}${RESET}`);
    console.log(
      `  ${CYAN}https://sepolia.basescan.org/tx/${record.execution.txHash}${RESET}`,
    );
    console.log(`\n  ${GREEN}${BOLD}🎯 Real Base Sepolia transaction confirmed.${RESET}\n`);
  } else {
    fail(`Execution failed: ${record.execution?.error ?? record.decision.reason}`);
  }
}

// ─── Entry point ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (IS_MOCK) {
    await runMockDemo();
  } else {
    await runLiveDemo();
  }
}

main().catch((err: Error) => {
  console.error(`\n${RED}Fatal error: ${err.message}${RESET}`);
  if (process.env["DEBUG"]) console.error(err.stack);
  process.exit(1);
});
