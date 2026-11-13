/**
 * Sentinel Wallet — READ-ONLY Safe execution-path inspection
 *
 * NO transactions, NO funds, NO signatures: only eth_call views plus ONE
 * eth_estimateUserOperationGas simulation against the bundler (estimation
 * receipts are not broadcast and do not touch account state).
 *
 * Usage: npx tsx scripts/inspect-safe.ts
 */

import "dotenv/config";
import {
  createPublicClient,
  http,
  parseAbi,
  keccak256,
  encodePacked,
  hexToBigInt,
  encodeFunctionData,
  type Address,
  type Hex,
} from "viem";
import { baseSepolia } from "viem/chains";

const RPC_URL = process.env.RPC_URL || "https://sepolia.base.org";
const SAFE = (process.env.EXISTING_WALLET_ADDRESS ?? "0x6cDE0BB1A5fb957d0e55c6E2dcd0a466c06D5123") as Address;
const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as Address;
const ENTRYPOINT_V07 = "0x0000000071727De22E5E9d8BAf0edAc6f37da032" as Address;
const SAFE_7579_MODULE = "0x7579EE8307284F293B1927136486880611F20002" as Address;
const HOOK_MULTIPLEXER = "0xF6782ed057F95f334D04F0Af1Af4D14fb84DE549" as Address;

const SAFE_ABI = parseAbi([
  "function VERSION() view returns (string)",
  "function getOwners() view returns (address[])",
  "function getThreshold() view returns (uint256)",
  "function nonce() view returns (uint256)",
]);

const CLIENT = createPublicClient({
  chain: baseSepolia,
  transport: http(RPC_URL, { timeout: 20000 }),
});

const PASS = "\x1b[32m✔\x1b[0m";
const FAIL = "\x1b[31m✘\x1b[0m";
const INFO = "\x1b[2mℹ\x1b[0m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";

function tag(t: string, msg: string) {
  console.log(`  ${t}  ${msg}`);
}

// ─── ERC-7579 moduleStorage computation ──────────────────────────────────────
// ERC-7579 spec: moduleStorage(moduleTypeId, moduleAddress) =
//   keccak256(abi.encodePacked(moduleAddress, keccak256(abi.encodePacked(moduleTypeId))))
// (typeId 1=validator, 4=hook)
function moduleStorage(moduleTypeId: bigint, module: Address): Hex {
  const typeId = keccak256(
    encodePacked(["uint256"], [moduleTypeId]),
  );
  return keccak256(encodePacked(["address", "bytes32"], [module, typeId]));
}

const MODULE_TYPE_VALIDATOR = 1n;
const MODULE_TYPE_HOOK = 4n;

