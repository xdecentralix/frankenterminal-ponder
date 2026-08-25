# Frankencoin Ponder Indexer

Blockchain indexer for the Frankencoin (ZCHF) ecosystem. Indexes Ethereum mainnet + 7 L2s and exposes data via GraphQL.

This repository is a fork of [Frankencoin-ZCHF/ponder](https://github.com/Frankencoin-ZCHF/ponder). Indexer schema and handlers stay in lockstep with upstream so `frankenterminal-api` and `frankenterminal-dapp` keep working. Canonical Frankencoin deployments:

- Production: **ponder.frankencoin.com**
- Test: **ponder.test.frankencoin.com**

## Following upstream

```bash
git remote add upstream https://github.com/Frankencoin-ZCHF/ponder.git   # once
git fetch upstream
git merge upstream/main
```

Keep upstream for schema, handlers, ABIs, and the `ponder` package version. Do **not** independently bump `ponder` — wait for Frankencoin and merge, otherwise future syncs fight `yarn.lock`.

The only intentional fork overlay is `railway.json` (`ponder start --schema frankenterminal_v2`). Ponder 0.17 will not reuse a schema written by 0.15; the new name keeps the old index as a rollback target. If a merge touches `railway.json`, keep this start command.

GraphQL schema changes must land in the API (and dapp) in the same cycle. Handler-only fixes (insert vs update) do not.

## Setup

```bash
cp .env.example .env.local
yarn install
yarn dev
```

**.env.local** — required fields:

```env
ALCHEMY_RPC_KEY=your_key_here

# Optional: Postgres (omit to use SQLite)
DATABASE_URL=postgres://...

# Optional: analytics tables (disabled by default)
ENABLE_TRANSACTION_LOG=false
```

## Commands

```bash
yarn dev          # development (live reload, no UI)
yarn dev:ui       # development with Ponder UI
yarn start        # production
yarn codegen      # regenerate types after schema changes
yarn typecheck    # TypeScript check
```

## Docs

See [CLAUDE.md](./CLAUDE.md) for architecture and development guidance.  
See [INDEXER_SUMMARY.md](./INDEXER_SUMMARY.md) for full schema and table reference.
