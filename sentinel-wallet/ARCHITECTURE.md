# Sentinel Wallet — Architecture & Data Flow

---

## System Overview

```
┌─────────────────────────────────────────────────────────────┐
│  Layer 1: AI Agent / Planner  (src/planner.ts)              │
│  • Parses natural language: "send 10 USDC to 0x..."         │
│  • CANNOT inject calldata — only provides recipient+amount  │
│  • Currently: deterministic regex (no real LLM)             │
└─────────────────────┬───────────────────────────────────────┘
                      │ PlannerResult → TransactionIntent
                      ▼
┌─────────────────────────────────────────────────────────────┐
│  Layer 2: Intent Builder  (src/intent.ts)                   │
│  • buildTransferIntent() — validates, normalizes addresses  │
│  • Deterministically encodes calldata from typed fields     │
│  • Generates unique intentId (32 bytes random)              │
│  • Sets expiresAt = now + 300s                              │
└─────────────────────┬───────────────────────────────────────┘
                      │ TransactionIntent
                      ▼
┌─────────────────────────────────────────────────────────────┐
│  Layer 3: Policy Engine  (src/policy.ts)                    │
│  • evaluateIntent() — 10 deterministic checks               │
│  ├── chain_id         (intent.chainId === config.chainId)   │
│  ├── wallet_binding   (lowercase address compare)           │
│  ├── intent_expiry    (expiresAt > now)                     │
│  ├── intent_id_replay (Set<string> in-memory)               │
│  ├── amount_positive  (amount > 0n)                         │
│  ├── selector_match   (must be 0xa9059cbb)                  │
│  ├── calldata_integrity (re-encode + compare)               │
│  ├── recipient_allowlist (includes check)                   │
│  ├── spending_limit   (amount <= remaining)                 │
│  └── wallet_paused    (!isPaused)                           │
│  → PolicyDecision { status, reason, failedCheck, checks }   │
└─────────────────────┬───────────────────────────────────────┘
                      │ If APPROVED
                      ▼
┌─────────────────────────────────────────────────────────────┐
│  Layer 4: TPDR Verifier  (src/integrity.ts)                 │
│  • verifyIntegrity() — compare execute() inputs vs intent   │
│  ├── chainId matches?                                       │
│  ├── walletAddress matches?                                 │
│  ├── targetContract matches?                                │
│  └── calldata matches? (+ decode individual fields if not) │
│  → IntegrityCheckResult { passed, verifiedFields, ... }     │
│                                                             │
│  NOTE: Checks inputs to execute(), not final signed UserOp  │
└─────────────────────┬───────────────────────────────────────┘
                      │ If PASSED
                      ▼
┌─────────────────────────────────────────────────────────────┐
│  Layer 5: SDK + Bundler  (@smartagentkit/sdk)               │
│  • Builds ERC-4337 UserOperation                            │
│  • Signs with owner private key (ECDSA)                     │
│  • Submits to Pimlico bundler                               │
│  → bundler → EntryPoint (nonce + sig validation)            │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│  Layer 6: On-Chain Hooks  (Base Sepolia EVM)                │
│  Safe Smart Account → HookMultiPlexer                       │
│  ├── SpendingLimitHook.preCheck()  → revert if over limit   │
│  ├── AllowlistHook.preCheck()      → revert if not approved │
│  └── EmergencyPauseHook.preCheck() → revert if paused       │
│                                                             │
│  ✅ THESE CANNOT BE BYPASSED — EVM level enforcement        │
│  Bytecode verified at block 48213472, Base Sepolia          │
└─────────────────────────────────────────────────────────────┘
```

---

## File Structure

