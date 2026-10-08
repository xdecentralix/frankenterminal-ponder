import { onchainTable, primaryKey } from 'ponder';

// Daily equity revenue from successful challenges and forced sales of expired positions.
// - excessProfit:    reserve share of the surplus, sent to Equity via collectProfits (challenge only)
// - reserveReleased: position reserve released into equity via burnWithoutReserve (accounting, no transfer)
// - lossCovered:     shortfall paid by Equity via coverLoss
// net revenue = excessProfit + reserveReleased - lossCovered
export const MintingRevenueDaily = onchainTable(
	'MintingRevenueDaily',
	(t) => ({
		chainId: t.integer().notNull(),
		date: t.text().notNull(),
		hub: t.text().notNull(), // 'V1' | 'V2'
		kind: t.text().notNull(), // 'Challenge' | 'ForcedSale'
		timestamp: t.bigint().notNull(),
		excessProfit: t.bigint().notNull(),
		reserveReleased: t.bigint().notNull(),
		lossCovered: t.bigint().notNull(),
		count: t.bigint().notNull(),
	}),
	(table) => ({
		pk: primaryKey({ columns: [table.chainId, table.date, table.hub, table.kind] }),
	})
);
