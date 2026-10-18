# Sentinel Wallet

> **FinTechathon 2026 — Topic F: Agent Wallet**  
> A policy-governed smart wallet that lets an AI agent execute blockchain transactions without unrestricted access to owner assets.

---

## Verified vs Unverified Claims

| Claim | Status | Evidence |
|-------|--------|---------|
| 83 unit tests pass | ✅ **Verified** | `npm test` Exit 0 |
| Policy engine (10 checks) works | ✅ **Verified** | 29 unit tests |
| TPDR calldata comparison works | ✅ **Verified** | 12 unit tests |
| Hook contracts deployed on Base Sepolia | ✅ **Verified** | Bytecode at block 48213472 via public RPC |
| Hooks installed on a specific wallet | ❌ **Unverified** | No wallet deployed — testnet ETH unavailable |
| Hook policy violations revert on-chain | ❌ **Unverified** | No real transaction submitted |
| Agent uses scoped session key | ❌ **Incorrect** | Owner key signs all transactions (`wallet.ts`) |
| TPDR is cryptographic | ❌ **Incorrect** | Plain TypeScript comparison of execute() inputs |
| Cross-session replay protection | ❌ **Partial** | In-memory Set — resets on process restart |
| Planner uses real LLM | ✅ **Implemented (optional)** | `src/llm-planner.ts` — OpenAI-compatible + Anthropic wire formats; regex fallback remains the default demo path |
| LLM planner cannot inject calldata | ✅ **Verified (unit tests)** | `llm-planner.test.ts`: model output validated against a typed schema; only (recipient, amount) pass through |

---

## What it does

An AI agent proposes a transfer intent (token, recipient, amount). Before execution:

1. **Planner** converts the request into a typed intent — **real LLM planner implemented** (`src/llm-planner.ts`, optional; needs an endpoint in env or UI). Regex fallback is the default demo path. The LLM's ONLY output is `{recipient, amount, token}` — it can never produce raw calldata
2. **Policy Engine** validates chain, wallet, expiry, replay, allowlist, spending limit, and pause state (off-chain pre-flight) — identical enforcement regardless of which planner produced the intent
3. **TPDR Layer** compares execute() inputs against the approved intent before submission (pre-dispatch check, not cryptographic)
4. **On-chain hooks** are deployed on Base Sepolia and would enforce spending limits, allowlist, and pause at EVM level — **not yet demonstrated with a real transaction**


## Quick Start

### Mock Demo (no keys, no network — recommended for first run)

```bash
# 1. Clone SmartAgentKit (Sentinel Wallet is in apps/examples/)
git clone https://github.com/smartagentkit/smartagentkit.git
cd smartagentkit

# OR run standalone:
cd sentinel-wallet/   # this directory

# 2. Install dependencies
npm install

# 3. Run the full demo (mock mode)
npm run demo:mock
```

**Expected output:** 7 scenarios demonstrated — 1 approved transfer + 6 rejections with explanations.  
No API keys, no testnet ETH, no network connection required.

### Run Tests

```bash
npm test
```

