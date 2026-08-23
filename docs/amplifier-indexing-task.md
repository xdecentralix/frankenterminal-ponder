# Task: Index the UniswapAmplifier contracts

Self-contained implementation instructions for adding amplifier indexing to this ponder instance.
Everything needed is in this document plus the referenced repo files — no external context required.

## Background

A **UniswapAmplifier** is a Frankencoin minter that lets users provide liquidity to a ZCHF/USD
Uniswap v3 pool while only supplying the dollar side — the ZCHF side is minted ("borrowed") by the
amplifier. Users interact with it through **AmplifiedPosition** contracts, which are EIP-1167
minimal-proxy clones created by the amplifier (one clone per user position, factory pattern —
exactly like MintingHub `PositionOpened` → `PositionV2` in this repo).

Solidity source: `contracts/swap/UniswapAmplifier.sol` in the Frankencoin contracts repo
(both `UniswapAmplifier` and `AmplifiedPosition` live in that one file).

**Goal of this task:** index the amplifier contracts so the Frankencoin API can serve amplifier
data to the dApp's monitoring page (total borrowed ZCHF, position list, activity history).
The indexer stores **event-sourced facts only** — position existence, ownership, tick ranges,
liquidity, and borrowed amounts. It does **not** store valuations or prices: the value of a
Uniswap v3 position is a closed-form function of (liquidity, tick range, current pool price)
and is computed downstream by the API via live `slot0()` reads. **Do not index pool Swap events
and do not add any value/price columns.**

## Deployments to index

| | Ethereum Mainnet | Optimism |
|---|---|---|
| UniswapAmplifier | `0xa1304E5Aaf83CDB7c2b367F50B99Bb0647ED8C58` | `0x15CE921192ad967Eb65ea1cc508DfA21120F0d8F` |
| Start block (= deploy block) | `25795552` | `155811236` |
| Uniswap v3 pool (info only) | `0x8e4318e2cb1ae291254b187001a59a1f8ac78cef` (ZCHF/USDT) | `0xC8A2E29D58B91C37a9d8DC6ab2535EB0b42C8F4b` (ZCHF/USDC) |

Both chains are already configured in `ponder.config.ts` — only the two contract entries are new.

**Explicitly excluded:** the expired test amplifier `0x560E4889e01f41612133Af0a363dD686534c2dA7`
(mainnet). Do not index it.

## Events (exact signatures, verified against the compiled ABIs)

**`UniswapAmplifier`** (static addresses above):

| Event | Args (none indexed) | Meaning |
|---|---|---|
| `AmplifiedPositionCreated` | `address position` | A new position clone was created |
| `Borrowed` | `uint256 borrowed, uint256 totalBorrowed` | ZCHF minted into the pool; `totalBorrowed` is the amplifier-wide running total **after** the event |
| `Repaid` | `uint256 amount, uint256 totalBorrowed` | ZCHF burned on repayment; `totalBorrowed` is the running total **after** |

**`AmplifiedPosition`** (factory-discovered clones):

| Event | Args | Meaning |
|---|---|---|
| `Mint` | `uint128 liquidityAdded, uint256 token0, uint256 token1, uint256 borrowed` | Liquidity added; `borrowed` is the ZCHF borrowed **by this mint** (delta, not total) |
| `Burn` | `uint128 liquidityRemoved, uint256 token0, uint256 token1, uint256 repaid` | Liquidity removed (incl. `expiredPublicBurn` by third parties); `repaid` is the ZCHF delta |
| `OwnershipTransferred` | `address previousOwner, address newOwner` | Owner change (also fires once at initialization, from `0x0` to the creator) |

### Semantics you must get right

1. **`Borrowed`/`Repaid` do not carry the position address.** Per-position accounting comes
   exclusively from the clone's `Mint`/`Burn` events (same transaction). The amplifier-level
   events are only used to maintain/verify the aggregate `totalBorrowed` — always **set** it to
   the event's `totalBorrowed` value rather than adding deltas, so the DB can never drift.
2. **`tickLow`, `tickHigh`, and `owner` appear in no creation event.** The clone is fully
   initialized before `AmplifiedPositionCreated` fires, so read them in that handler via
   `context.client.readContract` on the clone (`tickLow()`, `tickHigh()`, `owner()`), same
   pattern as `src/MintingHubV1.ts` does for new positions.
3. **Position `liquidity` and `borrowed` are running sums** maintained from `Mint`/`Burn`
   deltas (`liquidity += liquidityAdded`, `-= liquidityRemoved`; `borrowed += borrowed`,
   `-= repaid`).
