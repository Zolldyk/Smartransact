# Smartransact: Smart Transaction Stack

Solana mainnet Jito bundle agent with adaptive LLM-powered retry. Watch a real transaction lifecycle unfold or run your own dryRun session (free, no SOL) at the live demo.

**Demo video (3 min):** [Watch on Loom](https://www.loom.com/share/e133d15d32ad4868ad19efe08691e7b0)

**Run a live demo yourself:** [https://smartransact.vercel.app](https://smartransact.vercel.app) · [Architecture](https://smartransact.vercel.app/architecture) · [Docs](https://smartransact.vercel.app/readme)

## CLI Quickstart

```bash
git clone https://github.com/Zolldyk/Smartransact.git && cd Smartransact
cp .env.example .env     # fill in GROQ_API_KEY (free at console.groq.com/keys)
npm install
npx tsx src/cli/main.ts run --profile mainnet-ws   # dryRun, $0
npx tsx src/cli/main.ts tail                        # stream the evidence log
```

## Why Mainnet

Jito's Block Engine has no devnet endpoint; it exists on mainnet and testnet only. The run can be done on "devnet or mainnet" but Jito's constraint makes mainnet the only network satisfying both §6 and the bundle requirement. `dryRun: true` (default) keeps all development free.

## Architecture

See [Architecture page](https://smartransact.vercel.app/architecture) .
