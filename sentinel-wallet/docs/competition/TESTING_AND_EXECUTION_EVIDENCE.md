# Sentinel Wallet — Testing and Execution Evidence

**Document date:** 20 October 2026  
**Repository snapshot:** `96a7908f24dc8c95c7c8eac61259e8a309dd2c44` (`main`) with the uncommitted changes listed in §1.2  
**Execution environment:** Windows, Node.js `v24.22.0`, npm `11.19.1`  
**Network used for on-chain evidence:** Base Sepolia, chain ID `84532`

> **Evidence rule.** This document only records results that were actually observed in command output, repository logs, or read-only RPC queries. It does not treat a script's existence, a code comment, or a hypothetical broadcast as proof. Where evidence is missing, the item is marked **not verified** or **pending**.

---

## 1. Repository and Working-Tree State

### 1.1 Commit

```
96a7908f24dc8c95c7c8eac61259e8a309dd2c44
fix(security): enforce per-user policy isolation, authenticate sensitive endpoints, and gate demo account
2026-10-19 19:02:59 +0500
```

### 1.2 Uncommitted files at the time of inspection

```
 M sentinel-wallet-security-audit.zip
 M sentinel-wallet/src/__tests__/auth.test.ts
 M sentinel-wallet/src/auth.ts
 M sentinel-wallet/src/server.ts
 M sentinel-wallet/src/wallet.ts
 M sentinel-wallet/vitest.config.js
?? sentinel-wallet/scripts/inspect-safe.ts
?? sentinel-wallet/scripts/recover-safe-7579.ts
?? sentinel-wallet/src/__tests__/csrfAndIpTrust.test.ts
?? sentinel-wallet/src/__tests__/httpMultiUser.test.ts
?? sentinel-wallet/src/__tests__/multiUserIsolation.test.ts
?? sentinel-wallet/src/__tests__/safe-strict-mode.test.ts
?? sentinel-wallet/src/__tests__/wallet-reconnect.test.ts
```

The test results below were produced from this working tree, not only from the commit. The uncommitted files are part of the verified behavior.

### 1.3 Project layout relevant to evidence

| Path | Role |
|------|------|
| `sentinel-wallet/package.json` | Scripts and dependency versions |
| `sentinel-wallet/src/__tests__/` | 13 Vitest files |
| `sentinel-wallet/scripts/live-test.ts` | Live demo/transfer attempt |
| `sentinel-wallet/scripts/verify-onchain.ts` | Read-only bytecode verification |
| `sentinel-wallet/scripts/inspect-safe.ts` | Read-only Safe/EntryPoint/registry inspection |
| `sentinel-wallet/scripts/recover-safe-7579.ts` | Dry-run by default; Safe fallback-handler repair |
| `live-test-run.log` (repository root) | Historical 2026-10-20 live run |
| `mini-freellm-router.log` (repository root) | LLM router request log |
| `sentinel-wallet-server.log` | Server startup only |
| `sentinel-wallet-server-documented.log` | Server startup only |
| `sentinel-wallet-ui/index.html` | Browser UI served by the API |

`*.log` is in `.gitignore`, so the logs are local evidence and will not be included in a normal `git push`. Attach them separately or include screenshots/output excerpts in the submission.

---

## 2. Exact Test Commands Found in the Repository

From `sentinel-wallet/package.json`:

| Command | Script | What it does |
|---------|--------|--------------|
| `npm test` | `vitest run` | Runs all Vitest suites |
| `npm run test:watch` | `vitest` | Watch mode |
| `npm run build` | `tsc --noEmit` | TypeScript type-check |
| `npm run lint` | `tsc --noEmit` | Same type-check |
| `npm run demo:mock` | `tsx src/demo.ts --mock` | Offline demo, no keys/network |
| `npm run demo` | `tsx src/demo.ts` | Live demo (can broadcast) |
| `npm run demo:llm` | `tsx src/demo.ts --mock --llm` | Mock demo through the LLM planner |
| `npm run dev` / `npm start` | `tsx src/server.ts` | REST API + UI on port 3000 |
| `npm run verify:onchain` | `scripts/verify-onchain.ts` | Read-only bytecode/env check |
| `npm run live:test` | `scripts/live-test.ts` | Live transfer attempt (can broadcast) |
| `npm run generate:wallet` | `scripts/generate-wallet.ts` | Generates a fresh keypair locally |