4. **Known caveat, document but do not solve:** liquidity can be donated to a position by
   minting directly on the pool with the clone as recipient; that emits no event on the clone,
   so the indexed `liquidity` can undercount the on-chain `totalLiquidity()`. The API treats
   live reads as the source of truth for liquidity; the indexed value is a registry/fallback.
   Add this as a code comment on the column.
5. **`AmplifiedPositionCreated.position` is not indexed (no topic).** Ponder's `factory()`
   helper handles non-indexed parameters — same as the existing `PositionOpened` usage.

## Implementation steps

### 1. ABIs

`@frankencoin/zchf` does **not** export the amplifier ABIs yet. Vendor them locally, e.g.
`abis/UniswapAmplifier.ts` exporting `UniswapAmplifierABI` and `AmplifiedPositionABI` as
`as const` arrays. Canonical sources to copy from:

- Compiled JSON: Frankencoin contracts repo, `abi/contracts/swap/UniswapAmplifier.sol/UniswapAmplifier.json` and `AmplifiedPosition.json`
- Already-vendored TypeScript version (can be copied nearly verbatim): frankencoin-dapp repo, `abis/UniswapAmplifier.ts`

Include the read functions used by the handlers and API: `tickLow`, `tickHigh`, `owner`,
`totalBorrowed`, `totalLiquidity`, `EXPIRATION`, `LIMIT`, `USD`, `ZCHF`, `UNISWAP_POOL`,
`ZCHF_IS_TOKEN0`, `PRICE_ANCHOR_X96`, plus the three amplifier events and three position events.
(Leave a `// TODO: migrate into @frankencoin/zchf exports` note.)

### 2. `ponder.config.ts`

- Add amplifier addresses and start blocks to the local `config` object
  (`startAmplifier: 25795552` under mainnet, `startAmplifier: 155811236` under optimism).
  The amplifier addresses are not in `ADDRESS` from `@frankencoin/zchf`, so define them here
  (or in the vendored ABI file) as constants.
- Add two contract entries, following the existing `MintingHubV2`/`PositionV2` pair as the template:

```ts
UniswapAmplifier: {
    abi: UniswapAmplifierABI,
    chain: {
        [mainnet.name]: { address: '0xa1304E5Aaf83CDB7c2b367F50B99Bb0647ED8C58', startBlock: config[mainnet.id].startAmplifier },
        [optimism.name]: { address: '0x15CE921192ad967Eb65ea1cc508DfA21120F0d8F', startBlock: config[optimism.id].startAmplifier },
    },
},
AmplifiedPosition: {
    abi: AmplifiedPositionABI,
    chain: {
        [mainnet.name]: {
            address: factory({
                address: '0xa1304E5Aaf83CDB7c2b367F50B99Bb0647ED8C58',
                event: amplifiedPositionCreatedEvent, // looked up from the ABI like openPositionEventV2
                parameter: 'position',
            }),
            startBlock: config[mainnet.id].startAmplifier,
        },
        [optimism.name]: {
            address: factory({
                address: '0x15CE921192ad967Eb65ea1cc508DfA21120F0d8F',
                event: amplifiedPositionCreatedEvent,
                parameter: 'position',
            }),
            startBlock: config[optimism.id].startAmplifier,
        },
    },
},
```

### 3. Schema — new file `schema/Amplifier.ts`, re-exported from `ponder.schema.ts`

Follow the existing conventions (`onchainTable` + `primaryKey`, `t.hex()` for addresses,
`t.bigint()` for uints/timestamps, see `schema/PriceDiscovery.ts`). All tables are multi-chain,
so `chainId` is part of every primary key.

**`AmplifierStatus`** — one row per amplifier per chain. PK: `(chainId, address)`.

| Column | Type | Source |
|---|---|---|
| `chainId` | int | event context |
| `address` | hex | amplifier address |
| `pool`, `usd`, `zchf` | hex | one-time `readContract` (immutables) |
| `zchfIsToken0` | boolean | immutable |
| `expiration`, `limit`, `priceAnchorX96` | bigint | immutables |
| `totalBorrowed` | bigint | **set** from latest `Borrowed`/`Repaid` event |
| `positionCount` | int | incremented on `AmplifiedPositionCreated` |
| `created`, `updated` | bigint | block timestamps |

Populate the immutables lazily on the first event that touches the row (upsert pattern), or in
the `AmplifiedPositionCreated` handler — whichever fits ponder's current API best. All immutables
are readable at any block after deployment.

**`AmplifierPosition`** — one row per clone. PK: `(chainId, position)`.