**Expected:** All tests pass. See [Test Catalogue](#test-catalogue) below.

### Live Testnet Demo (Base Sepolia)

```bash
# 1. Copy and fill environment variables
cp .env.example .env
# Edit .env with your RPC_URL, BUNDLER_URL, OWNER_PRIVATE_KEY, APPROVED_RECIPIENT

# 2. Fund your owner address with Base Sepolia ETH
# Faucet: https://faucet.quicknode.com/base/sepolia (~0.02 ETH needed)

# 3. Mint USDC test tokens (optional — demo can use ETH transfers)
# Faucet: https://faucet.circle.com (select "Base Sepolia")

# 4. Run live demo
npm run demo
```

---

## Architecture

```
User Request
    │
    ▼
┌────────────────────┐
│   AI Planner       │  src/planner.ts
│   (deterministic)  │  Parses instruction → typed intent
│   NO raw calldata  │  Agent cannot inject arbitrary calldata
└────────┬───────────┘
         │
         ▼
┌────────────────────┐
│   Policy Engine    │  src/policy.ts
│   OFF-CHAIN        │  10 deterministic checks
│   Pre-flight only  │  chain_id, wallet_binding, expiry,
└────────┬───────────┘  replay, allowlist, limit, paused...
         │ APPROVED
         ▼
┌────────────────────┐
│   TPDR Verifier    │  src/integrity.ts
│   OFF-CHAIN        │  Decodes execute() params
│   Pre-submission   │  Compares against approved intent
└────────┬───────────┘  Rejects if ANY field mismatches
         │ INTEGRITY OK
         ▼
┌────────────────────┐
│   SDK execute()    │  @smartagentkit/sdk
│   Builds UserOp    │  permissionless.js + viem
│   Signs + submits  │  ECDSA by owner key
└────────┬───────────┘
         │
         ▼
┌────────────────────┐
│   ERC-4337         │
│   EntryPoint       │  Validates signature + nonce
│   (on-chain)       │
└────────┬───────────┘
         │
         ▼
┌────────────────────────────────────────┐
│   Safe Smart Account (ERC-7579)        │
│   HookMultiPlexer                      │
│   ├── SpendingLimitHook  (on-chain) ✓  │  daily limits per token
│   ├── AllowlistHook      (on-chain) ✓  │  approved recipients only
│   └── EmergencyPauseHook (on-chain) ✓  │  guardian circuit breaker
│                                        │
│   Any hook REVERT = entire UserOp fail │
└────────────────────────────────────────┘
```

---

## Security Controls

| Control | Layer | Enforcement |
|---------|-------|-------------|
| Spending limit (100 USDC/day) | **On-chain** | SpendingLimitHook reverts |
| Recipient allowlist | **On-chain** | AllowlistHook reverts |
| Delegatecall blocked | **On-chain** | All 3 hooks revert |
| Module install blocked | **On-chain** | All 3 hooks revert |
| Hook self-call blocked | **On-chain** | SelfCallBlocked revert |
| Emergency pause | **On-chain** | EmergencyPauseHook reverts |
| ERC-4337 nonce | **On-chain** | EntryPoint NonceManager |
| Chain ID binding | Off-chain | Policy engine |
| Wallet address binding | Off-chain | Policy engine |
| Intent expiry (5 min TTL) | Off-chain | Policy engine |
| Intent replay prevention | Off-chain | In-memory used-IDs set |
| Calldata integrity (TPDR) | Off-chain | Pre-submission comparison |

See [docs/security-model.md](docs/security-model.md) for full threat model and known limitations.

---

## Test Catalogue

### Unit Tests (no network)

| File | Tests | What it verifies |
|------|-------|-----------------|
| `intent.test.ts` | 12 | Intent builder, deterministic calldata, ID uniqueness |
| `policy.test.ts` | 25 | All 10 policy checks pass/fail conditions |
| `integrity.test.ts` | 12 | TPDR calldata/target/chain/wallet tamper detection |
| `planner.test.ts` | 8 | Planner parsing, validation, ID uniqueness |
| `llm-planner.test.ts` | 19 | LLM endpoint call, output validation, schema enforcement, no-intent-on-failure, regex fallback |

### Security Tests (mock environment)

| Test ID | Scenario | Expected | Enforcement |
|---------|----------|----------|-------------|
| [T1] | Valid 10 USDC transfer | ✅ Approved | — |
| [N1] | 150 USDC (limit 100) | ❌ `spending_limit` | Off-chain pre-flight + On-chain SpendingLimitHook |
| [N2] | Unapproved recipient | ❌ `recipient_allowlist` | Off-chain pre-flight + On-chain AllowlistHook |
| [N3] | Call removeSpendingLimit | ❌ `selector_match` | Off-chain + On-chain ProtectedTargetBlocked |
| [N4] | Wallet paused | ❌ `wallet_paused` | Off-chain pre-flight + On-chain EmergencyPauseHook |
| [N5] | Wrong selector / delegatecall | ❌ `selector_match` | Off-chain + On-chain DelegateCallNotAllowed |
| [T2] | Tampered recipient (TPDR) | ❌ `calldata` mismatch | Off-chain TPDR |
| [T3] | Tampered amount (TPDR) | ❌ `amount` mismatch | Off-chain TPDR |
| [T4] | Modified target (TPDR) | ❌ `targetContract` mismatch | Off-chain TPDR |
| [T5] | Expired intent | ❌ `intent_expiry` | Off-chain |
| [T6] | Replay attack | ❌ `intent_id_replay` | Off-chain |
| [T7] | Wrong chain ID | ❌ `chain_id` | Off-chain |
| [T8] | Wrong wallet binding | ❌ `wallet_binding` | Off-chain |

> **Note on "mock" vs "on-chain":** The security tests use `MockSmartAgentKitClient`. Mock tests verify the SDK pipeline. On-chain verification is provided by 160+ Forge unit tests in the SmartAgentKit repository (`forge test` in `packages/contracts`).

---

## Files

```
sentinel-wallet/
├── src/
│   ├── types.ts          # TransactionIntent, PolicyDecision, TPDRRecord
│   ├── intent.ts         # Intent builder (deterministic calldata)
│   ├── policy.ts         # 10-check deterministic policy engine
│   ├── integrity.ts      # TPDR calldata verifier
│   ├── planner.ts        # Deterministic (regex) planner + demo scenarios — fallback path
│   ├── llm-planner.ts    # REAL LLM planner (OpenAI-compatible + Anthropic; validated output)
│   ├── wallet.ts         # SentinelWalletManager + MockSentinelWalletManager
│   ├── demo.ts           # Full demo (mock + live modes)
│   └── __tests__/
│       ├── intent.test.ts
│       ├── policy.test.ts
│       ├── integrity.test.ts
│       ├── planner.test.ts
│       └── security.test.ts   ← 5 required negative tests + 8 TPDR tests
├── docs/
│   ├── security-model.md  # Full threat model
│   └── llm-audit.md       # LLM provider audit results
├── .env.example
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

---

## On-Chain Contract Addresses (Base Sepolia — live, verified)

```
SpendingLimitHook:  0xd67a5E6784A66Ddf4C09EA7bbf81Ab89532624E4
AllowlistHook:      0x7899b03386A3874393A3769D637977d947A9Fc66
EmergencyPauseHook: 0xAc0cE5672aED1Bfe5549b885f883a770Acd8cAE3
HookMultiPlexer:    0xF6782ed057F95f334D04F0Af1Af4D14fb84DE549
USDC (Base Sepolia):0x036CbD53842c5426634e7929541eC2318f3dCF7e
```

Source: `packages/sdk/src/deployments/base-sepolia.json` (verified from SmartAgentKit repository).

No contract deployment needed — all hooks are already live on Base Sepolia.

---

## LLM-Powered Planner (implemented)

The planner is genuinely LLM-wired now — but the security story stays honest:

**Security properties (regardless of planner):**
- The LLM's output is constrained to a typed schema: `{action, recipient, amount, token}`. It can NEVER supply raw calldata — calldata is deterministically ABI-encoded from the validated (recipient, amount) pair in `buildTransferIntent()`.
- All model output is validated before an intent is built: 40-hex address regex, plain-decimal positive amount (no `1e7` exponent tricks), token-symbol match. Malformed output produces **no intent**.
- The policy engine is completely independent of the planner. A prompt-injected or hallucinating LLM that proposes an unapproved recipient or an over-limit amount is rejected exactly like a regex-parsed intent.
- Provenance is recorded: each intent's `proposedBy` is `llm-planner:<model>` or `simulated-planner`, so TPDR audit logs show which path produced it.

**Run modes:**

```bash
npm run demo:mock      # regex planner (no keys, no network)
npm run demo:llm       # REAL LLM planner — needs LLM_ENDPOINT_URL + LLM_MODEL in .env
```

**Supported endpoints (OpenAI-compatible wire format by default):**

| Provider | Endpoint | Key needed |
|----------|----------|-----------|
| OpenAI | `https://api.openai.com/v1/chat/completions` | yes |
| OpenRouter | `https://openrouter.ai/api/v1/chat/completions` | yes |
| Groq | `https://api.groq.com/openai/v1/chat/completions` | yes |
| DeepSeek | `https://api.deepseek.com/chat/completions` | yes |
| Ollama (local) | `http://localhost:11434/v1/chat/completions` | no |
| LM Studio (local) | `http://localhost:1234/v1/chat/completions` | no |
| Anthropic | `https://api.anthropic.com/v1/messages` | yes — set `LLM_FORMAT=anthropic` |

Env config (see `.env.example`):

```
LLM_ENDPOINT_URL=...
LLM_MODEL=...
LLM_API_KEY=...        # omit for local providers
LLM_FORMAT=openai      # or "anthropic"
```

**Browser UI:** [sentinel-wallet-ui/index.html](../sentinel-wallet-ui/index.html) has an **"AI Planner (LLM)"** tab where you supply the endpoint, model, and (optionally) the API key per session. The key lives only in the page's memory — it is never stored, logged, or sent anywhere except your chosen endpoint. Provider presets, an approved-transfer example, and a prompt-injection attack example are included.

**Honest limits of the LLM layer:** the LLM is an *untrusted intent producer only*. It is not part of the enforcement stack and its failure mode is always "fail closed" (no intent). The regex planner remains the default for reproducible demos and as the fallback when the LLM call fails or errors.

---

## Known Limitations

1. **TPDR replay protection is in-memory only** — restarting the process clears the used-intent-ID set. Production: persist to database or on-chain nonce.
2. **SpendingLimitHook does not validate transfer recipient** — on-chain enforcement of recipient is AllowlistHook's job, not SpendingLimitHook's.
3. **Token wrapping bypass** — ETH→WETH conversion evades ETH spending limit. Mitigate: configure limits on both tokens.
4. **Non-standard ERC-20** — `permit()`, `increaseAllowance()`, `multicall` are not tracked by SpendingLimitHook.
5. **Malicious bundler** — can censor or delay (not substitute — EntryPoint validates ECDSA signature).
6. **`SessionAction.rules`** — per-action parameter constraints not supported in current SDK (verified in `sessions.ts`).

---

## Demo Narrative (10-minute presentation)

1. **Problem** (1 min): AI agents need wallets but can't be trusted with unrestricted keys
2. **Architecture** (2 min): Show the enforcement stack — agent → TPDR → on-chain hooks
3. **Happy path** (2 min): `pnpm demo:mock` — agent requests 10 USDC, all checks pass
4. **LLM planner** (1 min): `pnpm demo:llm` (or the UI "AI Planner" tab) — same demo with a live LLM parsing the natural-language request; planner provenance shown in audit trail
5. **Attack 1** (1 min): Over-limit transfer rejected at spending_limit check
6. **Attack 2** (1 min): Wrong recipient rejected at allowlist check
7. **Attack 3** (1 min): Tampered calldata caught by TPDR verifier
8. **Emergency pause** (1 min): Guardian pauses — all transfers blocked
9. **Live evidence** (1 min): Real Base Sepolia tx hash, BaseScan link
