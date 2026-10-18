/**
 * On-chain Verification Script — NO PRIVATE KEY REQUIRED
 *
 * This script uses a PUBLIC RPC to:
 * 1. Verify bytecode exists at each hook address (proves deployment)
 * 2. Check USDC contract exists
 * 3. Report what .env is still needed for live tx
 *
 * Usage:
 *   npx tsx scripts/verify-onchain.ts
 *   npx tsx scripts/verify-onchain.ts --rpc https://YOUR_RPC_URL
 */

import "dotenv/config";
import { createPublicClient, http, type Address } from "viem";
import { baseSepolia } from "viem/chains";

// ─── Addresses to verify ──────────────────────────────────────────────────────

const ADDRESSES = {
  entryPoint:         "0x0000000071727De22E5E9d8BAf0edAc6f37da032" as Address,
  hookMultiPlexer:    "0xF6782ed057F95f334D04F0Af1Af4D14fb84DE549" as Address,
  spendingLimitHook:  "0xd67a5E6784A66Ddf4C09EA7bbf81Ab89532624E4" as Address,
  allowlistHook:      "0x7899b03386A3874393A3769D637977d947A9Fc66" as Address,
  emergencyPauseHook: "0xAc0cE5672aED1Bfe5549b885f883a770Acd8cAE3" as Address,
  usdcBaseSepolia:    "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as Address,
  safe7579Module:     "0x7579EE8307284F293B1927136486880611F20002" as Address,
};

// ─── Public RPC fallbacks (no key needed) ────────────────────────────────────

const PUBLIC_RPCS = [
  "https://sepolia.base.org",                    // Coinbase public RPC
  "https://base-sepolia-rpc.publicnode.com",     // PublicNode
  "https://base-sepolia.blockpi.network/v1/rpc/public",
];

const rpcFromArg = process.argv.find(a => a.startsWith("--rpc="))?.split("=")[1]
  || process.argv[process.argv.indexOf("--rpc") + 1];
const envRpc = process.env.RPC_URL;

const GREEN  = "\x1b[32m";
const RED    = "\x1b[31m";
const YELLOW = "\x1b[33m";
const BOLD   = "\x1b[1m";
const DIM    = "\x1b[2m";
const RESET  = "\x1b[0m";

function pass(msg: string)  { console.log(`  ${GREEN}✔${RESET}  ${msg}`); }
function fail(msg: string)  { console.log(`  ${RED}✘${RESET}  ${msg}`); }
function info(msg: string)  { console.log(`  ${DIM}ℹ${RESET}  ${msg}`); }
function warn(msg: string)  { console.log(`  ${YELLOW}⚠${RESET}  ${msg}`); }
function section(title: string) {
  console.log(`\n${BOLD}── ${title} ──${RESET}`);
}

async function tryRpc(rpcUrl: string): Promise<boolean> {
  try {
    const client = createPublicClient({ chain: baseSepolia, transport: http(rpcUrl, { timeout: 8000 }) });
    const block = await client.getBlockNumber();
    return block > 0n;
  } catch {
    return false;
  }
}

