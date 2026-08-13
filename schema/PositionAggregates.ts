import { onchainTable, primaryKey } from 'ponder';

export const PositionAggregatesV1 = onchainTable(
  'PositionAggregatesV1',
  (t) => ({
    chainId: t.integer().notNull(),
    totalMinted: t.bigint().notNull(),
    annualInterests: t.bigint().notNull(),
    updated: t.bigint().notNull(),
  }),
  (table) => ({
    pk: primaryKey({ columns: [table.chainId] }),
  })
);

export const PositionAggregatesV2 = onchainTable(
  'PositionAggregatesV2',
  (t) => ({
    chainId: t.integer().notNull(),
    totalMinted: t.bigint().notNull(),
    annualInterests: t.bigint().notNull(),
    updated: t.bigint().notNull(),
  }),
  (table) => ({
    pk: primaryKey({ columns: [table.chainId] }),
  })
);

// Flat history — one row per block per chain, updated if multiple events hit the same block
export const PositionAggregatesV1History = onchainTable(
  'PositionAggregatesV1History',
  (t) => ({
    chainId: t.integer().notNull(),
    updated: t.bigint().notNull(),
    totalMinted: t.bigint().notNull(),
    annualInterests: t.bigint().notNull(),
  }),
  (table) => ({
    pk: primaryKey({ columns: [table.chainId, table.updated] }),
  })
);

export const PositionAggregatesV2History = onchainTable(
  'PositionAggregatesV2History',
  (t) => ({
    chainId: t.integer().notNull(),
    updated: t.bigint().notNull(),
    totalMinted: t.bigint().notNull(),
    annualInterests: t.bigint().notNull(),
  }),
  (table) => ({
    pk: primaryKey({ columns: [table.chainId, table.updated] }),
  })
);
