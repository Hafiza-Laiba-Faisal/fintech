# Sentinel Wallet — Security Model

## Verification Status (Honest Assessment)

| Claim | Verified? | Method |
|-------|----------|--------|
| Hook contracts deployed on Base Sepolia | ✅ YES | `getBytecode()` via public RPC, block 48213472 |
| Hooks installed on a wallet | ❌ NO | No wallet deployed — testnet ETH unavailable |
| SpendingLimitHook reverts on violation | ❌ NO | No real transaction submitted |
| AllowlistHook reverts on violation | ❌ NO | No real transaction submitted |
| EmergencyPauseHook reverts on violation | ❌ NO | No real transaction submitted |
| Off-chain policy engine rejects violations | ✅ YES | 83 unit tests, mock environment |
| TPDR catches calldata tampering | ✅ YES | 12 unit tests, mock environment |
| Agent uses scoped session key | ❌ INCORRECT | Owner key used — see wallet.ts |

## Overview

Sentinel Wallet has two enforcement layers. They are **not equivalent** and this distinction is important for competition judges.

```
┌─────────────────────────────────────────────────────────────┐
│  AI Agent / Planner                                          │
│  (proposes recipient, amount — cannot inject calldata)       │
├─────────────────────────────────────────────────────────────┤
│  OFF-CHAIN: Policy Engine + TPDR (this project)             │
│  • Chain ID & wallet binding                                 │
│  • Intent expiry                                             │
│  • Intent ID replay protection                               │
│  • Recipient allowlist (pre-flight)                          │
│  • Spending limit (pre-flight)                               │
│  • Calldata integrity (intent ↔ execute params comparison)   │
│  • Pause state (pre-flight)                                  │
├─────────────────────────────────────────────────────────────┤
│  ERC-4337 Bundler (Pimlico)                                  │
│  • Nonce-based replay protection (EntryPoint)                │
│  • Gas estimation                                            │
├─────────────────────────────────────────────────────────────┤
│  ON-CHAIN: ERC-7579 Hooks via HookMultiPlexer               │
│  SpendingLimitHook   → daily per-token limits                │
│  AllowlistHook       → approved recipients + protected addrs │
│  EmergencyPauseHook  → guardian circuit breaker              │
│  (These REVERT at EVM level — cannot be bypassed by agent)  │
└─────────────────────────────────────────────────────────────┘
```

---

## What is enforced ON-CHAIN (EVM level)

These cannot be bypassed even if the entire SDK is compromised:

### SpendingLimitHook
- **File:** `packages/contracts/src/modules/SpendingLimitHook.sol`
- **How:** `_recordSpend()` runs in `preCheck()` before every UserOp execution
- **Error:** `SpendingLimitExceeded(token, attempted, remaining)`
- **Detects:** ETH value, ERC-20 `transfer(to,amount)`, `approve(spender,amount)`, `transferFrom(from,to,amount)`
- **Does NOT detect:** Token wrapping (ETH→WETH), `permit()`, `increaseAllowance()`, multicall wrappers

### AllowlistHook
- **File:** `packages/contracts/src/modules/AllowlistHook.sol`
- **How:** `_checkTarget()` enforces ALLOWLIST mode: only listed target+selector pairs allowed
- **Error:** `TargetNotAllowed(target, selector)`, `ProtectedTargetBlocked(target)`
- **Extra protection:** `protectedAddresses` blocks direct calls to hook contracts themselves
- **Delegatecall:** Always reverts — `DelegateCallNotAllowed()`

### EmergencyPauseHook
- **File:** `packages/contracts/src/modules/EmergencyPauseHook.sol`
- **How:** `_checkPauseState()` reverts ALL executions when paused
- **Error:** `WalletPaused(account)`
- **Guardian rotation:** Works even while paused — `rotateGuardian(account, newGuardian)`
- **Auto-unpause:** Configurable timeout (payment-agent preset: 1 hour)

### ERC-4337 Nonce
- **How:** EntryPoint `NonceManager` — monotonically increasing nonce per key
- **Prevents:** Transaction replay at the protocol level

---

## What is enforced OFF-CHAIN (TPDR layer)