Additional scripts without package aliases:

| Command | Purpose |
|---------|---------|
| `npx tsx scripts/inspect-safe.ts` | Read-only Safe/EntryPoint/bundler/registry inspection |
| `npx tsx scripts/recover-safe-7579.ts` | Dry-run Safe fallback-handler repair |
| `npx tsx scripts/recover-safe-7579.ts --broadcast` | **Broadcasts** the repair; not run for this document |
| `npx tsx scripts/check-balance.ts` | Read-only ETH/USDC balance check |

---

## 3. Automated Test Results (Executed)

### 3.1 `npm test`

Command run in `sentinel-wallet/`:

```bash
npm test
```

Observed summary:

```
Test Files  13 passed (13)
     Tests  165 passed (165)
  Start at  19:56:18
  Duration  13.29s (transform 2.24s, setup 0ms, collect 49.81s, tests 12.35s, environment 7ms, prepare 5.21s)
```

Exit status: `0`.

A second run with the JSON reporter (`npx vitest run --reporter=json --outputFile=<temp>`) produced:

```
numTotalTestSuites=69
numTotalTests=165
numPassedTests=165
numFailedTests=0
```

`numTotalTestSuites=69` counts describe blocks; the actual test **files** are 13.

### 3.2 Per-file counts

| Test file | Tests | Passed | Failed | Classification |
|-----------|------:|-------:|-------:|----------------|
| `auth.test.ts` | 9 | 9 | 0 | Unit |
| `csrfAndIpTrust.test.ts` | 9 | 9 | 0 | Unit + local HTTP integration |
| `httpMultiUser.test.ts` | 1 | 1 | 0 | Local HTTP integration |
| `integrity.test.ts` | 12 | 12 | 0 | Unit |
| `intent.test.ts` | 13 | 13 | 0 | Unit |
| `llm-planner.test.ts` | 24 | 24 | 0 | Unit (mocked fetch) |
| `multiUserIsolation.test.ts` | 3 | 3 | 0 | Unit |
| `planner.test.ts` | 9 | 9 | 0 | Unit |
| `policy.test.ts` | 40 | 40 | 0 | Unit |
| `safe-strict-mode.test.ts` | 4 | 4 | 0 | Unit with stub client; no network |
| `security.test.ts` | 22 | 22 | 0 | Unit + `MockSmartAgentKitClient` |
| `settings.test.ts` | 16 | 16 | 0 | Unit |
| `wallet-reconnect.test.ts` | 3 | 3 | 0 | Unit + mock manager |
| **Total** | **165** | **165** | **0** | |

### 3.3 Type-check

Command:

```bash
npm run build
```

Observed:

```
> sentinel-wallet@1.0.0 build
> tsc --noEmit
EXITCODE=0
```

### 3.4 Offline demo

Command:

```bash
npm run demo:mock
```

Observed final summary:

```
Total records: 9
Approved: 2  Rejected: 7
```

The nine records correspond to scripted scenarios: approved happy path, over-limit, unapproved recipient, admin selector, pause, delegatecall/wrong selector, expired intent, approved replay baseline, and rejected replay. This is a simulation; no chain call is made.

### 3.5 Not executed for this document

- `npm run demo` (live deployment/broadcast)
- `npm run live:test` (live transfer)
- `npm run verify:onchain` (read-only, but not run; equivalent read-only RPC checks were performed directly)
- `npx tsx scripts/inspect-safe.ts` (read-only, but not run; its read-only checks were reproduced with direct RPC calls)
- `npx tsx scripts/recover-safe-7579.ts --broadcast` (**not run; no on-chain state change performed**)
- Any `--broadcast` flag in any script

---

## 4. Test Classification: Unit, Integration, Mock, Fork, Live

