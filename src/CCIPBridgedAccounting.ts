import { ponder } from 'ponder:registry';
import { CommonEcosystem, FrankencoinProfitLoss, BridgedAccountingReceivedSettlement } from 'ponder:schema';
import { updateTransactionLog } from './lib/TransactionLog';
import { normalizeAddress } from './utils/format';

/*
Events to correct accounting. P/L events emitted on sidechain and on sync, needs to be deducted once

CCIPBridgedAccounting:ReceivedProfits
CCIPBridgedAccounting:ReceivedLosses
CCIPBridgedAccounting:ReceivedSettlement

Note on EarningsPerFPS: the sidechain Profit/Loss event does not touch EarningsPerFPS (only mainnet
events do), while the mainnet re-emission on sync already added the per-token delta. So only the
Profits/Losses totals need to be deducted here; EarningsPerFPS must stay untouched and the flat
FrankencoinProfitLoss row records a per-event delta of 0 (perFPS is a delta on every row).
*/

ponder.on('CCIPBridgedAccounting:ReceivedProfits', async ({ event, context }) => {
	const minter = normalizeAddress(event.log.address); // CCIPBridgedAccounting

	// upsert ProfitLossCounter
	const counter = await context.db
		.insert(CommonEcosystem)
		.values({
			id: 'Equity:ProfitLossCounter',
			value: '',
			amount: 1n,
		})
		.onConflictDoUpdate((current) => ({
			amount: current.amount + 1n,
		}));

	// upsert ReceivedProfitsCounter
	await context.db
		.insert(CommonEcosystem)
		.values({
			id: 'Equity:ReceivedProfitsCounter',
			value: '',
			amount: 1n,
		})
		.onConflictDoUpdate((current) => ({
			amount: current.amount + 1n,
		}));

	// upsert Profits
	const profits = await context.db.update(CommonEcosystem, { id: 'Equity:Profits' }).set((current) => ({
		amount: current.amount - event.args.amount, // deduct
	}));

	// upsert Losses
	const losses = await context.db.update(CommonEcosystem, { id: 'Equity:Losses' }).set((current) => ({
		amount: current.amount + 0n, // neutral
	}));

	// EarningsPerFPS: neutral, already accounted for by the mainnet Profit event (see note above)

	// flat indexing earnings
	await context.db.insert(FrankencoinProfitLoss).values({
		chainId: context.chain.id,
		count: counter.amount,
		created: event.block.timestamp,
		kind: 'ReceivedProfits',
		amount: event.args.amount,
		minter: minter,
		profits: profits.amount,
		losses: losses.amount,
		perFPS: 0n,
	});

	// update analytics
	await updateTransactionLog({
		client: context.client,
		db: context.db,
		chainId: context.chain.id,
		blockNumber: event.block.number,
		timestamp: event.block.timestamp,
		kind: 'BridgedAccounting:ReceivedProfits',
		amount: event.args.amount,
		txHash: event.transaction.hash,
	});
});

ponder.on('CCIPBridgedAccounting:ReceivedLosses', async ({ event, context }) => {
	const amount = event.args.losses;
	const minter = normalizeAddress(event.log.address); // CCIPBridgedAccounting

	// upsert ProfitLossCounter
	const counter = await context.db
		.insert(CommonEcosystem)
		.values({
			id: 'Equity:ProfitLossCounter',
			value: '',
			amount: 1n,
		})
		.onConflictDoUpdate((current) => ({
			amount: current.amount + 1n,
		}));

	// upsert ReceivedLossesCounter
	await context.db
		.insert(CommonEcosystem)
		.values({
			id: 'Equity:ReceivedLossesCounter',
			value: '',
			amount: 1n,
		})
		.onConflictDoUpdate((current) => ({
			amount: current.amount + 1n,
		}));

	// upsert Profits
	const profits = await context.db.update(CommonEcosystem, { id: 'Equity:Profits' }).set((current) => ({
		amount: current.amount + 0n, // neutral
	}));

	// upsert Losses
	const losses = await context.db.update(CommonEcosystem, { id: 'Equity:Losses' }).set((current) => ({
		amount: current.amount - amount, // deduct
	}));

	// EarningsPerFPS: neutral, already accounted for by the mainnet Loss event (see note above)

	// flat indexing earnings
	await context.db.insert(FrankencoinProfitLoss).values({
		chainId: context.chain.id,
		count: counter.amount,
		created: event.block.timestamp,
		kind: 'ReceivedLosses',
		amount: amount,
		minter: minter,
		profits: profits.amount,
		losses: losses.amount,
		perFPS: 0n,
	});

	// update analytics
	await updateTransactionLog({
		client: context.client,
		db: context.db,
		chainId: context.chain.id,
		blockNumber: event.block.number,
		timestamp: event.block.timestamp,
		kind: 'BridgedAccounting:ReceivedLosses',
		amount: amount,
		txHash: event.transaction.hash,
	});
});

ponder.on('CCIPBridgedAccounting:ReceivedSettlement', async ({ event, context }) => {
	const { chain, sender, losses, profits } = event.args;
	const created = event.block.timestamp;

	// upsert ReceivedSettlementCounter
	const counter = await context.db
		.insert(CommonEcosystem)
		.values({
			id: 'Equity:ReceivedSettlementCounter',
			value: '',
			amount: 1n,
		})
		.onConflictDoUpdate((current) => ({
			amount: current.amount + 1n,
		}));

	// upsert ReceivedProfits
	await context.db
		.insert(CommonEcosystem)
		.values({
			id: 'Equity:ReceivedProfits',
			value: '',
			amount: profits,
		})
		.onConflictDoUpdate((current) => ({
			amount: current.amount + profits,
		}));

	// upsert ReceivedLosses
	await context.db
		.insert(CommonEcosystem)
		.values({
			id: 'Equity:ReceivedLosses',
			value: '',
			amount: losses,
		})
		.onConflictDoUpdate((current) => ({
			amount: current.amount + losses,
		}));

	// flat indexing earnings
	await context.db.insert(BridgedAccountingReceivedSettlement).values({
		chain,
		sender,
		created,
		count: counter.amount,
		kind: 'ReceivedSettlement',
		profits,
		losses,
	});
});