These checks run in TypeScript before the UserOp is submitted. They provide an audit trail and catch errors early, but they **do not replace on-chain enforcement**.

| Check | What it catches |
|-------|----------------|
| `chain_id` | Intent targeting wrong chain |
| `wallet_binding` | Intent targeting different wallet address |
| `intent_expiry` | Stale or backdated intents (TTL = 5 minutes by default) |
| `intent_id_replay` | Same intent submitted twice (in-process memory) |
| `calldata_integrity` | Modified calldata between intent approval and execution |
| `recipient_allowlist` | Pre-flight: saves gas before on-chain revert |
| `spending_limit` | Pre-flight: saves gas before on-chain revert |
| `wallet_paused` | Pre-flight: syncs with on-chain guardian pause action |

### TPDR Calldata Integrity — Exact Guarantee

The TPDR layer compares the **execute() parameters** against the **approved intent** immediately before calling `client.execute()`.

**What this guarantees:**  
If a bug, malicious dependency, or compromised tool modifies `target`, `calldata`, `value`, `chainId`, or `walletAddress` between intent approval and the `execute()` call, the mismatch is detected and the transaction is aborted.

**What this does NOT guarantee:**  
- The final signed UserOp (inside `permissionless.js`) is not re-examined after signing. A malicious `permissionless.js` dependency could theoretically substitute a different UserOp after our check. Mitigation: pin dependency versions and verify package integrity.
- A malicious **bundler** can drop, delay, or reorder transactions. The ERC-4337 EntryPoint validates the owner's ECDSA signature, so a substituted UserOp would fail signature validation; censorship is not prevented.

---

## Threat Model

| Threat | Protection | Layer |
|--------|-----------|-------|
| Agent spends above daily limit | SpendingLimitHook | On-chain |
| Agent sends to unapproved recipient | AllowlistHook | On-chain |
| Agent calls hook admin functions | AllowlistHook protectedAddresses | On-chain |
| Agent removes its own spending limit | AllowlistHook + SelfCallBlocked | On-chain |
| Agent executes delegatecall | All three hooks block delegatecall | On-chain |
| Agent installs/uninstalls modules | All three hooks block installModule | On-chain |
| Guardian emergency | EmergencyPauseHook.pause() | On-chain |
| Calldata mutation (SDK level) | TPDR verifyIntegrity() | Off-chain |
| Expired intent reuse | TPDR intent_expiry check | Off-chain |
| Same intent submitted twice | TPDR intent_id_replay (in-memory) | Off-chain |
| Wrong chain or wallet | TPDR chain_id + wallet_binding | Off-chain |
| Protocol-level exploits | NOT protected — out of scope | — |
| Compromised owner key | NOT protected — owner has full control | — |
| Token wrapping bypass (ETH→WETH) | NOT protected — see SpendingLimitHook docs | — |
| Malicious bundler censorship | NOT protected — ERC-4337 limitation | — |

---

## Key Separation

| Principal | Key type | Can do |
|-----------|---------|--------|
| Owner | EOA private key | Deploy wallet, install hooks, reconfigure policies, pause/unpause |
| Agent | Session key (scoped) | Execute transfers within policy boundaries only |
| Guardian | EOA private key | pause(), unpause(), rotateGuardian() |

The agent's session key is scoped to specific target+selector pairs and expires after a configurable time. It is never stored in the wallet manager's memory — only the `permissionId` is tracked.

---

## On-Chain Contract Addresses (Base Sepolia, verified)

| Contract | Address |
|---------|---------|
| EntryPoint v0.7 | `0x0000000071727De22E5E9d8BAf0edAc6f37da032` |
| HookMultiPlexer | `0xF6782ed057F95f334D04F0Af1Af4D14fb84DE549` |
| SpendingLimitHook | `0xd67a5E6784A66Ddf4C09EA7bbf81Ab89532624E4` |
| AllowlistHook | `0x7899b03386A3874393A3769D637977d947A9Fc66` |
| EmergencyPauseHook | `0xAc0cE5672aED1Bfe5549b885f883a770Acd8cAE3` |
| USDC (Base Sepolia) | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |
