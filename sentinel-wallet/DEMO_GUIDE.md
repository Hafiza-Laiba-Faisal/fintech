# Sentinel Wallet — Demo Guide

---

## Prerequisites

Node.js v22+, npm installed. All dependencies installed.

```cmd
cd sentinel-wallet
npm install
```

---

## Commands Reference

| Command | What it does | Requires |
|---------|-------------|---------|
| `npm test` | Run all 83 tests | Nothing |
| `npm run demo:mock` | Full demo, no network | Nothing |
| `npm run verify:onchain` | Check hook bytecodes on Base Sepolia | Internet |
| `npm run live:test` | Real on-chain transaction | .env filled |
| `npm run generate:wallet` | Create fresh keypair | Nothing |

---

## Quick Demo (No Setup Needed)

### Step 1 — Tests
```cmd
npm test
```
Expected:
```
Test Files  5 passed (5)
Tests       83 passed (83)
Duration    ~3.5s
```

### Step 2 — Mock Demo
```cmd
npm run demo:mock
```
Expected output: 9 scenarios, approved transfers, rejected attacks, full audit log.

---

## Full Demo Script (10 minutes)

### Opening Statement (30 seconds)
> "AI agents are being deployed to manage payments and DeFi operations. But giving an agent unrestricted wallet access is dangerous — a compromised agent, hallucination, or prompt injection could drain funds. Sentinel Wallet solves this with two enforcement layers: off-chain policy checks and on-chain ERC-7579 hooks that revert at the EVM level."

---

### Scene 1 — Architecture (2 minutes)
Show `ARCHITECTURE.md` or draw on screen:

```
User → Planner → Policy Engine → TPDR → On-chain Hooks → Transaction
```

Key point to say:
> "The agent cannot inject raw calldata. It can only say 'send 10 USDC to this address'. The system encodes the calldata itself, validates it through 10 checks, then verifies it again before submission. On-chain, three Solidity hooks enforce the same rules at EVM level — they cannot be bypassed even if this entire codebase is compromised."

---

### Scene 2 — Tests (1 minute)
```cmd
npm test
```

Point out:
- `policy.test.ts` — 29 tests, all 10 policy checks
- `security.test.ts` — 5 required negative tests
- `integrity.test.ts` — TPDR tamper detection

Say: *"83 tests, all passing. Every security scenario is tested."*

---

### Scene 3 — Mock Demo (3 minutes)
```cmd
npm run demo:mock
```

**What to highlight as it runs:**

| Output line | What to say |
|------------|------------|
| `✔ Policy: APPROVED — All 10 policy checks passed` | "Happy path — valid transfer approved" |
| `✔ REJECTED — Amount 150000000 exceeds remaining limit` | "150 USDC attempted, limit is 100 — blocked" |
| `✔ REJECTED — Recipient ...is NOT in the approved list` | "Unapproved recipient — AllowlistHook would also revert on-chain" |
| `✔ REJECTED — Unexpected selector 0x139d7fed` | "Agent tried to call admin function — blocked by selector check" |
| `✔ REJECTED — Wallet is currently paused by guardian` | "Guardian emergency pause — all transactions blocked" |
| `✔ TPDR caught tampering: mismatch on field "recipient"` | "Calldata was tampered in transit — TPDR layer caught it before submission" |
| `✔ REPLAY REJECTED` | "Same intent submitted twice — replay attack blocked" |

---

### Scene 4 — On-Chain Proof (2 minutes)
```cmd
npm run verify:onchain
```

Show:
```
✔ spendingLimitHook  0xd67a5E...  (5,537 bytes) — DEPLOYED
✔ allowlistHook      0x7899b0...  (7,906 bytes) — DEPLOYED
✔ emergencyPauseHook 0xAc0cE5...  (5,252 bytes) — DEPLOYED
```

Then open browser:
- https://sepolia.basescan.org/address/0xd67a5E6784A66Ddf4C09EA7bbf81Ab89532624E4

Say: *"These contracts are deployed and verified on Base Sepolia. Judges can inspect them here."*

---

### Scene 5 — Fallback Plan
If any live service is unavailable:

| Problem | Fallback |
|---------|---------|
| `npm run demo:mock` fails | Show previous output screenshot |
| `npm run verify:onchain` fails | Show BaseScan links in browser |
| Internet down | Run `npm test` — 100% offline |

---

## Sample Inputs for Live Demo

### Valid transfer (will be approved)
```
"send 10 USDC to 0x70997970C51812dc3A010C7d01b50e0d17dc79C8 for supplier payment"
```

### Over-limit (will be rejected — N1)
```
"send 150 USDC to 0x70997970C51812dc3A010C7d01b50e0d17dc79C8 for bulk payment"
```

### Wrong recipient (will be rejected — N2)
```
"send 10 USDC to 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC for test"
```

---

## Environment Variables (.env)

**For mock demo: no .env needed.**

For live testnet:
```
RPC_URL=         # Alchemy Base Sepolia: https://www.alchemy.com
BUNDLER_URL=     # Pimlico: https://dashboard.pimlico.io
OWNER_ADDRESS=   # Your testnet wallet address
OWNER_PRIVATE_KEY= # Your testnet private key (never commit)
APPROVED_RECIPIENT= # Only address agent can send to
GUARDIAN_ADDRESS=   # Can be same as OWNER_ADDRESS
```

---

## Common Errors & Fixes

| Error | Cause | Fix |
|-------|-------|-----|
| `esbuild EBUSY` | Windows file lock | Close other processes, `rmdir /s /q node_modules`, reinstall |
| `Invalid recipient: 0xAAAA...` | Non-checksummed address | Use EIP-55 checksummed address |
| `WalletCreationError: Owner address does not match` | Private key and address mismatch | Run `npm run generate:wallet` for fresh matched pair |
| `PolicyConfigError: approvedRecipients must be array of valid Ethereum addresses` | Wrong address format | Use `0x` + 40 hex chars, properly checksummed |
| Tests show 0 passed | vitest.config.ts being compiled by esbuild | Already fixed — uses `.js` config |

---

## Screen Recording Plan (No Secrets Exposed)

1. Close all tabs with wallet keys or private data
2. Open terminal in `sentinel-wallet/` directory
3. Record these 3 scenes only:
   - `npm test` — show all 83 passing
   - `npm run demo:mock` — show full output
   - Browser: BaseScan links for hook contracts
4. Do NOT record `.env` file contents
5. Do NOT show any address that has real mainnet funds
