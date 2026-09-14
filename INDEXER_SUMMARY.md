# Frankencoin Ponder Indexer — Summary

**Last updated:** 2026-09-07  
**Ponder:** 0.17.9 · **Viem:** 2.55.11 · **Package:** `@frankencoin/ponder` v0.3.6

---

## Overview

Production blockchain indexer for the Frankencoin (ZCHF) ecosystem. Indexes events from **8 chains** (Ethereum mainnet + Polygon, Arbitrum, Optimism, Base, Avalanche, Gnosis, Sonic) and exposes all data via an auto-generated GraphQL API.

**Deployments:**
- Production: `ponder.frankencoin.com`
- Test: `ponder.test.frankencoin.com`

---

## Technology Stack

- **Framework:** Ponder 0.17.9
- **Database:** PostgreSQL (production) / SQLite (development)
- **API:** Hono + Ponder auto-generated GraphQL
- **Blockchain:** Viem 2.55.11
- **Contracts/ABIs:** `@frankencoin/zchf` (all ABIs and addresses, including FCS/governance — nothing vendored locally except `UniswapAmplifier`)

---

## Architecture

### Multichain — Native + Bridged

**Mainnet only:**
- Frankencoin core (`FrankencoinABI`) — minting, governance, profit/loss
- Equity token FPS (`EquityABI`)
- MintingHub V1 + V2 (`MintingHubV1ABI`, `MintingHubV2ABI`)
- Position V1 + V2 — factory-discovered from `PositionOpened` events
- Savings V2 + SavingsReferral
- Position Roller V2
- Uniswap V3 ZCHF/USDT price pool
- CCIP Bridge Accounting
- FCS — ERC-4626 vault wrapping Equity 1:1
- MainnetVotes — FCS vote CCIPSender (auto-deployed by FCS's constructor)

**Mainnet + Optimism:**
- UniswapAmplifier (`abis/UniswapAmplifier.ts`, vendored) — ZCHF minter for Uniswap v3 ZCHF/USD liquidity
- AmplifiedPosition — EIP-1167 clones, factory-discovered from `AmplifiedPositionCreated` events

**All 8 chains:**
- Bridged Frankencoin (ERC20)
- Bridged Savings / SavingsReferral
- Transfer Reference (payment memos + cross-chain tracking)
- Leadrate (interest rate governance)
- CCIP Admin
- MinterGovernance — minter proposals, one instance per chain

**7 L2s only:** BridgedVotes — FCS vote CCIPReceiver, syncs votes pushed from `MainnetVotes`

### Factory Pattern

Position contracts are not deployed at a fixed address. Ponder discovers them dynamically:

1. `MintingHubV2:PositionOpened` fires → new position address extracted
2. Ponder registers the address for `PositionV2` event listening from that block
3. Subsequent `MintingUpdate`, `PositionDenied`, `OwnershipTransferred` events are indexed

**Known history:** Ponder 0.17.0 fixed a same-batch factory child-address miss bug. Clean re-index if the database predates that upgrade.

---

## Schema (58 tables across 18 domains)

### Frankencoin Core
`FrankencoinMinter`, `FrankencoinProfitLoss`

Minter applications with approval/veto status. Profit and loss events with per-FPS earnings calculations.

---

### Equity (FPS Token)
`EquityDelegation`, `EquityTrade`, `EquityTradeChart`

FPS trading history, price time-series, and voting delegation. Trade types: `Trade`, `Mint`, `Redeem`.

---

### MintingHub V1 + V2
`MintingHubV{n}Status`, `MintingHubV{n}PositionV{n}`, `MintingHubV{n}OwnerTransfersV{n}`, `MintingHubV{n}MintingUpdateV{n}`, `MintingHubV{n}ChallengeV{n}`, `MintingHubV{n}ChallengeBidV{n}`

Complete position lifecycle: opening, minting updates, owner transfers, challenges, bids, and closure. V2 adds `riskPremiumPPM`, `parent` (position genealogy), and `availableForMinting`.

Status tables track per-position event counters for pagination.

---

### Position Aggregates
`PositionAggregatesV1`, `PositionAggregatesV2` — current state (one row per chain)  
`PositionAggregatesV1History`, `PositionAggregatesV2History` — flat time-series (one row per block per chain)

Pre-computed on every `MintingUpdate` event by scanning all open positions. Used by the API for total minted and annual interest without N+1 queries.

- V1 formula: `annualInterests = Σ(minted × annualInterestPPM / 1_000_000)`
- V2 formula: `annualInterests = Σ(minted × (riskPremiumPPM + mintLeadRate) / 1_000_000)`

History tables enable time-series charts for minted/interest without querying raw minting updates.

---

### Savings
`SavingsStatus`, `SavingsMapping`, `SavingsActivity`, `SavingsReferrerMapping`, `SavingsReferrerEarnings`

Per-account and per-module tracking across all chains. Includes referral system with fee shares. Balances **exclude real-time accrual** — add `balance × rate × elapsed / year / 1_000_000` or call the contract for the exact figure.

---

### Lead Rate (Interest Rate Governance)
`LeadrateRateChanged`, `LeadRateProposed`

Tracks two separate rates:
- **Mint rate** (from SavingsV2): used for V2 position interest — `annualInterest = minted × (riskPremium + mintRate) / 1_000_000`
- **Save rate** (from SavingsReferral): used for savings projections — fallback to mint rate if unavailable

Both stored in analytics tables for historical tracking.

---

### ERC20 Tracking
`ERC20Status`, `ERC20Mint`, `ERC20Burn`, `ERC20TotalSupply`, `ERC20Balance`, `ERC20BalanceMapping`

Tracks ZCHF and FPS (equity) across all chains.

`ERC20TotalSupply` is day-bucketed (one row per day per chain). The API uses this table to reconstruct cross-chain total supply history: for each timestamp, supply per chain is merged via carry-forward logic — the last known supply for each chain is propagated forward until the next event.

`ERC20BalanceMapping` tracks cumulative mint/burn per account for balance reconstruction.

---

### Cross-Chain Bridge
`BridgedAccountingReceivedSettlement`

CCIP settlement events between mainnet and L2s. Records profits, losses, and settlement type per remote chain.

---

### Transfer Reference
`TransferReference`

Payments with memos and cross-chain transfers. Captures `reference` string (payment memo), `targetChain`, sender, and amount on every chain.

---

### Price Discovery
`PriceDiscovery`

ZCHF price from Uniswap V3 ZCHF/USDT pool swaps on mainnet.

---

### Amplifier (mainnet + Optimism)
`AmplifierStatus`, `AmplifierPosition`, `AmplifierActivity`

Event-sourced facts for the `UniswapAmplifier` minter and its `AmplifiedPosition` clones — **no valuations or pool prices** (the API derives position value from live `slot0()` reads).

- `AmplifierStatus` — one row per amplifier per chain: immutables (pool, tokens, expiration, limit), `totalBorrowed` (always **set** from the latest `Borrowed`/`Repaid` event, never accumulated), `positionCount`.
- `AmplifierPosition` — one row per clone: `owner` (updated on `OwnershipTransferred`), fixed `tickLow`/`tickHigh`, running `liquidity`/`borrowed` sums.
- `AmplifierActivity` — append-only `Mint`/`Burn` log, PK `(chainId, txHash, count)`.

Deployments: mainnet `0xa130...ED8C58` (ZCHF/USDT), Optimism `0x15CE...20F0d8F` (ZCHF/USDC). The expired mainnet test amplifier is deliberately not indexed.

---

### FCS & Governance
`FCSWrapped`, `FCSUnwrapped`, `FCSDeposit`, `FCSWithdraw`, `FCSTradeChart`, `FCSShot`, `MinterGovernanceMinterAnnounced`, `MinterGovernanceRewarded`, `FCSDelegation`, `MainnetVotesSynced`, `BridgedVotesReceived`

FCS is an ERC-4626 vault (mainnet-only) wrapping Equity 1:1; deposits/withdrawals mint/burn FCS against FPS. `MinterGovernance` (all 8 chains) tracks minter proposals and caller rewards. Vote delegation and cross-chain sync run through `MainnetVotes` (mainnet, CCIP sender) and `BridgedVotes` (7 L2s, CCIP receiver) into the shared `FCSDelegation` table. All four contracts share one `startFCSGovernance` block per chain (same `GovernanceFactory` deploy tx).

---

### Position Roller V2
`RollerV2Rolled`

Position migrations: collateral withdrawn from source + deposited to target, ZCHF repaid and re-minted.

---

### Analytics (opt-in)
`AnalyticTransactionLog`, `AnalyticDailyLog`

**Only written when `ENABLE_TRANSACTION_LOG=true`.**

Full ecosystem snapshot on every tracked transaction (TransactionLog) and daily rollup (DailyLog). Metrics include: ZCHF supply, equity balance, savings balance, FPS supply and price, V1/V2 minted totals, both lead rates, projected and realized net earnings (365-day rolling window).

Disabled by default because the computation is expensive (multiple on-chain reads + DB queries per event). Enable on deployments where dashboard analytics are needed.

---

### Common / Utility
`CommonActiveUser`, `CommonEcosystem`

`CommonEcosystem` is a key-value store for global aggregates: `Equity:Profits`, `Equity:Losses`, `Equity:EarningsPerFPS`, `Savings:TotalSaved`, etc. Used as a fast lookup by `updateTransactionLog`.

---

## Helper Libraries

### `src/lib/TransactionLog.ts`

`updateTransactionLog()` — writes analytics snapshots to `AnalyticTransactionLog` / `AnalyticDailyLog`.

**Guards:**
1. `if (process.env.ENABLE_TRANSACTION_LOG !== 'true') return;`
2. `if (chainId != mainnet.id) return;`

Both guards are at the top of the function. All call sites in handler files are active — the env var is the single toggle.

Called from: `Equity.ts`, `Frankencoin.ts`, `CCIPBridgedAccounting.ts`, `SavingsV2.ts`, `SavingsReferral.ts`, `Leadrate.ts`, `ERC20MintBurn.ts`.

### `src/lib/ERC20MintBurn.ts`

`indexERC20MintBurn()` — called on every `ERC20:Transfer` event, processes only mints and burns.

Writes per event:
- `ERC20Status` (supply counter upsert)
- `ERC20Mint` or `ERC20Burn` (flat record)
- `ERC20TotalSupply` (day-bucketed supply snapshot)
- `ERC20BalanceMapping` (per-account cumulative mint/burn)

### `src/lib/ERC20Balance.ts`

`indexERC20Balance()` — transfer history and balance snapshots for wallet-level tracking.

---

## Environment Variables

| Variable | Default | Required | Description |
|---|---|---|---|
| `ALCHEMY_RPC_KEY` | — | Yes | Alchemy key (used for all chains) |
| `DATABASE_URL` | — | No | Postgres URL; omit for SQLite |
| `PORT` | `42069` | No | HTTP server port |
| `MAX_REQUESTS_PER_SECOND` | `10` | No | Per-chain RPC rate limit |
| `POLLING_INTERVAL_MS` | `30000` | No | Live block polling interval (ms) |
| `ENABLE_TRANSACTION_LOG` | `false` | No | Write analytics tables (`AnalyticTransactionLog`, `AnalyticDailyLog`) |

---

## Start Blocks (Mainnet)

```
Frankencoin / Equity:   18451518
MintingHub V1:          18451536
MintingHub V2:          21280757
Uniswap V3 Pool:        19122801
SavingsReferral:        22536327
CCIP Bridge:            22623055
TransferReference:      22678761
UniswapAmplifier:       25795552
FCS/Governance/Votes:   25852506
```

L2 start blocks are in `ponder.config.ts` per chain (e.g. Optimism `UniswapAmplifier`: `155811236`, `startFCSGovernance`: `156162581`).

---

## Known Limitations

- **Analytics are mainnet-only.** `updateTransactionLog` skips all L2 events by design.
- **Savings balances exclude real-time accrual.** Calculate off-chain or call the contract.
- **Position tables store current state.** Use `MintingUpdateV{n}` for historical snapshots. `PositionAggregatesV{n}History` gives aggregate history.
- **`context.client` is chain-locked.** Use the exported `mainnetClient` from `ponder.config.ts` for cross-chain reads inside handlers.
- **`AmplifierPosition.liquidity` can undercount.** Liquidity donated by minting directly on the pool with a clone as recipient emits no event on the clone. Treat live `totalLiquidity()` as authoritative; the indexed value is a registry/fallback.
- **Factory sync requires clean re-index** if the database was initialized before Ponder 0.17.0 (the factory same-batch child-address bug, since fixed upstream).
