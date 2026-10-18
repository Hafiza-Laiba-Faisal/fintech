# Sentinel Wallet — How to Explain and Sell It

---

## 30-Second Pitch

> "Sentinel Wallet lets businesses deploy AI agents that can make blockchain payments — but with hard limits they cannot exceed. The agent can only send to pre-approved addresses, cannot exceed a daily spending limit, and every transaction is logged with a full audit trail. If anything goes wrong, a guardian can pause all activity instantly. The limits are enforced at the blockchain level — not just in software — so even a compromised agent cannot steal funds."

---

## 2-Minute Technical Explanation

> "We built a two-layer enforcement system for AI agent wallets.
>
> The first layer is off-chain: before any transaction is submitted, our policy engine runs 10 deterministic checks — chain ID, wallet binding, intent expiry, replay protection, amount, function selector, calldata integrity, recipient allowlist, spending limit, and pause state. If any check fails, the transaction is rejected immediately and recorded in an audit log.
>
> The second layer is on-chain: three Solidity smart contracts — SpendingLimitHook, AllowlistHook, and EmergencyPauseHook — are installed as ERC-7579 modules on the wallet. These hooks run inside every transaction at the EVM level. They cannot be bypassed by the agent, by our SDK, or by a compromised dependency. They revert at the blockchain level.
>
> Between these two layers sits what we call the TPDR — Transaction Pre-Dispatch Review. Before the SDK submits the signed transaction, we decode the actual calldata that will be sent and compare it field-by-field against the approved intent. If the recipient, amount, or target contract was modified anywhere in the pipeline, we abort.
>
> The result: an AI agent with real payment capability that is physically constrained by the blockchain itself."

---

## Business-Focused Explanation (Non-Technical Customer)

> "Think of it like a corporate credit card with spending rules built in.
>
> You give your AI assistant a special wallet. You set the rules: it can only pay your approved suppliers, it can only spend up to $100 per day, and if anything looks suspicious, you can freeze it instantly with one click.
>
> The difference from a regular credit card is: these rules are enforced by the blockchain itself — not by a bank, not by our software, not by a policy document. The AI literally cannot break the rules. It's mathematically impossible, not just contractually prohibited.
>
> Every payment attempt — approved or rejected — is recorded with a full audit trail. You can see exactly what the AI tried to do, why it was approved or blocked, and what happened on-chain."

---

## Five Client Questions with Accurate Answers

### Q1: "What stops the AI agent from just bypassing your rules?"

**Honest answer:** The off-chain policy engine is one layer — but the critical enforcement is on-chain. Three smart contracts (SpendingLimitHook, AllowlistHook, EmergencyPauseHook) are installed on the wallet at deployment. They run inside every transaction at the EVM level. Even if our entire TypeScript codebase is compromised, these contracts will still revert unauthorized transactions. They are verified on Base Sepolia at known addresses.

*What we cannot guarantee:* A compromised owner private key bypasses everything. The owner key is the master key — if it's stolen, the attacker has full control. This is the same for any smart wallet system.

---

### Q2: "Is this production ready?"

**Honest answer:** No, not yet. Current limitations:

- Replay protection is in-memory only — it resets if the server restarts
- The spending tracker is in-memory — it doesn't read from the on-chain hook in real time
- The AI planner is a regex demo — not a real LLM integration
- No real transaction was executed in testing — testnet ETH issues

For production: the in-memory state needs to be replaced with on-chain reads, the planner needs a real LLM, and the system needs load testing and a formal security audit.

---

### Q3: "What blockchain is this on?"

**Accurate answer:** Base Sepolia (testnet) for this demo. Base is Coinbase's Layer 2 blockchain built on Ethereum. The contracts use ERC-4337 (Account Abstraction standard) and ERC-7579 (Modular Smart Account standard). The hook contracts are deployed at verified addresses on Base Sepolia. Moving to Base mainnet would require redeployment — the code is identical.

---

### Q4: "How does the audit trail work?"

**Accurate answer:** Every transaction attempt — approved or rejected — creates a TPDRRecord (Tamper-Evident Policy Decision Record) stored in memory during the session. It contains: the original intent, all 10 policy check results, the integrity verification result, and the on-chain execution result including the transaction hash. Currently stored in-memory (lost on restart). Production version would persist to a database.

---

### Q5: "Can I add more rules? What about multi-token support?"

**Accurate answer:** Currently the system supports only ERC-20 `transfer()` function. The policy engine can be extended — the check functions in `policy.ts` are individual, modular functions. Adding a new check is a few lines of code. Multi-token support would require extending the `SpendingLimitHook` configuration and the allowlist per-token. The SDK supports this via the `presetParams` configuration. It's not implemented in this MVP.

---

## Current Limitations (Be Honest)

| Limitation | Impact |
|-----------|--------|
| In-memory replay protection | Agent could replay attacks after server restart |
| In-memory spending tracker | Drift from on-chain state possible |
| No real LLM | Demo planner is scripted, not intelligent |
| No live transaction hash | On-chain hook enforcement not demonstrated end-to-end |
| Single token only (ERC-20 transfer) | Cannot handle ETH, NFTs, DeFi |
| Owner key = full control | Key compromise = total loss |
| No UI | Command-line only |

---

## What Still Needs to Be Built

| Feature | Priority | Effort |
|---------|---------|--------|
| Persistent replay protection (database/on-chain) | HIGH | 1 week |
| On-chain spending read (getRemainingAllowance()) | HIGH | 2 days |
| Real LLM planner (OpenAI/Anthropic) | MEDIUM | 3 days |
| Web UI for guardian controls | MEDIUM | 2 weeks |
| Multi-token support | MEDIUM | 1 week |
| Formal security audit | HIGH before production | External |
| Live testnet transaction | HIGH for demo | 1 hour with ETH |

---

## Proposal Outline

### Scope
- Policy-governed AI agent wallet
- ERC-4337 + ERC-7579 architecture
- Off-chain policy engine + TPDR audit layer
- On-chain spending limit, allowlist, emergency pause

### Deliverables
1. Working SDK (TypeScript) — complete
2. Mock demo — complete
3. Test suite (83 tests) — complete
4. Architecture documentation — complete
5. Live testnet deployment — requires ETH + API keys (30 min setup)
6. Production version — requires items in "What Still Needs to Be Built"

### Timeline
- MVP demo ready: **Now**
- Production-ready v1: **6-8 weeks**
- With formal security audit: **3-4 months**

### Client Responsibilities
- Provide testnet ETH + API keys for live demo
- Provide compliance requirements for policy rules
- Provide approved recipient list and spending limits
- Manage owner private key security (cold storage recommended)

### Pricing Factors
- Complexity of policy rules
- Number of tokens supported
- UI requirements
- Audit requirements
- Ongoing maintenance
