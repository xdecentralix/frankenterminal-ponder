# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Ponder-based blockchain indexer for Frankencoin (ZCHF). Indexes events from Ethereum mainnet and 7 L2s (Polygon, Arbitrum, Optimism, Base, Avalanche, Gnosis, Sonic) and exposes data via a GraphQL API.

**Ponder version:** 0.17.0  
**Deployments:** `ponder.frankencoin.com` (main) · `ponder.test.frankencoin.com` (test)

## Environment

Create `.env.local` from `.env.example`:

| Variable | Default | Description |
|---|---|---|
| `ALCHEMY_RPC_KEY` | — | **Required.** Alchemy API key for all RPC endpoints |
| `DATABASE_URL` | — | Postgres URL. Omit to use SQLite |
| `PORT` | `42069` | Server port |
| `MAX_REQUESTS_PER_SECOND` | `10` | RPC rate limit |
| `POLLING_INTERVAL_MS` | `30000` | Block polling interval (ms) |
| `ENABLE_TRANSACTION_LOG` | `false` | Set `true` to write `AnalyticTransactionLog` / `AnalyticDailyLog` entries |

## Commands

```bash
yarn dev          # Development with live reload (disables UI)
yarn dev:ui       # Development with Ponder UI
yarn start        # Production
yarn codegen      # Regenerate types after schema/config changes
yarn typecheck    # TypeScript check
yarn lint         # ESLint
```

## Architecture

### Config (`ponder.config.ts`)

Single config file. Chain settings (RPC, rate limit, polling, block ranges, start blocks) are in the exported `config` object. Contracts are defined in `createConfig({ contracts: ... })`.

- **Start blocks are critical** — wrong start blocks cause full-chain scans. Check `ponder.config.ts` before adding contracts.
- `ethGetLogsBlockRange`: 5000 for most chains, 10000 for Arbitrum (fast blocks).
- Position contracts use Ponder's factory pattern: discovered dynamically from `PositionOpened` events on MintingHub.

### Schema (`schema/` → `ponder.schema.ts`)

Each schema file owns a domain. All are re-exported from `ponder.schema.ts`. Tables use `onchainTable()` with composite primary keys including `chainId` for multichain support.

**Table name limit:** 45 characters (Ponder 0.16 constraint).

### Event Handlers (`src/`)

File names mirror schema files. Pattern:

```typescript
ponder.on('Contract:EventName', async ({ event, context }) => {
  const { db, client, chain } = context;
  // context.client is locked to the event's source chain
  // For cross-chain reads, use the pre-configured mainnetClient from ponder.config.ts
});
```

### Helper Libraries (`src/lib/`)

**`TransactionLog.ts` — `updateTransactionLog()`**
- Computes analytics snapshots: supply, equity, savings, lead rates, net earnings
- **Gated by `ENABLE_TRANSACTION_LOG=true`** — returns immediately if not set
- Also skips non-mainnet chains (mainnet only)
- All call sites are active; the env guard is the single on/off switch

**`ERC20MintBurn.ts` — `indexERC20MintBurn()`**
- Called on every `ERC20:Transfer` event; filters for mint (`from == 0x0`) and burn (`to == 0x0`)
- Writes: `ERC20Status`, `ERC20Mint`/`ERC20Burn`, `ERC20TotalSupply`, `ERC20BalanceMapping`
- `ERC20TotalSupply` is the source for the API's timestamp-based cross-chain total supply reconstruction

**`ERC20Balance.ts` — `indexERC20Balance()`**
- Tracks transfer history and per-account balance snapshots

## Key Tables

| Table | Purpose |
|---|---|
| `MintingHubV2PositionV2` | Current state of all V2 positions |
| `MintingHubV2MintingUpdateV2` | Full minting update history per position |
| `PositionAggregatesV2` | Latest aggregate (totalMinted, annualInterests) — single row per chain |
| `PositionAggregatesV2History` | **New.** Flat time-series of aggregate snapshots, one row per block per chain |
| `PositionAggregatesV1` / `PositionAggregatesV1History` | Same, for V1 positions |
| `ERC20TotalSupply` | Day-bucketed supply snapshots per chain — powers cross-chain supply charts |
| `ERC20Status` | Current mint/burn counts and supply per token per chain |
| `AnalyticTransactionLog` | Full analytics snapshot per transaction (only with `ENABLE_TRANSACTION_LOG=true`) |
| `AnalyticDailyLog` | Daily rollup of analytics (only with `ENABLE_TRANSACTION_LOG=true`) |
| `CommonEcosystem` | Key-value store for global aggregates (profits, losses, earnings per FPS, etc.) |

## Key Patterns

- **Address normalization:** use `normalizeAddress()` from `src/utils/format.ts` — do not inline `.toLowerCase()`.
- **Upserts:** `onConflictDoUpdate((current) => ({ field: current.field + delta }))` — current state is always passed as a callback argument, not read separately.
- **Flat history tables** use `(chainId, updated)` as PK with `onConflictDoUpdate` to handle multiple events in the same block.
- **Schema changes require `yarn codegen`** before TypeScript will accept the new types.
- **Factory sync:** Ponder 0.17.0 fixed the factory same-batch child-address miss bug (previously worked around with a local patch, now removed). A clean re-index after upgrading resolves any stale state left from older versions.