async function main(): Promise<void> {
  console.log(`\n${BOLD}══════ READ-ONLY SAFE EXECUTION PATH INSPECTION ══════${RESET}`);
  console.log(`Chain: Base Sepolia (84532) | Safe: ${SAFE}\n`);

  // ── 1. Is the displayed guarded-wallet address actually a deployed Safe? ──
  console.log(`── 1. SAFE ACCOUNT DEPLOYMENT STATE ──`);
  const code = await CLIENT.getBytecode({ address: SAFE });
  const codeBytes = code ? (code.length - 2) / 2 : 0;
  if (codeBytes > 0) {
    tag(PASS, `Code size: ${codeBytes} bytes — a contract is deployed at ${SAFE.slice(0, 10)}…`);
  } else {
    tag(FAIL, `NO code at ${SAFE} — address is an EOA or empty; Safe path impossible`);
  }

  try {
    const version = await CLIENT.readContract({ address: SAFE, abi: SAFE_ABI, functionName: "VERSION" });
    const owners = (await CLIENT.readContract({ address: SAFE, abi: SAFE_ABI, functionName: "getOwners" })) as Address[];
    const threshold = await CLIENT.readContract({ address: SAFE, abi: SAFE_ABI, functionName: "getThreshold" });
    const nonce = await CLIENT.readContract({ address: SAFE, abi: SAFE_ABI, functionName: "nonce" });
    tag(PASS, `Safe VERSION: ${version}`);
    tag(PASS, `Owners: ${owners.join(", ")}`);
    tag(PASS, `Threshold: ${threshold}`);
    tag(PASS, `Safe nonce: ${nonce}`);
  } catch (e) {
    tag(FAIL, `Safe ABI reads failed: ${(e as Error).message.slice(0, 140)}`);
  }

  // ── 2. ERC-7579 module / hook installation state ──────────────────────────
  console.log(`\n── 2. SAFE MODULES & ERC-7579 INSTALLATION ──`);
  const FALLBACK_HANDLER_SLOT = "0x6c9a6c4a39284e37ed1cf5c9def0e243ca3f430c000000000000000000000000" as Hex;
  try {
    const SAFE_MOD_ABI = parseAbi([
      "function isModuleEnabled(address module) view returns (bool)",
    ]);
    const isSafe7579Enabled = await CLIENT.readContract({
      address: SAFE,
      abi: SAFE_MOD_ABI,
      functionName: "isModuleEnabled",
      args: [SAFE_7579_MODULE],
    });
    tag(isSafe7579Enabled ? PASS : FAIL, `Safe7579 module enabled on Safe: ${isSafe7579Enabled}`);

    const fallbackHandlerSlotVal = await CLIENT.getStorageAt({
      address: SAFE,
      slot: FALLBACK_HANDLER_SLOT,
    });
    const fallbackHandlerAddr = fallbackHandlerSlotVal ? ("0x" + fallbackHandlerSlotVal.slice(26)) : "0x0";
    const isFallbackConfigured = fallbackHandlerAddr.toLowerCase() === SAFE_7579_MODULE.toLowerCase();
    if (isFallbackConfigured) {
      tag(PASS, `Safe fallback handler correctly configured: ${fallbackHandlerAddr}`);
    } else {
      tag(FAIL, `Safe fallback handler is NOT Safe7579! Current slot value: ${fallbackHandlerSlotVal ?? "0x0"}`);
      tag(INFO, `Without Safe7579 fallback handler, all non-core ERC-7579 calls revert with 0xacfdb444 (ExecutionFailed).`);
    }

    // Try ERC-7579 canonical accountId()
    const EXT_ABI = parseAbi([
      "function accountId() view returns (string)",
      "function supportsModule(uint256 moduleTypeId) view returns (bool)",
    ]);
    try {
      const accId = await CLIENT.readContract({ address: SAFE, abi: EXT_ABI, functionName: "accountId" });
      tag(PASS, `ERC-7579 accountId(): ${accId}`);
    } catch (e) {
      tag(FAIL, `ERC-7579 accountId() reverted (expected if fallback handler is missing): ${(e as Error).message.slice(0, 100)}`);
    }
  } catch (e) {
    tag(FAIL, `Safe module checks failed: ${(e as Error).message.slice(0, 180)}`);
  }

  // ── 3. EntryPoint v0.7 state ──────────────────────────────────────────────
  console.log(`\n── 3. ENTRYPOINT V0.7 STATE ──`);
  try {
    const EP_ABI = parseAbi([
      "function getNonce(address sender, uint192 key) view returns (uint256)",
      "function balanceOf(address account) view returns (uint256)",
    ]);
    const epNonce = await CLIENT.readContract({
      address: ENTRYPOINT_V07,
      abi: EP_ABI,
      functionName: "getNonce",
      args: [SAFE, 0n],
    });
    const epDeposit = await CLIENT.readContract({
      address: ENTRYPOINT_V07,
      abi: EP_ABI,
      functionName: "balanceOf",
      args: [SAFE],
    });
    tag(INFO, `EntryPoint nonce (sender=${SAFE.slice(0, 8)}…, key=0): ${epNonce}`);
    tag(INFO, `EntryPoint deposit (gas pre-fund): ${(Number(epDeposit) / 1e18).toFixed(6)} ETH`);
  } catch (e) {
    tag(FAIL, `EntryPoint reads failed: ${(e as Error).message.slice(0, 140)}`);
  }

  // ── 4. Bundler UserOperation SIMULATION (read-only, NOT a broadcast) ──────
  console.log(`\n── 4. BUNDLER SIMULATION REPRODUCTION (eth_estimateUserOperationGas only) ──`);
  const bundlerUrl = process.env.BUNDLER_URL;
  if (!bundlerUrl || /YOUR/.test(bundlerUrl)) {
    tag(FAIL, "BUNDLER_URL not set — cannot simulate. Set it in .env.");
    process.exit(0);
  }

  const transferData = encodeFunctionData({
    abi: parseAbi(["function transfer(address to, uint256 amount) returns (bool)"]),
    functionName: "transfer",
    args: [(process.env.APPROVED_RECIPIENT ?? SAFE) as Address, 1000000n],
  });
  // Safe7579: execute(address to, uint256 value, bytes data, uint8 operation)
  const accountExecuteData = encodeFunctionData({
    abi: parseAbi(["function execute(address to, uint256 value, bytes data, uint8 operation)"]),
    functionName: "execute",
    args: [USDC as Address, 0n, transferData, 0], // 0 = CALL
  });

  const userOp: Record<string, string | undefined> = {
    sender: SAFE,
    nonce: "0x0",
    callData: accountExecuteData,
    callGasLimit: "0x186a0",
    verificationGasLimit: "0x7a120",
    preVerificationGas: "0x186a0",
    maxFeePerGas: "0x5f5e100",
    maxPriorityFeePerGas: "0x5f5e100",
    signature: ("0x" + "f".repeat(130)) as Hex,
  };

  try {
    const res = await fetch(bundlerUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_estimateUserOperationGas",
        params: [userOp, ENTRYPOINT_V07],
      }),
      signal: AbortSignal.timeout(25000),
    });
    const text = await res.text();
    tag(INFO, `HTTP ${res.status}`);
    try {
      const json = JSON.parse(text) as {
        result?: unknown;
        error?: { code?: number; message?: string; data?: string };
      };
      if (json.error) {
        tag(FAIL, `Bundler error code: ${json.error.code}`);
        tag(FAIL, `Bundler error message: ${json.error.message}`);
        if (json.error.data) tag(FAIL, `Revert data: ${String(json.error.data).slice(0, 250)}`);
      } else {
        tag(PASS, `SIMULATION SUCCEEDED (read-only) — estimation returned:`);
        console.log(`    ${JSON.stringify(json.result).slice(0, 300)}`);
        console.log(`  ${INFO} If estimation passes, the live failure occurred at UserOp signing/sendUserOperation stage.`);
      }
    } catch {
      tag(FAIL, `Non-JSON response: ${text.slice(0, 300)}`);
    }
  } catch (e) {
    tag(FAIL, `Bundler unreachable: ${(e as Error).message.slice(0, 160)}`);
  }

  // ── 5. ERC-7484 REGISTRY & ATTESTATION PROBE ────────────────────────────
  console.log(`\n── 5. ERC-7484 REGISTRY & ATTESTATION PROBE ──`);
  // Canonical ERC-7484 registry on Base Sepolia (verified via Safe7579Launchpad & module-sdk)
  const REGISTRY = "0x000000000069e2a187aeffb852bf3ccdc95151b2" as Address;
  const ATTESTER = "0x000000333034E9f539ce08819E12c1b8Cb29084d" as Address;

  // Check if registry has code
  const registryCode = await CLIENT.getBytecode({ address: REGISTRY });
  const registryBytes = registryCode ? (registryCode.length - 2) / 2 : 0;
  if (registryBytes === 0) {
    tag(FAIL, `ERC-7484 Registry at ${REGISTRY} has NO bytecode on this chain.`);
  } else {
    tag(PASS, `Canonical ERC-7484 Registry deployed: ${registryBytes} bytes at ${REGISTRY}`);
    const REG_ABI = parseAbi([
      "function findTrustedAttesters(address account) view returns (address[])",
      "function checkForAccount(address smartAccount, address module) view",
      "function findAttestation(address module, address attester) view returns ((uint48 time, uint48 expirationTime, uint48 revocationTime, uint16 moduleTypes, address moduleAddress, address attester, address dataPointer, bytes32 schemaUID))",
    ]);

    try {
      const trusted = await CLIENT.readContract({
        address: REGISTRY,
        abi: REG_ABI,
        functionName: "findTrustedAttesters",
        args: [SAFE],
      });
      tag(PASS, `Safe's trusted attesters: [${trusted.join(", ")}]`);
    } catch (e) {
      tag(FAIL, `Failed to query findTrustedAttesters: ${(e as Error).message.slice(0, 100)}`);
    }

    try {
      const att = await CLIENT.readContract({
        address: REGISTRY,
        abi: REG_ABI,
        functionName: "findAttestation",
        args: [HOOK_MULTIPLEXER, ATTESTER],
      });
      tag(att.moduleAddress !== "0x0000000000000000000000000000000000000000" ? PASS : FAIL, `HookMultiPlexer attestation by Rhinestone: moduleTypes=${att.moduleTypes}, attester=${att.attester}`);
    } catch (e) {
      tag(FAIL, `findAttestation(HMP) failed: ${(e as Error).message.slice(0, 100)}`);
    }

    try {
      await CLIENT.readContract({
        address: REGISTRY,
        abi: REG_ABI,
        functionName: "checkForAccount",
        args: [SAFE, HOOK_MULTIPLEXER],
      });
      tag(PASS, `checkForAccount(SAFE, HookMultiPlexer) PASSED — attestation validation succeeds!`);
    } catch (e) {
      tag(FAIL, `checkForAccount failed: ${(e as Error).message.slice(0, 100)}`);
    }
  }

  console.log(`\n${DIM}══════ END (no transactions executed) ══════${RESET}\n`);
}

main().catch((e) => {
  console.error("inspection failed:", e);
  process.exit(1);
});
