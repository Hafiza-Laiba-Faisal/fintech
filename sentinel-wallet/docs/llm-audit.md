# LLM Provider Audit — SmartAgentKit Repository

Performed: October 2026  
Source: Full code inspection of `apps/examples/` and `packages/integrations/`

---

## 1. LLM Providers Found in Repository

### Provider A: OpenAI

| Field | Value |
|-------|-------|
| Package | `@langchain/openai ^0.4.0` |
| Model | `"gpt-4o"` (hardcoded in agent.ts) |
| Source file | `apps/examples/defi-trading-agent/src/agent.ts:73` |
| Class | `ChatOpenAI({ model: "gpt-4o", temperature: 0 })` |
| Environment variable | `OPENAI_API_KEY` |
| `.env.example` | `apps/examples/defi-trading-agent/.env.example` — `OPENAI_API_KEY=sk-...` |
| API key URL | https://platform.openai.com/api-keys |
| Required for MVP | **NO** — mock mode (`--mock` flag) skips LLM entirely |

### Provider B: Anthropic Claude

| Field | Value |
|-------|-------|
| Package | `@langchain/anthropic ^0.3.0` |
| Model | `"claude-sonnet-4-20250514"` (hardcoded in agent.ts) |
| Source file | `apps/examples/treasury-management-agent/src/agent.ts:108` |
| Class | `ChatAnthropic({ model: "claude-sonnet-4-20250514", temperature: 0 })` |
| Environment variable | `ANTHROPIC_API_KEY` |
| `.env.example` | `apps/examples/treasury-management-agent/.env.example` — `ANTHROPIC_API_KEY=sk-ant-...` |
| API key URL | https://console.anthropic.com/settings/keys |
| Required for MVP | **NO** — mock mode skips LLM entirely |

---

## 2. LangChain Integration Package

**Package:** `@smartagentkit/langchain` (`packages/integrations/langchain/`)  
**Purpose:** Bridge between LLM agents and SmartAgentKit SDK  
**Key export:** `createSmartAgentKitTools(client, walletAddress)` — returns 5 DynamicStructuredTool instances  
**Peer dependency:** `@langchain/core >=0.3.0`  
**Note:** This package is LLM-provider-agnostic — works with OpenAI, Anthropic, or any LangChain-compatible model

---

## 3. Examples WITHOUT LLM (no API key needed)

| Example | LLM? | Notes |
|---------|------|-------|
| `payment-distribution-bot` | **No LLM** | Pure TypeScript scheduler |
| `arbitrage-agent` | **No LLM** | Deterministic DEX bot |
| `monitoring-alert-agent` | **No LLM** | Rule-based watchdog |
| `policy-playground` | **No LLM** | Plugin architecture demo |

---

## 4. Mock Mode (no keys, no network)

All examples support `pnpm start:mock` which:
- Imports `MockSmartAgentKitClient` from `@smartagentkit/testing`
- Runs scripted tool calls (no LLM inference)
- Requires ZERO environment variables
- Verified in: `defi-trading-agent/src/agent.ts::runMockDemo()` and `treasury-management-agent/src/agent.ts::runMockDemo()`

---

## 5. Sentinel Wallet Recommendation

**Do NOT add a second LLM provider.**

The Sentinel Wallet demo uses a **deterministic rule-based planner** (`src/planner.ts`) — no LLM required. This makes the demo:
- Fully reproducible (same input → same output every time)
- Runnable offline (no API quota, no rate limits)
- Faster to demonstrate under competition time pressure

If judges want to see a real LLM integration, the `@smartagentkit/langchain` package is already available. To add it:
1. `npm install @langchain/openai` or `@langchain/anthropic`
2. Replace `parsePlannerRequest()` in `src/planner.ts` with an async LLM call
3. All downstream policy/integrity checks remain unchanged

The agent NEVER bypasses the policy engine regardless of which provider is used.

---

## 6. Required Environment Variables

For mock mode (competition demo): **NONE**

For live testnet demo:

| Variable | Purpose | Source |
|----------|---------|--------|
| `RPC_URL` | Base Sepolia RPC endpoint | https://www.alchemy.com (free tier) |
| `BUNDLER_URL` | Pimlico ERC-4337 bundler | https://dashboard.pimlico.io (free tier) |
| `OWNER_ADDRESS` | Owner EOA address | Your wallet |
| `OWNER_PRIVATE_KEY` | Owner signing key (never commit) | Your wallet |
| `APPROVED_RECIPIENT` | The ONLY address agent may send to | Your second address |
| `GUARDIAN_ADDRESS` | Guardian (can be same as owner) | Your wallet |

For real LLM mode (optional):

| Variable | Purpose | Source |
|----------|---------|--------|
| `OPENAI_API_KEY` | OpenAI API | https://platform.openai.com/api-keys |
| `ANTHROPIC_API_KEY` | Anthropic Claude API | https://console.anthropic.com/settings/keys |