| Category | Present? | Details |
|----------|----------|---------|
| Unit tests | Yes | intent, policy, integrity, planner, llm-planner, settings, multiUserIsolation, auth, reconnect |
| Integration tests | Yes, local only | `httpMultiUser.test.ts` starts an in-process HTTP server on `127.0.0.1:0`; `csrfAndIpTrust.test.ts` makes local HTTP requests |
| Mocked SDK tests | Yes | `security.test.ts` uses `MockSmartAgentKitClient`; `safe-strict-mode.test.ts` injects a stub client that throws `0xacfdb444` |
| Fork-based tests | **No** | No Anvil/Hardhat fork tests are present in this repository |
| Live-chain automated tests | **No** | Not part of `npm test` |
| Live-chain manual scripts | Yes | `live:test`, `demo`, `recover-safe-7579.ts --broadcast`; only historical logs are available |
| Foundry/Forge tests | **No** in this repository | Hook Solidity tests are not in this workspace |

### 4.1 Important mock caveat

`MockSmartAgentKitClient.execute()` checks in-memory pause/allowlist/spending state and returns:

```js
fakeTxHash() {
  const rand = Math.random().toString(16).slice(2).padEnd(64, "0");
  return `0x${rand}`;
}
```

Source: `node_modules/@smartagentkit/testing/dist/index.mjs`. A "successful" mock execution is not a chain transaction and cannot be verified on BaseScan.

The HTTP server imports only `MockSentinelWalletManager`; it never instantiates `SentinelWalletManager`. Therefore the browser demo and REST API are mock-only.

---

## 5. Network and Chain

| Property | Value |
|----------|-------|
| Network | Base Sepolia |
| Chain ID | `84532` (`0x14a34`) |
| Public RPC used for verification | `https://sepolia.base.org` |
| Block at time of read-only checks | `48371037` |
| Explorer | `https://sepolia.basescan.org` |

No mainnet, no other testnet, and no local fork was used.

---

## 6. Verified Contract Addresses and Bytecode

All bytecode checks were read-only `eth_getCode` calls. Bytecode presence proves a contract is deployed; it does **not** prove source equivalence or correct configuration.