| Column | Type | Source |
|---|---|---|
| `chainId` | int | event context |
| `position` | hex | clone address |
| `amplifier` | hex | the emitting amplifier |
| `owner` | hex | `readContract` at creation; updated on `OwnershipTransferred` |
| `tickLow`, `tickHigh` | int | `readContract` at creation (fixed for the clone's lifetime) |
| `liquidity` | bigint | running sum of `Mint`/`Burn` deltas (see caveat #4 above — live `totalLiquidity()` is authoritative) |
| `borrowed` | bigint | running sum of `Mint.borrowed` − `Burn.repaid` |
| `created`, `updated` | bigint | block timestamps |

**`AmplifierActivity`** — flat append-only event log. PK: `(chainId, txHash, count)` where
`count` disambiguates multiple rows in one tx (use the max+1 pattern from
`src/PriceDiscovery.ts`, or `event.log.logIndex` if available in this ponder version).

| Column | Type | Source |
|---|---|---|
| `chainId`, `txHash`, `count` | — | PK |
| `amplifier`, `position` | hex | context |
| `kind` | text | `'Mint'` or `'Burn'` |
| `liquidity` | bigint | `liquidityAdded` / `liquidityRemoved` |
| `token0`, `token1` | bigint | raw token amounts from the event |
| `zchf` | bigint | `borrowed` (Mint) / `repaid` (Burn) |
| `totalBorrowed` | bigint | amplifier-wide total after this tx (from `AmplifierStatus`) |
| `sender` | hex | `event.transaction.from` (relevant for `expiredPublicBurn` by third parties) |
| `created`, `blockheight` | bigint | block info |

No history/aggregate tables in this task — daily reconstruction for charts is done downstream
from `AmplifierActivity`.

### 4. Handlers — new file `src/Amplifier.ts`

- `UniswapAmplifier:AmplifiedPositionCreated` — read `owner`/`tickLow`/`tickHigh` from the
  clone, insert `AmplifierPosition`, upsert `AmplifierStatus` (immutables + `positionCount`).
- `UniswapAmplifier:Borrowed` / `UniswapAmplifier:Repaid` — **set**
  `AmplifierStatus.totalBorrowed = event.args.totalBorrowed`, update `updated`.
- `AmplifiedPosition:Mint` / `AmplifiedPosition:Burn` — update the position's running
  `liquidity`/`borrowed`, insert an `AmplifierActivity` row. For the activity row's
  `totalBorrowed`, read it from the `AmplifierStatus` row (the amplifier's `Borrowed`/`Repaid`
  event fires in the same tx; if handler ordering within a tx makes the status row stale by one
  event, that is acceptable — note it in a comment — or derive it from the status row ± the
  delta, your choice, but document which).
- `AmplifiedPosition:OwnershipTransferred` — update `AmplifierPosition.owner`. Ignore events
  where the row does not exist yet (the initialization transfer fires before
  `AmplifiedPositionCreated` registers the clone — with factory discovery both are delivered;
  handle idempotently).
- Do **not** call `updateTransactionLog` — amplifier events are out of scope for the analytics
  tables in this task.

Error handling and style: mirror `src/MintingHubV1.ts` (parallel `readContract` calls) and
`src/PriceDiscovery.ts` (count disambiguation, try/catch around reads with `console.error`).

## Validation (do all of these)

1. `yarn typecheck` and `yarn lint` pass.
2. `yarn dev` (SQLite, needs `ALCHEMY_RPC_KEY` in `.env.local`) — let mainnet and optimism sync
   past the start blocks. Watch for factory-discovered clones being picked up.
3. Query the GraphQL API (`http://localhost:42069`) and verify:
   - `AmplifierStatus` has exactly 2 rows (chainId 1 and 10) with `limit` = 2'500'000e18
     (mainnet) / 1'000'000e18 (optimism) and `expiration` = 1806537599 — these are the known
     deployed parameters, so any other value means the wrong contract or a decoding bug.
   - `AmplifierStatus.totalBorrowed` **exactly equals** the live `totalBorrowed()` read on each
     amplifier contract (compare with `cast call` or a viem script).
   - Every `AmplifierPosition` row's `borrowed` sums (per amplifier) to ≤ the amplifier's
     `totalBorrowed`, and equals it if no liquidity was donated.
   - `AmplifierActivity` rows exist for every historical Mint/Burn (cross-check the count
     against the events on Etherscan/OP-Etherscan for the amplifier's clones).
4. Restart `yarn dev` once to confirm the sync is deterministic (no PK conflicts on re-index).

## Housekeeping

- Add the new tables and contracts to `INDEXER_SUMMARY.md` (new "Amplifier" domain section,
  start blocks section).
- Bump the package version (`package.json`, currently `@frankencoin/ponder` 0.3.x) per repo habit.

## Out of scope (do not build)

- REST API endpoints (`/amplifier/...`) — separate task in the `@frankencoin/api` backend.
- Any valuation, pool-price, or Swap-event indexing.
- The test amplifier, `CurveAmplifier`, and `FrankencoinTestMinter` contracts.
- dApp changes.
