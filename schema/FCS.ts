import { onchainTable, primaryKey } from 'ponder';

// FCS is mainnet-only (like Equity), so no chainId column below.

export const FCSWrapped = onchainTable(
	'FCSWrapped',
	(t) => ({
		who: t.hex().notNull(),
		amount: t.bigint().notNull(),
		count: t.bigint().notNull(),
		created: t.bigint().notNull(),
		txHash: t.hex().notNull(),
	}),
	(table) => ({
		pk: primaryKey({ columns: [table.who, table.created, table.count] }),
	})
);

export const FCSUnwrapped = onchainTable(
	'FCSUnwrapped',
	(t) => ({
		who: t.hex().notNull(),
		amount: t.bigint().notNull(),
		count: t.bigint().notNull(),
		created: t.bigint().notNull(),
		txHash: t.hex().notNull(),
	}),
	(table) => ({
		pk: primaryKey({ columns: [table.who, table.created, table.count] }),
	})
);

export const FCSDeposit = onchainTable(
	'FCSDeposit',
	(t) => ({
		sender: t.hex().notNull(),
		owner: t.hex().notNull(),
		assets: t.bigint().notNull(),
		shares: t.bigint().notNull(),
		count: t.bigint().notNull(),
		created: t.bigint().notNull(),
		txHash: t.hex().notNull(),
	}),
	(table) => ({
		pk: primaryKey({ columns: [table.owner, table.created, table.count] }),
	})
);

export const FCSWithdraw = onchainTable(
	'FCSWithdraw',
	(t) => ({
		sender: t.hex().notNull(),
		receiver: t.hex().notNull(),
		owner: t.hex().notNull(),
		assets: t.bigint().notNull(),
		shares: t.bigint().notNull(),
		count: t.bigint().notNull(),
		created: t.bigint().notNull(),
		txHash: t.hex().notNull(),
	}),
	(table) => ({
		pk: primaryKey({ columns: [table.owner, table.created, table.count] }),
	})
);

// lastPrice derived as (assets * 1e18) / shares from Deposit/Withdraw events (skipped when shares === 0n).
// Not derived from Wrapped/Unwrapped, which are a strict 1:1 FPS1<->FCS swap with no ZCHF price signal.
// TODO: sanity-check this series against EquityTradeChart once real deployment data exists — FCS price
// should track FPS1's price closely since deposit buys FPS1 at its current price.
export const FCSTradeChart = onchainTable(
	'FCSTradeChart',
	(t) => ({
		timestamp: t.bigint().notNull(),
		lastPrice: t.bigint().notNull(),
	}),
	(table) => ({
		pk: primaryKey({ columns: [table.timestamp] }),
	})
);

export const FCSShot = onchainTable(
	'FCSShot',
	(t) => ({
		target: t.hex().notNull(),
		votesDestroyed: t.bigint().notNull(),
		count: t.bigint().notNull(),
		created: t.bigint().notNull(),
		txHash: t.hex().notNull(),
	}),
	(table) => ({
		pk: primaryKey({ columns: [table.target, table.created, table.count] }),
	})
);