| Contract | Address | Bytecode size | Explorer |
|----------|---------|--------------:|----------|
| EntryPoint v0.7 | `0x0000000071727De22E5E9d8BAf0edAc6f37da032` | 16,035 bytes | https://sepolia.basescan.org/address/0x0000000071727De22E5E9d8BAf0edAc6f37da032 |
| HookMultiPlexer | `0xF6782ed057F95f334D04F0Af1Af4D14fb84DE549` | 9,440 bytes | https://sepolia.basescan.org/address/0xF6782ed057F95f334D04F0Af1Af4D14fb84DE549 |
| SpendingLimitHook | `0xd67a5E6784A66Ddf4C09EA7bbf81Ab89532624E4` | 5,537 bytes | https://sepolia.basescan.org/address/0xd67a5E6784A66Ddf4C09EA7bbf81Ab89532624E4 |
| AllowlistHook | `0x7899b03386A3874393A3769D637977d947A9Fc66` | 7,906 bytes | https://sepolia.basescan.org/address/0x7899b03386A3874393A3769D637977d947A9Fc66 |
| EmergencyPauseHook | `0xAc0cE5672aED1Bfe5549b885f883a770Acd8cAE3` | 5,252 bytes | https://sepolia.basescan.org/address/0xAc0cE5672aED1Bfe5549b885f883a770Acd8cAE3 |
| Safe7579 module | `0x7579EE8307284F293B1927136486880611F20002` | 20,014 bytes | https://sepolia.basescan.org/address/0x7579EE8307284F293B1927136486880611F20002 |
| USDC (Base Sepolia) | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` | 1,798 bytes | https://sepolia.basescan.org/address/0x036CbD53842c5426634e7929541eC2318f3dCF7e |
| Safe Smart Account | `0x6cDE0BB1A5fb957d0e55c6E2dcd0a466c06D5123` | 171 bytes (proxy) | https://sepolia.basescan.org/address/0x6cDE0BB1A5fb957d0e55c6E2dcd0a466c06D5123 |

### 6.1 ERC-7484 registry attestation

Read-only checks:

- Registry: `0x000000000069e2a187aeffb852bf3ccdc95151b2` — 18,522 bytes of code.
- Attester: `0x000000333034E9f539ce08819E12c1b8Cb29084d`.
- `findTrustedAttesters(Safe)` → `[0x000000333034E9f539ce08819E12c1b8Cb29084d]`.
- `findAttestation(HookMultiPlexer, attester)` → `moduleTypes=16`, `moduleAddress=0xF678...E549`, `expirationTime=0`, `revocationTime=0`.
- `checkForAccount(Safe, HookMultiPlexer)` → **passed**.
- `checkForAccount(Safe, SpendingLimitHook)` → reverted with `0xe424f994`.
- `checkForAccount(Safe, AllowlistHook)` → reverted with `0xe424f994`.
- `checkForAccount(Safe, EmergencyPauseHook)` → reverted with `0xe424f994`.

**Interpretation:** the multiplexer has a registry attestation and passes the account check. The three individual hooks fail the account check. Whether this is expected because they are submodules is not documented in this repository; do not claim individual hook attestation.

---

## 7. Safe Smart Account State (Read-Only)

Read at block `48371037`:

| Query | Result |
|-------|--------|
| `eth_getCode(0x6cDE...5123)` | 171 bytes |
| `VERSION()` | `1.4.1` |
| `getOwners()` | `[0x86ce071Fa058AF96b574aE2A4d646193f6a32321]` |
| `getThreshold()` | `1` |
| `nonce()` | `1` |
| `isModuleEnabled(0x7579...0002)` | `true` |
| `isModuleEnabled(0xF678...E549)` | `false` |
| `isModuleEnabled(SpendingLimitHook)` | `false` |
| `isModuleEnabled(AllowlistHook)` | `false` |
| `isModuleEnabled(EmergencyPauseHook)` | `false` |
| Fallback-handler storage slot `0x6c9a...0000` | `0x000...000` (zero address) |
| `EntryPoint.getNonce(Safe, 0)` | `0` |
| `EntryPoint.balanceOf(Safe)` | `0` |
| USDC `balanceOf(Safe)` | `2.000000` USDC |
| USDC `balanceOf(owner)` | `15.000000` USDC (at read time) |
| ERC-7579 `isModuleInstalled(1, HMP, 0x)` | `false` |
| ERC-7579 `isModuleInstalled(4, HMP, 0x)` | reverted |
| ERC-7579 `isModuleInstalled(4, each hook, 0x)` | reverted |

The zero fallback handler is a material finding: the Safe7579 execution surface is not usable as configured, which is consistent with a `0xacfdb444` (`ExecutionFailed`) revert when a UserOperation is simulated. The unit-test stub uses exactly that error string; the live log records a separate bundler simulation failure. A direct live bundler capture of `0xacfdb444` is not present in the repository.

---

## 8. Confirmed On-Chain Transactions

Two transaction hashes appear in repository evidence. Both were independently queried via Base Sepolia RPC and confirmed successful. **Neither is a Safe Smart Account UserOperation.** Both are direct ERC-20 `transfer` calls sent by the owner EOA to the USDC contract.

### 8.1 Transaction A — `0xdb8c...3592`

| Field | Value |
|-------|-------|
| Hash | `0xdb8c4aef52a7881bb5f220528636ce917953ac124feeef5f725fa8021c463592` |
| Explorer | https://sepolia.basescan.org/tx/0xdb8c4aef52a7881bb5f220528636ce917953ac124feeef5f725fa8021c463592 |
| Block | `48270886` |
| Timestamp | `2026-10-18T07:54:20Z` |
| Status | `0x1` (success) |
| Type | EIP-1559 (`0x2`) |
| From | `0x86ce071Fa058AF96b574aE2A4d646193f6a32321` (owner EOA) |
| To | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` (USDC) |
| Value | `0` |
| Nonce | `2` |
| Gas used | `62,159` |
| Input | `transfer(0xE06D8999DCfc16366A7A1C0189C22Bb9521940db, 1000000)` |
| Log | ERC-20 `Transfer` from `0x86ce...2321` to `0xE06D...40db`, amount `1000000` (1.00 USDC) |
| What it did | Moved exactly 1.00 USDC from the owner EOA to the approved recipient |

