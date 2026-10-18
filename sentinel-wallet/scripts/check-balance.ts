import "dotenv/config";
import { createPublicClient, http, formatEther, formatUnits } from "viem";
import { baseSepolia } from "viem/chains";

const OWNER    = (process.env.OWNER_ADDRESS ?? "") as `0x${string}`;
const USDC     = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as `0x${string}`;
const RPC      = process.env.RPC_URL ?? "https://sepolia.base.org";
const client = createPublicClient({
  chain: baseSepolia,
  transport: http(RPC, { timeout: 15000 }),
});

const ethBal = await client.getBalance({ address: OWNER as `0x${string}` });

let usdcBal = 0n;
try {
  usdcBal = await client.readContract({
    address: USDC as `0x${string}`,
    abi: [{ name: "balanceOf", type: "function", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }], stateMutability: "view" }],
    functionName: "balanceOf",
    args: [OWNER as `0x${string}`],
  }) as bigint;
} catch {}

console.log(`\nAddress: ${OWNER}`);
console.log(`ETH:     ${formatEther(ethBal)} ETH`);
console.log(`USDC:    ${formatUnits(usdcBal, 6)} USDC`);
console.log(`\nETH ready:  ${ethBal > 0n ? "YES ✅" : "NO ❌ — faucet se lo"}`);
console.log(`USDC ready: ${usdcBal > 0n ? "YES ✅" : "NO ❌ — https://faucet.circle.com"}`);
