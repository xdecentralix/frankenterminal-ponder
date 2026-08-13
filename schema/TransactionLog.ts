import { onchainTable, primaryKey } from 'ponder';

export const AnalyticTransactionLog = onchainTable(
	'AnalyticTransactionLog',
	(t) => ({
		chainId: t.integer().notNull(),
		count: t.bigint().notNull(),
		timestamp: t.bigint().notNull(),
		kind: t.text().notNull(),
		amount: t.bigint().notNull(),
		txHash: t.hex().notNull(),

		totalInflow: t.bigint().notNull(),
		totalOutflow: t.bigint().notNull(),

		totalEquity: t.bigint().notNull(),
		totalSavings: t.bigint().notNull(),

		fpsTotalSupply: t.bigint().notNull(),
		fpsPrice: t.bigint().notNull(), // smart contract price

		realizedNetEarnings: t.bigint().notNull(),

		// @dev: E = ∑ (delta_earnings_n / totalSupplyFPS_n, n = 0, ...) = ( d0 / t0 ) + ( d1 / t1 ) ... + ( dn / tn )
		// if (dn > 0) then 'profit' aka '+' else 'loss' aka '-'
		earningsPerFPS: t.bigint().notNull(),
	}),
	(table) => ({
		pk: primaryKey({
			columns: [table.chainId, table.timestamp, table.kind, table.count],
		}),
	})
);

export const AnalyticDailyLog = onchainTable(
	'AnalyticDailyLog',
	(t) => ({
		date: t.text().notNull(),
		timestamp: t.bigint().notNull(),
		txHash: t.hex().notNull(),

		totalInflow: t.bigint().notNull(),
		totalOutflow: t.bigint().notNull(),

		totalEquity: t.bigint().notNull(),
		totalSavings: t.bigint().notNull(),

		fpsTotalSupply: t.bigint().notNull(),
		fpsPrice: t.bigint().notNull(), // smart contract price

		realizedNetEarnings: t.bigint().notNull(),
		earningsPerFPS: t.bigint().notNull(),
	}),
	(table) => ({
		pk: primaryKey({
			columns: [table.date],
		}),
	})
);