**What it did not do:** it did not call the Safe, did not call EntryPoint, did not contain a `UserOperationEvent`, and did not exercise any ERC-7579 hook. The server seed record and UI label this transaction as a "Safe Smart Account co-signed execution"/"Verified 1 USDC Transfer." The transfer is real; the Safe attribution is false.

### 8.2 Transaction B — `0xa140...f612`

| Field | Value |
|-------|-------|
| Hash | `0xa140c2b45a6733aea513e505ef00778f2b9e8bbd628beb8ff7ff7620136ff612` |
| Explorer | https://sepolia.basescan.org/tx/0xa140c2b45a6733aea513e505ef00778f2b9e8bbd628beb8ff7ff7620136ff612 |
| Block | `48353993` |
| Timestamp | `2026-10-20T06:04:34Z` |
| Status | `0x1` (success) |
| Type | EIP-1559 (`0x2`) |
| From | `0x86ce071Fa058AF96b574aE2A4d646193f6a32321` (owner EOA) |
| To | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` (USDC) |
| Value | `0` |
| Nonce | `4` |
| Gas used | `45,059` |
| Input | `transfer(0xE06D8999DCfc16366A7A1C0189C22Bb9521940db, 1000000)` |
| Log | ERC-20 `Transfer` from `0x86ce...2321` to `0xE06D...40db`, amount `1,000,000` (1.00 USDC) |
| What it did | Moved exactly 1.00 USDC from the owner EOA to the approved recipient |

**Source of this transaction:** `live-test-run.log` records a Safe bundler simulation failure followed by:

```
[INFO] Safe bundler simulation failed (Hook restriction on target/wildcard). Fallback to Direct Guardian Execution on Base Sepolia...
...
On-Chain Execution: SUCCESS (4335ms)
TRANSACTION HASH: 0xa140c2b45a6733aea513e505ef00778f2b9e8bbd628beb8ff7ff7620136ff612
```

That log line is explicit: the transfer came from **Direct Guardian Execution** (the owner EOA), not the Safe. The current code defaults to strict Safe mode, so a rerun without `SENTINEL_STRICT_SAFE=explicit-eoa-fallback` would not take this fallback.

### 8.3 Transaction comparison

| Property | `0xdb8c...3592` | `0xa140...f612` | Safe UserOperation would look like |
|----------|------------------|------------------|-------------------------------------|
| Sender | Owner EOA | Owner EOA | Bundler EOA |
| `to` | USDC contract | USDC contract | EntryPoint v0.7 |
| Function | `transfer` | `transfer` | `handleOps` |
| UserOperationEvent | No | No | Yes |
| EntryPoint nonce consumed | No | No | Yes |
| Hook execution | No | No | Yes (if installed) |
| Explorer-verifiable as Safe execution | No | No | Yes |

---

## 9. Owner EOA Transaction vs Safe Smart Account / UserOperation

This distinction is central to the competition's "real on-chain execution" requirement.

### 9.1 Owner EOA transaction

- Signed directly by `0x86ce071Fa058AF96b574aE2A4d646193f6a32321`.
- `to` is the token contract.
- Bypasses the Safe account, the Safe owner/threshold logic, the EntryPoint, and all ERC-7579 hooks.
- Confirmed by receipt status `1` and an ERC-20 `Transfer` log.
- This is what both confirmed hashes are.

### 9.2 Safe Smart Account / UserOperation

- The Safe is an ERC-4337 smart account. A UserOperation is a structured pseudo-transaction signed by the owner (or a session key) and submitted to a bundler.
- The bundler calls `EntryPoint.handleOps(...)`.
- EntryPoint validates the UserOperation, calls the Safe's validation/execution path, and emits `UserOperationEvent`.
- The Safe's own nonce/EntryPoint nonce increments; hooks run in the validation/execution path.
- A confirmed UserOperation would have:
  - a transaction to the EntryPoint (not to USDC);
  - a `UserOperationEvent` log;
  - a UserOperation hash;
  - an EntryPoint nonce increment;
  - a Safe `ExecutionSuccess`/execution log.

### 9.3 Evidence status

| Requirement | Status |
|-------------|--------|
| Owner EOA transfer confirmed | **Yes** (two transactions) |
| Safe deployment confirmed | **Yes** (171 bytes, Safe 1.4.1) |
| UserOperation submitted to bundler | **Not verified** |
| UserOperation included in a block | **Not verified** |
| UserOperation hash captured | **Not available** |
| `handleOps` transaction hash captured | **Not available** |
| Safe EntryPoint nonce > 0 | **No** (`0`) |
| Hook executed on-chain | **Not verified** |

---

## 10. Bundler Estimation vs Submitted UserOperation

| Stage | Evidence | Status |
|-------|----------|--------|
| `eth_estimateUserOperationGas` success | No captured output in repository | **Not verified** |
| Bundler simulation attempted | `live-test-run.log`: "Safe bundler simulation failed (Hook restriction on target/wildcard)" | **Failed** |
| `eth_sendUserOperation` called | No log or UserOperation hash | **Not verified** |
| UserOperation included | No `handleOps` transaction | **Not verified** |
| UserOperation confirmed | No receipt/`UserOperationEvent` | **Not verified** |
| EOA fallback broadcast | `live-test-run.log` + on-chain receipt | **Confirmed** |
| Strict Safe failure (unit test) | `safe-strict-mode.test.ts` stub throws `0xacfdb444` | **Verified in test only** |

The distinction matters: a gas-estimation call is not a broadcast. The repository does not contain a successful estimation record for a real bundler, and it certainly does not contain a submitted/confirmed UserOperation.

---

## 11. Failed or Blocked Execution Attempts

### 11.1 Historical live run

`live-test-run.log`:

```
[INFO] Safe bundler simulation failed (Hook restriction on target/wildcard). Fallback to Direct Guardian Execution on Base Sepolia...
```

The script then sent the EOA transfer. This is a **blocked Safe path** and a **successful bypass path**. The bypass succeeded only because the older runtime allowed the fallback; the current code's default is strict fail-closed.

### 11.2 Strict-mode tests

`safe-strict-mode.test.ts` injects a stub client whose `execute()` throws:

```
UserOperation reverted during simulation with reason: 0xacfdb444
```

The tests assert:

- `execution.success === false`;
- no `txHash`;
- exactly one Safe execution attempt;
- no owner-EOA fallback in strict mode;
- no spend counted;
- the explicit opt-out path still attempts the fallback.

These are unit tests with a stub; they are not a live bundler result.

### 11.3 On-chain configuration blockers

- Safe fallback-handler slot is `0x0`; Safe7579 cannot handle the execution surface as configured.
- `isModuleEnabled(HookMultiPlexer)` is `false`.
- ERC-7579 `isModuleInstalled(4, ...)` reverts.
- EntryPoint nonce for the Safe is `0`; no UserOperation has been processed.
- Hook installation events are not present in the repository evidence.

### 11.4 Mock/UI "failures" that are not chain failures

- The mock client returns random hashes; it has no failed-transaction state.
- The UI's "BLOCKED (0 GAS)" message reflects an off-chain policy rejection, not an EVM revert.
- A policy rejection is not evidence that an on-chain hook would have reverted. The hook path is untested.

---

## 12. Current Verified Execution Status

| Capability | Status | Basis |
|------------|--------|-------|
| Natural-language → typed intent | **Verified** | Unit tests |
| Deterministic policy engine | **Verified** | 40 tests |
| Calldata integrity check | **Verified** | 12 tests |
| Mock end-to-end pipeline | **Verified** | 165 tests; `demo:mock` |
| Browser/REST pipeline | **Verified as mock** | Server imports mock manager; integration test |
| Auth/CSRF/IP controls | **Verified** | 9 + 9 tests |
| Contract bytecode deployed | **Verified** | RPC `eth_getCode` |
| HookMultiPlexer registry attestation | **Verified** | RPC `findAttestation` |
| Safe deployed | **Verified** | RPC `VERSION`, owners, threshold |
| Safe7579 fallback configured | **No** | Slot `0x0` |
| Hooks installed on Safe | **Not verified / likely absent** | Module reads; no events |
| Real EOA ERC-20 transfer | **Verified** | Two confirmed receipts |
| Real Safe UserOperation | **Not verified** | No `handleOps`, nonce 0 |
| On-chain hook rejection | **Not verified** | No revert evidence |
| Production-ready | **No** | See security assessment |
| Recovery/broadcast by parallel agent | **Pending verification** | No confirmed repair transaction in evidence |

---

## 13. What Each Evidence Artifact Actually Shows

| Artifact | What it shows | Limitations |
|----------|---------------|-------------|
| `live-test-run.log` | Full historical run: LLM intent, policy approval, TPDR pass, Safe simulation failure, EOA fallback, tx hash, rejected attacks, audit log | Git-ignored; no raw RPC response; predates strict default; shows a bypass, not Safe execution |
| `mini-freellm-router.log` | LLM router requests served by Groq/OpenRouter around the run | No prompt/response transcript; exact correspondence inferred from timestamps |
| `sentinel-wallet-server.log` | Server startup on port 3000 | No API/execution evidence |
| `sentinel-wallet-server-documented.log` | Server startup on port 3000 | No API/execution evidence |
| `sentinel-wallet/src/server.ts` | Mock manager, seeded TPDR record, REST routes | Seeded record misattributes `0xdb8c...3592` |
| `sentinel-wallet-ui/index.html` | Demo UI, mock execute flow, BaseScan links | Labels mock/EOA results as on-chain Safe confirmation |
| `src/__tests__/**` | 165 passing tests | No live chain, no fork, no hook execution |
| `scripts/recover-safe-7579.ts` | Repair path, dry-run by default | Not broadcast in this documentation |

---

## 14. Missing Evidence and Pending Verification

The following items are required for a strong Topic F submission but are not available in the repository as of this document:

1. A confirmed UserOperation hash and its `handleOps` transaction hash.
2. A `UserOperationEvent` log proving the Safe executed the call.
3. The EntryPoint nonce increment after the UserOperation.
4. A confirmed transaction installing the three hooks on the Safe.
5. A confirmed over-limit or unapproved-recipient UserOperation that reverts with the expected hook error.
6. The current output of `scripts/inspect-safe.ts` after any recovery.
7. A confirmed `setFallbackHandler` transaction if the recovery script was broadcast.
8. BaseScan source verification for the deployed hook contracts at the exact commit used.
9. A deck (`.pptx`/`.pdf`) and a demo video (`.mp4`/`.webm`); neither is present in the workspace.
10. A clean, secret-free repository archive; the current `.env.example` contains a credential-like value.

Until items 1–4 exist, the honest claim is:

> Sentinel Wallet has a verified off-chain policy and integrity pipeline with two confirmed Base Sepolia **owner EOA** transfers. Its Safe Smart Account / UserOperation execution path and on-chain hook enforcement are implemented in code but remain **pending verification**.

---

## 15. Reproduction Commands (Read-Only or Offline)

Safe to run without spending funds:

```bash
cd sentinel-wallet
npm install
npm test
npm run build
npm run demo:mock
```

Read-only chain checks:

```bash
npx tsx scripts/inspect-safe.ts          # read-only; includes one bundler gas estimation
npm run verify:onchain                   # read-only bytecode/env check
npx tsx scripts/check-balance.ts         # read-only balances
```

**Do not run** without explicit owner approval and funded testnet accounts:

```bash
npm run live:test
npm run demo
npx tsx scripts/recover-safe-7579.ts --broadcast
```

No broadcast was performed by this documentation task.
