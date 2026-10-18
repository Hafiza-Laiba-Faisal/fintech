/**
 * Generate two fresh Ethereum wallets for the demo.
 * No MetaMask, no external tools needed.
 *
 * Output:
 *   OWNER wallet   — deploys the Sentinel Wallet, signs transactions
 *   RECIPIENT wallet — the ONLY address the agent can send to
 *
 * IMPORTANT: Save the private keys shown — they are shown ONCE.
 * These are testnet-only keys. Never use with real funds.
 *
 * Usage:
 *   npm run generate:wallet
 */

import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const BOLD = "\x1b[1m";
const RED = "\x1b[31m";
const RESET = "\x1b[0m";
const DIM = "\x1b[2m";

function makeWallet(label: string) {
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  return { label, privateKey, address: account.address };
}

const owner     = makeWallet("OWNER");
const recipient = makeWallet("RECIPIENT");

console.log(`
${BOLD}════════════════════════════════════════════════════════════
  SENTINEL WALLET — Fresh Wallet Generator
  Chain: Base Sepolia (testnet only)
════════════════════════════════════════════════════════════${RESET}

${RED}${BOLD}⚠  SAVE THESE VALUES NOW — they will not be shown again ⚠${RESET}
${RED}   Never share private keys. Never use on mainnet.${RESET}

${BOLD}── OWNER WALLET (signs transactions, deploys wallet) ──${RESET}
  Address:     ${GREEN}${owner.address}${RESET}
  Private Key: ${YELLOW}${owner.privateKey}${RESET}

${BOLD}── RECIPIENT WALLET (agent sends USDC here) ──${RESET}
  Address:     ${GREEN}${recipient.address}${RESET}
  Private Key: ${DIM}(not needed — just needs to receive)${RESET}

${BOLD}════════════════════════════════════════════════════════════
  COPY THIS INTO YOUR .env FILE:
════════════════════════════════════════════════════════════${RESET}

OWNER_ADDRESS=${owner.address}
OWNER_PRIVATE_KEY=${owner.privateKey}
APPROVED_RECIPIENT=${recipient.address}
GUARDIAN_ADDRESS=${owner.address}

${BOLD}════════════════════════════════════════════════════════════
  NEXT STEPS (in order):
════════════════════════════════════════════════════════════${RESET}

  ${BOLD}Step 1${RESET} — Get free API keys (5 min):
    Alchemy:  https://www.alchemy.com  → Create App → Base Sepolia
    Pimlico:  https://dashboard.pimlico.io → New API Key → Base Sepolia

  ${BOLD}Step 2${RESET} — Get test ETH for owner address:
    https://faucet.quicknode.com/base/sepolia
    Paste: ${owner.address}
    Amount needed: ~0.02 ETH

  ${BOLD}Step 3${RESET} — Get test USDC for owner address:
    https://faucet.circle.com  (select "Base Sepolia")
    Paste: ${owner.address}
    Amount: any (script needs ~5 USDC)

  ${BOLD}Step 4${RESET} — Fill .env:
    RPC_URL=https://base-sepolia.g.alchemy.com/v2/YOUR_KEY
    BUNDLER_URL=https://api.pimlico.io/v2/base-sepolia/rpc?apikey=YOUR_KEY
    OWNER_ADDRESS=${owner.address}
    OWNER_PRIVATE_KEY=${owner.privateKey}
    APPROVED_RECIPIENT=${recipient.address}
    GUARDIAN_ADDRESS=${owner.address}

  ${BOLD}Step 5${RESET} — Run live test:
    npm run live:test
`);
