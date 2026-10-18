# Sentinel Wallet — Project Explanation
*My Learning Notes — Based on actual code inspection*

---

## 1. The Problem It Solves

### Simple Explanation

Sochو — tumhare paas ek AI assistant hai jo tumhare liye payments karta hai. Agar tum us assistant ko apni bank account ki full access de do toh kya hoga? Woh kisi bhi address pe koi bhi amount bhej sakta hai. Agar woh hack ho jaye, ya galti kare, ya koi use manipulate kare — tumhare paise ja sakte hain.

**Sentinel Wallet** is problem ka solution hai. AI agent ko ek "restricted wallet" milta hai:
- Sirf **approved address** pe bhej sakta hai (koi aur nahi)
- Sirf **daily limit** tak bhej sakta hai (100 USDC example mein)
- Agar koi bhi rule toota — transaction **automatically block** hoti hai
- Sab kuch **audit trail** mein record hota hai

### Who Uses It

| User | Why |
|------|-----|
| Companies using AI agents for payments | Control chahiye — agent sab kuch kharch na kar le |
| DeFi protocols with automated bots | Bot ke actions pe limit lagana |
| Treasury management systems | Compliance aur audit trail ke liye |
| Any developer deploying AI + blockchain | Safe experimentation |

---

## 2. One Complete Example

**Input:** User bolta hai: *"send 10 USDC to 0x70997970... for supplier payment"*

**Step 1 — Planner:** Text ko parse karta hai
```
recipient = 0x70997970...
amount = 10 USDC
reason = "supplier payment"
```

**Step 2 — Intent Builder:** Typed object banata hai
```
intentId = "intent_abc123..." (unique ID, replay attack rokne ke liye)
calldata = 0xa9059cbb000...  (exactly encoded, agent ne nahi banaya)
expiresAt = now + 300 seconds (5 minute mein expire)
```

**Step 3 — Policy Engine:** 10 checks run karta hai
```
✅ chain_id: 84532 matches
✅ wallet_binding: correct wallet
✅ intent_expiry: still valid
✅ intent_id_replay: fresh ID
✅ amount_positive: 10 > 0
✅ selector_match: ERC-20 transfer only
✅ calldata_integrity: matches encoded fields
✅ recipient_allowlist: 0x70997970 is approved
✅ spending_limit: 10 USDC <= 100 USDC limit
✅ wallet_paused: not paused
→ APPROVED
```

**Step 4 — TPDR Verifier:** Execute se pehle verify karta hai
```
target == intent.tokenAddress? ✅
calldata == intent.calldata? ✅
chainId == 84532? ✅
→ INTEGRITY VERIFIED
```

**Step 5 — On-Chain:** Transaction submit hoti hai
```
Pimlico Bundler → ERC-4337 EntryPoint → Safe Wallet → USDC Transfer
TX Hash: 0xabc...  (BaseScan pe verify kar sakte hain)
```

**Output:** TPDR Record — complete audit trail with all decisions

---

## 3. Each Component Explained

### `src/planner.ts` — The "Brain" (Simulated)
**Kya karta hai:** Natural language → typed intent  
**AI ya deterministic?** Currently **deterministic** (regex patterns) — real LLM nahi  
**Why exists:** Agent ko raw calldata inject nahi karne deta — sirf recipient aur amount specify kar sakta hai  
**Honest status:** LLM wiring documented hai lekin implement nahi hua

### `src/intent.ts` — The "Encoder"
**Kya karta hai:** Typed fields → verified TransactionIntent  
**AI ya deterministic?** **Deterministic** — pure math/encoding  
**Why exists:** Calldata agent se accept nahi karta — khud banata hai. Yeh critical security property hai.  
**Key property:** `buildTransferIntent()` — agent sirf `(recipient, amount)` de sakta hai, calldata nahi

### `src/policy.ts` — The "Rules Engine"
**Kya karta hai:** 10 checks run karta hai, approve/reject karta hai  
**AI ya deterministic?** Fully **deterministic** — koi ML nahi  
**Why exists:** Transaction on-chain submit karne se pehle obvious violations pakad lena (gas save karna, audit trail banana)  
**Important limitation:** In-memory only — process restart karne se spending history reset ho jaata hai

### `src/integrity.ts` — The "TPDR Verifier"
**Kya karta hai:** `execute()` call se PEHLE calldata decode karke intent se compare karta hai  
**Why exists:** Agar koi malicious dependency ya bug calldata modify kare SDK mein — yeh pakad leta hai  
**Honest limitation:** SDK ke andar UserOp sign hone ke baad ki mutation nahi pakad sakta. Execute() ke inputs check karta hai, final signed UserOp nahi.

### `src/wallet.ts` — The "Orchestrator"
**Kya karta hai:** Poora pipeline run karta hai: intent → policy → integrity → execute → TPDR record  
**Two classes:**
- `SentinelWalletManager` — real network, real transactions
- `MockSentinelWalletManager` — tests ke liye, koi network nahi

### On-Chain Hooks (ERC-7579) — The "Unbypassable Guards"
**Kya karte hain:** EVM level pe enforce karte hain — even if SDK compromised ho  
**Three hooks (Base Sepolia pe deployed, bytecode verified):**
- `SpendingLimitHook` — daily limit enforce karta hai, revert karta hai
- `AllowlistHook` — sirf approved recipients allow karta hai
- `EmergencyPauseHook` — guardian emergency mein sab block kar sakta hai

---

## 4. AI vs. Deterministic — Clear Distinction

| Component | Type | Evidence |
|-----------|------|---------|
| Planner (text parsing) | **Regex** — NOT AI | `src/planner.ts` line 93: two regex patterns |
| Intent builder | **Deterministic** | `encodeFunctionData()` from viem |
| Policy engine | **Deterministic** | Pure comparisons, no ML |
| TPDR verifier | **Deterministic** | String equality checks |
| On-chain hooks | **Deterministic** | Solidity if/revert statements |

**The project does NOT use any AI/LLM in the critical security path.** The "AI agent" in the demo is simulated by scripted planner requests. LangChain/OpenAI/Anthropic are documented as optional integrations but are not wired up.

---

## 5. What is Implemented, Mocked, Incomplete, or Unverified

### ✅ Fully Implemented
- Intent builder with calldata encoding
- 10-check policy engine
- TPDR integrity verifier
- Mock demo (full pipeline simulation)
- 83/83 tests passing
- Bytecode verified on Base Sepolia (public RPC, block 48213472)

### 🟡 Simulated / Mocked
- AI planner (regex, not LLM)
- Mock client (in-memory, not EVM)
- Pause state (in-memory flag, not on-chain read)
- Spending tracker (in-memory counter, not on-chain read)

### ❌ Incomplete / Unverified
- Real live transaction (testnet ETH issues prevented this)
- On-chain hook enforcement in actual EVM (no real tx exists)
- Forge tests for Solidity contracts (in packages/contracts, not in this workspace)
- Cross-session replay protection (in-memory Set only)
- Per-action session rules (SessionAction.rules not supported by SDK)
