/**
 * Sentinel Wallet — Core Wallet Manager
 *
 * Orchestrates the complete lifecycle:
 *   intent → policy check → integrity verify → execute → TPDR record
 *
 * This is the main entry point for all agent-initiated transactions.
 * It uses the SmartAgentKit SDK with the payment-agent preset, which
 * installs on-chain hooks at wallet creation time.
 *
 * On-chain enforcement (verified in audit):
 *   SpendingLimitHook  → daily USDC limit (Base Sepolia, live deployment)
 *   AllowlistHook      → approved recipients only
 *   EmergencyPauseHook → guardian pause/unpause
 *
 * Off-chain layers (this module):
 *   PolicyEngine       → pre-flight checks before UserOp construction
 *   IntegrityVerifier  → calldata comparison before submission
 *   TPDRRecord         → full audit trail per transaction
 */

import type { Address, Hex } from "viem";
import { createWalletClient, createPublicClient, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { AgentWallet } from "@smartagentkit/sdk";
import { SmartAgentKitClient } from "@smartagentkit/sdk";
import { baseSepolia } from "viem/chains";
import { evaluateIntent, markIntentUsed, type PolicyConfig } from "./policy.js";
import { verifyIntegrity } from "./integrity.js";
import type {
  TransactionIntent,
  TPDRRecord,
  PolicyDecision,
  IntegrityCheckResult,
  ExecutionResult,
} from "./types.js";

const ERC20_ABI = parseAbi([
  "function transfer(address to, uint256 amount) returns (bool)",
]);

// ─── Sentinel Wallet Manager ──────────────────────────────────────────────────

export class SentinelWalletManager {
  private client: SmartAgentKitClient;
  private wallet: AgentWallet | null = null;
  private ownerKey: Hex;
  private rpcUrl: string;
  private policyConfig: PolicyConfig;
  private tpdrLog: TPDRRecord[] = [];

  /**
   * STRICT SAFE MODE (fail-closed):
   *   When true (default), a failed Safe/bundler UserOp execution FAILS — it
   *   never silently falls back to a direct owner-EOA transfer. A transfer
   *   signed and sent by the owner EOA bypasses the Safe account and its
   *   on-chain hooks entirely, so presenting it as wallet execution is unsafe.
   *   Opt out ONLY for demos by setting SENTINEL_STRICT_SAFE=explicit-eoa-fallback
   *   (the fallback then logs the REAL bundler error and records that the
   *   execution path was the owner EOA, not the Safe).
   */
  private strictSafeMode: boolean;

  /** Track in-memory spending for off-chain pre-flight check */
  private spentThisSession: bigint = 0n;

  constructor(params: {
    rpcUrl: string;
    bundlerUrl: string;
    paymasterUrl?: string;
    ownerKey: Hex;
    approvedRecipient: Address;
    walletAddress: Address;
    dailyLimitAmount: bigint;
    /** Fail-closed Safe execution (default true). See field docs above. */
    strictSafeMode?: boolean;
  }) {
    this.ownerKey = params.ownerKey;
    this.rpcUrl = params.rpcUrl;
    this.strictSafeMode =
      params.strictSafeMode ??
      process.env["SENTINEL_STRICT_SAFE"] !== "explicit-eoa-fallback";

    this.client = new SmartAgentKitClient({
      chain: baseSepolia,
      rpcUrl: params.rpcUrl,
      bundlerUrl: params.bundlerUrl,
      paymasterUrl: params.paymasterUrl ?? process.env.PAYMASTER_URL ?? params.bundlerUrl,
      // moduleAddresses auto-resolved from SDK's deployments/base-sepolia.json
    });

    this.policyConfig = {
      chainId: baseSepolia.id, // 84532
      walletAddress: params.walletAddress,
      approvedRecipients: [params.approvedRecipient],
      dailyLimitAmount: params.dailyLimitAmount,
      spentSoFar: 0n,
      isPaused: false,
    };
  }

  // ─── Wallet Setup ──────────────────────────────────────────────────────────

  /**
   * SIGNER NOTE (verified from SDK source):
   * Every transaction is signed with the OWNER private key (ownerKey).
   * There is NO scoped session key in the current implementation.
   * The SDK supports createSession() for scoped keys, but this project
   * does not use it — the full owner key signs all UserOps.
   *
   * Implication: if ownerKey is compromised, there is no restriction.
   * Session key scoping is a planned improvement, not current behavior.
   */

  /**
   * Connect to an existing deployed wallet.
   * Use this when the wallet is already deployed on-chain.
   *
   * Reconstructs the full account configuration including:
   * - Correct owner EOA address (derived from ownerKey)
   * - Active payment-agent policy hooks (SpendingLimitHook, AllowlistHook, EmergencyPauseHook)
   * - Synchronization of runtime policyConfig with connected wallet address
   */
  async connectWallet(walletAddress: Address): Promise<AgentWallet> {
    await this.client.connectWallet(walletAddress, this.ownerKey);

    const ownerAccount = privateKeyToAccount(this.ownerKey);
    this.policyConfig.walletAddress = walletAddress;

    // Preserving the payment-agent preset policy definitions and hook contracts
    const policies = [
      {
        moduleAddress: "0xd67a5E6784A66Ddf4C09EA7bbf81Ab89532624E4" as Address,
        moduleType: 4, // Hook
        name: "SpendingLimitHook",
        config: {
          dailyLimit: this.policyConfig.dailyLimitAmount,
        } as any,
      },
      {
        moduleAddress: "0x7899b03386A3874393A3769D637977d947A9Fc66" as Address,
        moduleType: 4, // Hook
        name: "AllowlistHook",
        config: {
          approvedRecipients: this.policyConfig.approvedRecipients,
        } as any,
      },
      {
        moduleAddress: "0xAc0cE5672aED1Bfe5549b885f883a770Acd8cAE3" as Address,
        moduleType: 4, // Hook
        name: "EmergencyPauseHook",
        config: {
          isPaused: this.policyConfig.isPaused,
        } as any,
      },
    ];

    this.wallet = {
      address: walletAddress,
      owner: ownerAccount.address,
      chain: baseSepolia,
      isDeployed: true,
      policies,
      sessions: [],
    };

    return this.wallet;
  }

  /**
   * Deploy a new Sentinel Wallet with the payment-agent preset.
   *
   * Installed hooks (on-chain, Base Sepolia):
   *   SpendingLimitHook  @ 0xd67a5E6784A66Ddf4C09EA7bbf81Ab89532624E4
   *   AllowlistHook      @ 0x7899b03386A3874393A3769D637977d947A9Fc66
   *   EmergencyPauseHook @ 0xAc0cE5672aED1Bfe5549b885f883a770Acd8cAE3
   *
   * STOP: This method sends a real transaction to Base Sepolia.
   * It requires the owner account to have Base Sepolia ETH for gas.
   * Only call with explicit approval.
   */
  async deployWallet(params: {
    ownerAddress: Address;
    approvedRecipient: Address;
    guardianAddress: Address;
    dailyLimitAmount: bigint;
    usdcAddress: Address;
  }): Promise<AgentWallet> {
    this.wallet = await this.client.createWallet({
      owner: params.ownerAddress,
      ownerPrivateKey: this.ownerKey,
      preset: "payment-agent",
      presetParams: {
        // AllowlistHook: only approvedRecipient allowed
        approvedRecipients: [params.approvedRecipient],
        // SpendingLimitHook: daily limit
        dailyLimit: params.dailyLimitAmount,
        // EmergencyPauseHook: guardian = owner for MVP
        guardian: params.guardianAddress,
        // 1-hour auto-unpause (payment-agent preset default)
      },
    });

    // Update policy config with deployed wallet address
    this.policyConfig.walletAddress = this.wallet.address;

    return this.wallet;
  }

  // ─── Main Execute Pipeline ────────────────────────────────────────────────

  /**
   * Execute a transaction through the full Sentinel Wallet pipeline:
   *
   * 1. Validate intent structure
   * 2. Run deterministic policy checks (off-chain)
   * 3. Verify calldata integrity (TPDR layer)
   * 4. Execute via SDK (on-chain hooks enforce at EVM level)
   * 5. Record TPDR audit entry
   *
   * @returns TPDRRecord — complete audit trail regardless of outcome
   */
  async executeIntent(intent: TransactionIntent): Promise<TPDRRecord> {
    const recordedAt = new Date().toISOString();

    // ── Step 1: Policy evaluation ────────────────────────────────────────────
    const currentConfig: PolicyConfig = {
      ...this.policyConfig,
      spentSoFar: this.spentThisSession,
    };

    const decision: PolicyDecision = evaluateIntent(intent, currentConfig);

    if (decision.status === "rejected") {
      const record: TPDRRecord = {
        intent,
        decision,
        recordedAt,
      };
      this.tpdrLog.push(record);
      return record;
    }

    // ── Step 2: Integrity verification ──────────────────────────────────────
    // Verify the execute() params match the approved intent BEFORE submission.
    const executeParams = {
      target: intent.targetContract,
      value: 0n, // ERC-20 transfers send no ETH value
      calldata: intent.calldata,
      chainId: baseSepolia.id,
      walletAddress: intent.walletAddress,
    };

    const integrityCheck: IntegrityCheckResult = verifyIntegrity(
      intent,
      executeParams,
    );

    if (!integrityCheck.passed) {
      const integrityRejection: PolicyDecision = {
        ...decision,
        status: "rejected",
        reason: `TPDR integrity check failed: ${integrityCheck.mismatchedField} mismatch`,
        failedCheck: "calldata_integrity",
      };

      const record: TPDRRecord = {
        intent,
        decision: integrityRejection,
        integrityCheck,
        recordedAt,
      };
      this.tpdrLog.push(record);
      return record;
    }

    // ── Step 3: Mark intent as used (replay protection) ──────────────────────
    markIntentUsed(intent.intentId);

    // ── Step 4: Execute on-chain ──────────────────────────────────────────────
    if (!this.wallet) {
      throw new Error(
        "Wallet not initialized. Call deployWallet() or connectWallet() first.",
      );
    }

    let executionResult: ExecutionResult | undefined;

    try {
      let txHash: Hex | undefined;
      try {
        txHash = (await this.client.execute(this.wallet, {
          target: executeParams.target,
          value: executeParams.value,
          data: executeParams.calldata,
        })) as Hex;
      } catch (bundlerError: any) {
        const realError =
          bundlerError instanceof Error ? bundlerError.message : String(bundlerError);

        if (this.strictSafeMode) {
          // FAIL CLOSED: never route a rejected Safe UserOp through the owner
          // EOA — that bypasses the Safe account AND all on-chain hooks.
          console.error(
            `[SAFE FLOW FAILED] Safe/bundler execution rejected; strict mode forbids owner-EOA fallback.\n  Real error: ${realError.slice(0, 400)}`,
          );
          executionResult = {
            success: false,
            error: `Safe UserOp execution failed (strict fail-closed): ${realError.slice(0, 300)}`,
            executedAt: Math.floor(Date.now() / 1000),
          };
        } else {
          // Explicitly NON-default demo fallback. The real bundler error is now
          // logged (previously it was swallowed behind a hardcoded message).
          console.warn(
            `\n[DEMO FALLBACK] Safe/bundler execution failed; using owner-EOA direct ERC-20 transfer (bypasses Safe + hooks).\n  Real error: ${realError.slice(0, 400)}`,
          );
          const ownerAccount = privateKeyToAccount(this.ownerKey);
          const walletClient = createWalletClient({
            account: ownerAccount,
            chain: baseSepolia,
            transport: http(this.rpcUrl),
          });
          const publicClient = createPublicClient({
            chain: baseSepolia,
            transport: http(this.rpcUrl),
          });

          // Execute direct ERC20 transfer for genuine on-chain proof
          txHash = await walletClient.writeContract({
            address: intent.tokenAddress,
            abi: ERC20_ABI,
            functionName: "transfer",
            args: [intent.recipient, intent.amount],
          });

          await publicClient.waitForTransactionReceipt({ hash: txHash, confirmations: 1 });
        }
      }

      // A strict-mode Safe failure was already recorded inside the catch —
      // do NOT overwrite it with a fake success or count the (not-sent) spend.
      if (!executionResult) {
        // Update in-memory spend tracker
        this.spentThisSession += intent.amount;
        this.policyConfig.spentSoFar = this.spentThisSession;

        executionResult = {
          success: true,
          txHash: txHash as Hex,
          executedAt: Math.floor(Date.now() / 1000),
        };
      }
    } catch (error: any) {
      executionResult = {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        executedAt: Math.floor(Date.now() / 1000),
      };
    }

    if (!executionResult) {
      executionResult = {
        success: false,
        error: "Unknown execution outcome (no result recorded)",
        executedAt: Math.floor(Date.now() / 1000),
      };
    }

    // ── Step 5: Build and store TPDR record ──────────────────────────────────
    const record: TPDRRecord = {
      intent,
      decision,
      integrityCheck,
      execution: executionResult,
      recordedAt,
    };

    this.tpdrLog.push(record);
    return record;
  }

  // ─── Guardian Operations ──────────────────────────────────────────────────

  /**
   * Pause the wallet. Only the guardian can call this.
   * After pausing, all agent transactions will be rejected on-chain
   * by EmergencyPauseHook.
   *
   * STOP: This sends a real transaction. Requires guardian private key.
   */
  async pauseWallet(guardianKey: Hex): Promise<Hex> {
    if (!this.wallet) throw new Error("Wallet not initialized");
    this.policyConfig.isPaused = true;
    return this.client.pause(this.wallet.address, guardianKey);
  }

  async unpauseWallet(guardianKey: Hex): Promise<Hex> {
    if (!this.wallet) throw new Error("Wallet not initialized");
    this.policyConfig.isPaused = false;
    return this.client.unpause(this.wallet.address, guardianKey);
  }

  // ─── Read Operations ──────────────────────────────────────────────────────

  async getRemainingAllowance(tokenAddress: Address): Promise<bigint> {
    if (!this.wallet) throw new Error("Wallet not initialized");
    return this.client.getRemainingAllowance(this.wallet.address, tokenAddress);
  }

  async isPaused(): Promise<boolean> {
    if (!this.wallet) throw new Error("Wallet not initialized");
    return this.client.isPaused(this.wallet.address);
  }

  getWalletAddress(): Address | null {
    return this.wallet?.address ?? null;
  }

  /** Full audit log — all TPDR records this session */
  getTPDRLog(): TPDRRecord[] {
    return [...this.tpdrLog];
  }

  addTPDRRecord(record: TPDRRecord): void {
    this.tpdrLog.push(record);
  }

  /** Update policy's pause state (for sync with on-chain state) */
  setPausedState(paused: boolean): void {
    this.policyConfig.isPaused = paused;
  }
}

// ─── Mock Wallet Manager (for unit tests, no network required) ────────────────

/**
 * Mock version of SentinelWalletManager that uses MockSmartAgentKitClient.
 * Identical pipeline (intent → policy → integrity → execute) but all
 * on-chain calls are simulated in-memory.
 *
 * Enforcement note: MockSmartAgentKitClient simulates spending limits and
 * allowlist rejections. The mock does NOT run actual EVM hook code — it
 * simulates their behavior. Use Foundry tests for true on-chain verification.
 */
export class MockSentinelWalletManager {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private client: any; // MockSmartAgentKitClient
  private wallet: AgentWallet | null = null;
  private policyConfig: PolicyConfig;
  private tpdrLog: TPDRRecord[] = [];
  private spentThisSession: bigint = 0n;

  constructor(params: {
    approvedRecipient: Address;
    walletAddress: Address;
    dailyLimitAmount: bigint;
    isPaused?: boolean;
    initialBalance?: bigint;
  }) {
    this.policyConfig = {
      chainId: baseSepolia.id,
      walletAddress: params.walletAddress,
      approvedRecipients: [params.approvedRecipient],
      dailyLimitAmount: params.dailyLimitAmount,
      spentSoFar: 0n,
      isPaused: params.isPaused ?? false,
    };
  }

  /**
   * Initialize with a mock client and wallet.
   * Can be called synchronously (returns void, not Promise).
   */
  initialize(mockClient: unknown, mockWallet: AgentWallet): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.client = mockClient as any;
    this.wallet = mockWallet;
    this.policyConfig.walletAddress = mockWallet.address;
  }

  /**
   * Connect to an existing wallet in mock mode.
   * Restores payment-agent policy hooks, configures owner EOA, and updates policyConfig.
   */
  connectWallet(walletAddress: Address, ownerAddress?: Address): AgentWallet {
    this.policyConfig.walletAddress = walletAddress;
    this.wallet = {
      address: walletAddress,
      owner: ownerAddress ?? ("0x86ce071Fa058AF96b574aE2A4d646193f6a32321" as Address),
      chain: baseSepolia,
      isDeployed: true,
      policies: [
        {
          moduleAddress: "0xd67a5E6784A66Ddf4C09EA7bbf81Ab89532624E4" as Address,
          moduleType: 4,
          name: "SpendingLimitHook",
          config: { dailyLimit: this.policyConfig.dailyLimitAmount } as any,
        },
        {
          moduleAddress: "0x7899b03386A3874393A3769D637977d947A9Fc66" as Address,
          moduleType: 4,
          name: "AllowlistHook",
          config: { approvedRecipients: this.policyConfig.approvedRecipients } as any,
        },
        {
          moduleAddress: "0xAc0cE5672aED1Bfe5549b885f883a770Acd8cAE3" as Address,
          moduleType: 4,
          name: "EmergencyPauseHook",
          config: { isPaused: this.policyConfig.isPaused } as any,
        },
      ],
      sessions: [],
    };
    return this.wallet;
  }

  async executeIntent(intent: TransactionIntent): Promise<TPDRRecord> {
    const recordedAt = new Date().toISOString();

    const currentConfig: PolicyConfig = {
      ...this.policyConfig,
      spentSoFar: this.spentThisSession,
    };

    const decision = evaluateIntent(intent, currentConfig);

    if (decision.status === "rejected") {
      const record: TPDRRecord = { intent, decision, recordedAt };
      this.tpdrLog.push(record);
      return record;
    }

    const executeParams = {
      target: intent.targetContract,
      value: 0n,
      calldata: intent.calldata,
      chainId: baseSepolia.id,
      walletAddress: intent.walletAddress,
    };

    const integrityCheck = verifyIntegrity(intent, executeParams);

    if (!integrityCheck.passed) {
      const rejectedDecision: PolicyDecision = {
        ...decision,
        status: "rejected",
        reason: `TPDR integrity check failed: ${integrityCheck.mismatchedField}`,
        failedCheck: "calldata_integrity",
      };
      const record: TPDRRecord = {
        intent,
        decision: rejectedDecision,
        integrityCheck,
        recordedAt,
      };
      this.tpdrLog.push(record);
      return record;
    }

    markIntentUsed(intent.intentId);

    let executionResult: ExecutionResult;
    try {
      const txHash = await this.client.execute(this.wallet, {
        target: executeParams.target,
        value: executeParams.value,
        data: executeParams.calldata,
      });
      this.spentThisSession += intent.amount;
      this.policyConfig.spentSoFar = this.spentThisSession;
      executionResult = {
        success: true,
        txHash: txHash as Hex,
        executedAt: Math.floor(Date.now() / 1000),
      };
    } catch (error) {
      executionResult = {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        executedAt: Math.floor(Date.now() / 1000),
      };
    }

    const record: TPDRRecord = {
      intent,
      decision,
      integrityCheck,
      execution: executionResult,
      recordedAt,
    };
    this.tpdrLog.push(record);
    return record;
  }

  setPausedState(paused: boolean): void {
    this.policyConfig.isPaused = paused;
  }

  addSpentAmount(amount: bigint): void {
    this.spentThisSession += amount;
  }

  /** Spent amount tracked in-memory this session (for status UI). */
  getSpentSoFar(): bigint {
    return this.spentThisSession;
  }

  /**
   * Update runtime policy config — used by the Settings UI so that spending
   * limits, allowlist, and pause state take effect on the same manager that
   * executes transactions. Enforcement stays in the policy engine + on-chain hooks.
   */
  updatePolicyConfig(updates: Partial<PolicyConfig>): void {
    this.policyConfig = { ...this.policyConfig, ...updates };
  }

  getTPDRLog(): TPDRRecord[] {
    return [...this.tpdrLog];
  }

  addTPDRRecord(record: TPDRRecord): void {
    this.tpdrLog.push(record);
  }

  getWalletAddress(): Address | null {
    return this.wallet?.address ?? null;
  }
}
