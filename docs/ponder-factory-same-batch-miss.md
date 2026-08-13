# Ponder Factory Child Address — Same-Batch Event Miss

## The Bug

When a factory child contract (e.g. a new V1/V2 position) is **opened and interacted with within the same `ethGetLogsBlockRange` window**, Ponder misses all child contract events from that window during a full re-index.

**Observed:** Position `0xf35378277191c1f0d90869426f7177aa0393f77d` was opened at block 25287288 and denied at block 25287602 (314 blocks apart). After a full re-index, `denied: false` — the `PositionDenied` event was never delivered to the handler.

Both events fall in batch window `[25286536–25291535]` (`ethGetLogsBlockRange = 5000`).

This affects **any** event from a newly-discovered position that fires within the same batch window as `PositionOpened`:
- `MintingUpdate` (mint, price change shortly after opening)
- `PositionDenied`
- `OwnershipTransferred`

Live indexing is **not affected** — only cold full re-indexes.

## Where in Ponder

**File:** `node_modules/ponder/dist/esm/sync-historical/index.js`

**Function:** `syncBlockRangeData` (~line 242)

The function receives two pre-computed lists:
- `requiredFactoryIntervals` — block ranges to scan for factory events (discovers new child addresses)
- `requiredIntervals` — block ranges to fetch child contract events for

Within each call, the factory scan runs first (updates `args.childAddresses`), then the child event fetch uses those updated addresses. **In theory this should work.** The bug likely surfaces from how these interval lists interact with the `cachedIntervals` tracking — once a block range is marked cached for the child contract filter, it is not re-fetched even if new child addresses were discovered within it.

**Relevant functions:**
- `getRequiredIntervalsWithFilters` in `dist/esm/runtime/index.js` (~line 194) — builds the interval lists; has logic to invalidate child filter cache when factory blocks are missing, but may not cover same-batch discovery
- `syncAddressFactory` in `dist/esm/sync-historical/index.js` (~line 183) — collects child addresses for an interval and mutates `args.childAddresses`

**Possible SQLite difference:** The runtime forks between `pglite` and Postgres in `dist/esm/runtime/omnichain.js` (~line 443). Running without `DATABASE_URL` (SQLite/PGlite) may behave differently — worth testing a full re-index without `DATABASE_URL` set.

## Current Mitigation

In `MintingHubV1:PositionOpened` and `MintingHubV2:PositionOpened`, `denied` is derived from the historical `cooldown` value read at the event block:
- V1: `denied = cooldown === maxUint256` (V1 `deny()` sets `cooldown = type(uint256).max`)
- V2: `denied = BigInt(cooldown) === 2n**40n - 1n` (V2 uses `uint40`)

This only catches denial **in the same block** as opening. It does not fix missed `MintingUpdate` or denial events from later blocks within the same batch window.

## Ponder Version

`0.16.6` — changelog notes factory fixes in 0.15.0 and 0.15.12 but none specifically address same-batch child events.