async function main() {
  console.log(`\n${BOLD}════════════════════════════════════════════`);
  console.log(`  SENTINEL WALLET — ON-CHAIN VERIFICATION`);
  console.log(`  Chain: Base Sepolia (84532)`);
  console.log(`════════════════════════════════════════════${RESET}`);

  // ── Find working RPC ──────────────────────────────────────────────────────
  section("1. RPC CONNECTION");

  const rpcCandidates = [
    ...(rpcFromArg ? [rpcFromArg] : []),
    ...(envRpc ? [envRpc] : []),
    ...PUBLIC_RPCS,
  ];

  let workingRpc: string | null = null;
  for (const rpc of rpcCandidates) {
    process.stdout.write(`  Trying ${rpc.substring(0, 60)}... `);
    const ok = await tryRpc(rpc);
    if (ok) {
      console.log(`${GREEN}OK${RESET}`);
      workingRpc = rpc;
      break;
    } else {
      console.log(`${RED}FAIL${RESET}`);
    }
  }

  if (!workingRpc) {
    fail("No working RPC found. Provide one with --rpc=URL or set RPC_URL in .env");
    process.exit(1);
  }

  const client = createPublicClient({
    chain: baseSepolia,
    transport: http(workingRpc, { timeout: 15000 }),
  });

  const blockNumber = await client.getBlockNumber();
  pass(`Connected — block ${blockNumber}`);
  info(`RPC: ${workingRpc}`);

  // ── Bytecode verification ─────────────────────────────────────────────────
  section("2. BYTECODE VERIFICATION (proves contract is deployed)");
  info("Fetching bytecode at each hook address...\n");

  const results: Record<string, { size: number; deployed: boolean }> = {};

  for (const [name, address] of Object.entries(ADDRESSES)) {
    try {
      const code = await client.getBytecode({ address });
      const size = code ? (code.length - 2) / 2 : 0; // bytes
      const deployed = size > 0;
      results[name] = { size, deployed };

      if (deployed) {
        pass(`${name.padEnd(20)} ${address}  (${size} bytes)`);
      } else {
        fail(`${name.padEnd(20)} ${address}  — NO BYTECODE (not deployed)`);
      }
    } catch (e) {
      fail(`${name.padEnd(20)} ${address}  — RPC error: ${(e as Error).message}`);
      results[name] = { size: 0, deployed: false };
    }
  }

  const allDeployed = Object.values(results).every(r => r.deployed);
  console.log();
  if (allDeployed) {
    pass("All hook addresses have bytecode — contracts are deployed on Base Sepolia");
  } else {
    const missing = Object.entries(results).filter(([,v]) => !v.deployed).map(([k]) => k);
    fail(`Missing bytecode at: ${missing.join(", ")}`);
  }

  // ── USDC sanity check ─────────────────────────────────────────────────────
  section("3. USDC CONTRACT CHECK");

  try {
    // Call name() on USDC
    const name = await client.readContract({
      address: ADDRESSES.usdcBaseSepolia,
      abi: [{ name: "name", type: "function", inputs: [], outputs: [{ type: "string" }], stateMutability: "view" }],
      functionName: "name",
    });
    const symbol = await client.readContract({
      address: ADDRESSES.usdcBaseSepolia,
      abi: [{ name: "symbol", type: "function", inputs: [], outputs: [{ type: "string" }], stateMutability: "view" }],
      functionName: "symbol",
    });
    pass(`USDC contract verified: name="${name}", symbol="${symbol}"`);
  } catch (e) {
    fail(`USDC contract call failed: ${(e as Error).message}`);
  }

  // ── .env status ───────────────────────────────────────────────────────────
  section("4. .ENV STATUS — WHAT IS STILL NEEDED FOR LIVE TX");

  const required = {
    RPC_URL:         process.env.RPC_URL,
    BUNDLER_URL:     process.env.BUNDLER_URL,
    OWNER_ADDRESS:   process.env.OWNER_ADDRESS,
    OWNER_PRIVATE_KEY: process.env.OWNER_PRIVATE_KEY,
    APPROVED_RECIPIENT: process.env.APPROVED_RECIPIENT,
    GUARDIAN_ADDRESS:   process.env.GUARDIAN_ADDRESS,
  };

  let missing = 0;
  for (const [key, val] of Object.entries(required)) {
    if (val && val.length > 4 && !val.startsWith("0xYOUR")) {
      pass(`${key} — set`);
    } else {
      fail(`${key} — MISSING`);
      missing++;
    }
  }

  console.log();
  if (missing === 0) {
    pass("All env vars set — ready for live transaction");
  } else {
    warn(`${missing} env vars missing. Fill these in .env before running npm run demo`);
    console.log(`\n  Steps to get them:`);
    console.log(`  1. Alchemy RPC:   https://www.alchemy.com  (free, 2 min)`);
    console.log(`  2. Pimlico bundler: https://dashboard.pimlico.io  (free, 2 min)`);
    console.log(`  3. Test ETH:      https://faucet.quicknode.com/base/sepolia`);
    console.log(`  4. Test USDC:     https://faucet.circle.com (select Base Sepolia)`);
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  section("5. VERIFICATION SUMMARY");

  console.log(`\n  Bytecode verified:    ${allDeployed ? GREEN+"ALL CONTRACTS DEPLOYED"+RESET : RED+"SOME MISSING"+RESET}`);
  console.log(`  Real tx hash:         ${RED}NONE — .env not filled${RESET}`);
  console.log(`  On-chain enforcement: ${YELLOW}NOT YET TESTED — requires live tx${RESET}`);
  console.log(`\n  Next step: fill .env, then run:`);
  console.log(`  ${BOLD}npm run demo${RESET}  (real ERC-20 transfer + hook rejection test)\n`);
}

main().catch(e => {
  console.error("Fatal:", e);
  process.exit(1);
});