```
sentinel-wallet/
├── src/
│   ├── types.ts       TransactionIntent, PolicyDecision, TPDRRecord
│   ├── intent.ts      buildTransferIntent() — anti-injection boundary
│   ├── policy.ts      evaluateIntent() — 10 checks, replay Set
│   ├── integrity.ts   verifyIntegrity(), decodeTransferCalldata()
│   ├── planner.ts     parsePlannerRequest() + getDemoScenarios()
│   ├── wallet.ts      SentinelWalletManager + MockSentinelWalletManager
│   └── demo.ts        Full demo runner (mock + live modes)
├── src/__tests__/
│   ├── intent.test.ts     (13 tests)
│   ├── policy.test.ts     (29 tests)
│   ├── integrity.test.ts  (12 tests)
│   ├── planner.test.ts    (9 tests)
│   └── security.test.ts   (20 tests — 5 negative + 8 TPDR + 2 positive)
├── scripts/
│   ├── generate-wallet.ts  Fresh keypair generator
│   ├── verify-onchain.ts   Bytecode verification (no key needed)
│   ├── check-balance.ts    ETH + USDC balance check
│   └── live-test.ts        Real on-chain test script
├── docs/
│   ├── security-model.md  Full threat model
│   └── llm-audit.md       LLM provider audit
├── .env.example           Required environment variables
├── package.json
├── tsconfig.json
└── vitest.config.js
```

---

## Key Data Types

### TransactionIntent (src/types.ts)
```typescript
{
  intentId: string          // "intent_" + 64 hex (replay protection)
  chainId: number           // 84532 (Base Sepolia)
  walletAddress: Address    // Smart wallet address
  targetContract: Address   // ERC-20 token contract
  functionSelector: Hex     // "0xa9059cbb" (transfer only)
  tokenAddress: Address     // Same as targetContract
  recipient: Address        // Where USDC goes
  amount: bigint            // In token's smallest unit (6 decimals for USDC)
  amountHuman: string       // "10 USDC"
  calldata: Hex             // ABI-encoded, NOT agent-provided
  expiresAt: number         // Unix timestamp (now + 300s)
  createdAt: string         // ISO 8601
  proposedBy: string        // Agent name
  reason: string            // Human description
}
```

### TPDRRecord (src/types.ts)
```typescript
{
  intent: TransactionIntent      // Original request
  decision: PolicyDecision       // All 10 check results
  integrityCheck?: IntegrityCheckResult  // Pre-submission verify
  execution?: ExecutionResult    // On-chain result + txHash
  recordedAt: string             // Audit timestamp
}
```

---

## On-Chain Contract Addresses (Base Sepolia)

| Contract | Address | Bytecode Size |
|---------|---------|--------------|
| SpendingLimitHook | `0xd67a5E6784A66Ddf4C09EA7bbf81Ab89532624E4` | 5,537 bytes |
| AllowlistHook | `0x7899b03386A3874393A3769D637977d947A9Fc66` | 7,906 bytes |
| EmergencyPauseHook | `0xAc0cE5672aED1Bfe5549b885f883a770Acd8cAE3` | 5,252 bytes |
| HookMultiPlexer | `0xF6782ed057F95f334D04F0Af1Af4D14fb84DE549` | 9,440 bytes |
| EntryPoint v0.7 | `0x0000000071727De22E5E9d8BAf0edAc6f37da032` | 16,035 bytes |
| USDC | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` | 1,798 bytes |

Verified via public RPC `https://sepolia.base.org` at block 48213472.

---

## Security Properties

| Property | Enforced Where | Bypass Possible? |
|---------|---------------|-----------------|
| Spending limit | On-chain (SpendingLimitHook) | No — EVM revert |
| Recipient allowlist | On-chain (AllowlistHook) | No — EVM revert |
| Emergency pause | On-chain (EmergencyPauseHook) | No — EVM revert |
| Delegatecall block | On-chain (all 3 hooks) | No — EVM revert |
| ERC-4337 nonce replay | On-chain (EntryPoint) | No — EVM revert |
| Intent expiry | Off-chain (policy engine) | Yes if pipeline bypassed |
| Intent ID replay | Off-chain (in-memory Set) | Yes on process restart |
| Calldata integrity | Off-chain (TPDR) | Yes after execute() inputs |
| Chain binding | Off-chain (policy engine) | Yes if pipeline bypassed |

---

## Known Limitations

1. **In-memory replay protection** — `_usedIntentIds` Set clears on restart
2. **In-memory spending tracker** — not synced with on-chain `SpendingLimitHook.getRemainingAllowance()`
3. **TPDR scope** — checks inputs to `execute()`, not final signed UserOp
4. **No real tx hash** — testnet ETH issues prevented live transaction during development
5. **Planner is not real AI** — regex patterns only, no LLM
6. **Token wrapping bypass** — ETH→WETH conversion evades ETH spending limit
7. **Non-standard ERC-20** — `permit()`, `multicall()` not tracked by SpendingLimitHook
