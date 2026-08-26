import { onchainTable, primaryKey } from 'ponder';

// MinterGovernance is deployed on all 8 chains (mainnet + 7 L2s).

export const MinterGovernanceMinterAnnounced = onchainTable(
	'MinterGovernanceMinterAnnounced',
	(t) => ({
		chainId: t.integer().notNull(),
		who: t.hex().notNull(),
		minter: t.hex().notNull(),
		timestamp: t.bigint().notNull(),
		count: t.bigint().notNull(),
		created: t.bigint().notNull(),
		txHash: t.hex().notNull(),
	}),
	(table) => ({
		pk: primaryKey({ columns: [table.chainId, table.minter, table.count] }),
	})
);

export const MinterGovernanceRewarded = onchainTable(
	'MinterGovernanceRewarded',
	(t) => ({
		chainId: t.integer().notNull(),
		caller: t.hex().notNull(),
		amount: t.bigint().notNull(),
		token: t.hex().notNull(),
		count: t.bigint().notNull(),
		created: t.bigint().notNull(),
		txHash: t.hex().notNull(),
	}),
	(table) => ({
		pk: primaryKey({ columns: [table.chainId, table.caller, table.count] }),
	})
);
