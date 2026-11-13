/**
 * Sentinel Wallet — Safe 7579 Fallback Handler Configuration & Recovery Script
 *
 * Diagnoses and prepares configuration for Safe proxy to enable ERC-7579 UserOp handling.
 *
 * SAFETY COMMITMENT:
 * - By default, this script runs in DRY-RUN / SIMULATION mode only.
 * - It will NOT broadcast any on-chain transaction or spend funds without the explicit --broadcast flag.
 *
 * Usage:
 *   npx tsx scripts/recover-safe-7579.ts               (Dry-run simulation only)
 *   npx tsx scripts/recover-safe-7579.ts --broadcast   (Broadcasts ONLY when user approves)
 */

import "dotenv/config";
import { config } from "dotenv";
import { existsSync } from "fs";
import { resolve } from "path";

if (!process.env.OWNER_PRIVATE_KEY) {
  const localEnv = resolve(process.cwd(), "sentinel-wallet", ".env");
  if (existsSync(localEnv)) {
    config({ path: localEnv });
  }
}
import {
  createPublicClient,
  createWalletClient,
  http,
  encodeFunctionData,
  parseAbi,
  pad,
  concat,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

const RPC_URL = process.env.RPC_URL || "https://sepolia.base.org";
const SAFE = (process.env.EXISTING_WALLET_ADDRESS ?? "0x6cDE0BB1A5fb957d0e55c6E2dcd0a466c06D5123") as Address;
const SAFE_7579_MODULE = "0x7579EE8307284F293B1927136486880611F20002" as Address;
const FALLBACK_HANDLER_STORAGE_SLOT = "0x6c9a6c4a39284e37ed1cf5c9def0e243ca3f430c000000000000000000000000" as Hex;

const OWNER_PRIVATE_KEY = process.env.OWNER_PRIVATE_KEY as Hex | undefined;
if (!OWNER_PRIVATE_KEY) {
  console.error("FATAL: OWNER_PRIVATE_KEY not found in .env");
  process.exit(1);
}

const client = createPublicClient({
  chain: baseSepolia,
  transport: http(RPC_URL, { timeout: 25000 }),
});

const ownerAccount = privateKeyToAccount(OWNER_PRIVATE_KEY);

const SAFE_ABI = parseAbi([
  "function setFallbackHandler(address handler)",
  "function isModuleEnabled(address module) view returns (bool)",
  "function nonce() view returns (uint256)",
  "function execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures) returns (bool success)",
]);

async function main() {
  const isBroadcast = process.argv.includes("--broadcast");

  console.log("\n=======================================================");
  console.log("  SENTINEL WALLET — SAFE7579 FALLBACK HANDLER SETUP");
  console.log(`  Mode: ${isBroadcast ? "BROADCAST ON-CHAIN" : "DRY-RUN / READ-ONLY SIMULATION"}`);
  console.log(`  Safe:  ${SAFE}`);
  console.log(`  Owner: ${ownerAccount.address}`);
  console.log(`  Target Fallback Handler: ${SAFE_7579_MODULE}`);
  console.log("=======================================================\n");

  // 1. Check current fallback handler slot
  const currentSlotVal = await client.getStorageAt({
    address: SAFE,
    slot: FALLBACK_HANDLER_STORAGE_SLOT,
  });
  const currentHandler = currentSlotVal ? ("0x" + currentSlotVal.slice(26)).toLowerCase() : "0x0";

  console.log(`[1] Current Fallback Handler Slot: ${currentSlotVal ?? "0x0"}`);
  console.log(`    Extracted Address: ${currentHandler}`);

  if (currentHandler === SAFE_7579_MODULE.toLowerCase()) {
    console.log("\n[✔] Safe fallback handler is ALREADY set to Safe7579! No recovery needed.");
    return;
  }

  // 2. Check if Safe7579 module is enabled
  const isModuleEnabled = await client.readContract({
    address: SAFE,
    abi: SAFE_ABI,
    functionName: "isModuleEnabled",
    args: [SAFE_7579_MODULE],
  });
  console.log(`[2] Safe7579 Module Enabled: ${isModuleEnabled}`);

  // 3. Build setFallbackHandler calldata
  const setFallbackData = encodeFunctionData({
    abi: SAFE_ABI,
    functionName: "setFallbackHandler",
    args: [SAFE_7579_MODULE],
  });

  // For Safe 1.4.1 single owner, threshold 1:
  // When msg.sender == owner, signature format is: {32-bytes owner}{32-bytes 0}{0x01}
  const preapprovedSig = concat([
    pad(ownerAccount.address, { size: 32 }),
    pad("0x0", { size: 32 }),
    "0x01",
  ]);

  const execCalldata = encodeFunctionData({
    abi: SAFE_ABI,
    functionName: "execTransaction",
    args: [
      SAFE,
      0n,
      setFallbackData,
      0, // Call
      0n,
      0n,
      0n,
      "0x0000000000000000000000000000000000000000",
      "0x0000000000000000000000000000000000000000",
      preapprovedSig,
    ],
  });

  // 4. Simulate via eth_call
  console.log("[3] Simulating execTransaction via read-only eth_call...");
  try {
    const simResult = await client.call({
      account: ownerAccount.address,
      to: SAFE,
      data: execCalldata,
    });
    console.log(`[✔] Simulation SUCCESS: Return data = ${simResult.data}`);
    if (simResult.data === "0x0000000000000000000000000000000000000000000000000000000000000001") {
      console.log("    Confirmation: Safe returned true (1), transaction executes cleanly without reverting.");
    }
  } catch (err: any) {
    console.error(`[✘] Simulation FAILED: ${err.shortMessage || err.message}`);
    process.exit(1);
  }

  // 5. Broadcast ONLY if explicitly approved
  if (!isBroadcast) {
    console.log("\n-------------------------------------------------------");
    console.log("SIMULATION COMPLETED (0 gas spent, 0 transactions broadcast).");
    console.log("The fix is verified to execute cleanly on-chain.");
    console.log("To broadcast to Base Sepolia, obtain user approval, then run:");
    console.log("  npx tsx scripts/recover-safe-7579.ts --broadcast");
    console.log("-------------------------------------------------------\n");
    return;
  }

  console.log("\n[4] User approved broadcast. Sending transaction from Owner EOA...");
  const walletClient = createWalletClient({
    account: ownerAccount,
    chain: baseSepolia,
    transport: http(RPC_URL),
  });

  const txHash = await walletClient.sendTransaction({
    to: SAFE,
    data: execCalldata,
  });

  console.log(`[✔] Transaction broadcasted! Tx Hash: ${txHash}`);
  console.log(`    Explorer: https://sepolia.basescan.org/tx/${txHash}`);
  console.log("    Waiting for confirmation...");

  const receipt = await client.waitForTransactionReceipt({ hash: txHash, confirmations: 1 });
  console.log(`[✔] Transaction CONFIRMED in block ${receipt.blockNumber}! Status: ${receipt.status}`);
}

main().catch((e) => {
  console.error("Execution failed:", e);
  process.exit(1);
});
