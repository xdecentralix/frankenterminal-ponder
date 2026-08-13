# Frankencoin Ponder Indexer

Blockchain indexer for the Frankencoin (ZCHF) ecosystem. Indexes Ethereum mainnet + 7 L2s and exposes data via GraphQL.

- Production: **ponder.frankencoin.com**
- Test: **ponder.test.frankencoin.com**

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
