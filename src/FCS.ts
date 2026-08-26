import { ponder } from 'ponder:registry';
import { CommonEcosystem, FCSDeposit, FCSShot, FCSTradeChart, FCSUnwrapped, FCSWithdraw, FCSWrapped } from 'ponder:schema';
import { normalizeAddress } from './utils/format';

/*
Events

FCS:Wrapped
FCS:Unwrapped
FCS:Shot
FCS:Deposit
FCS:Withdraw

Deliberately deferred (no handler, no table) — FCS:MutualDestruction and FCS:VotesCapped are
AccumulatingVotesToken internals with no clear downstream analytics/product consumer yet, unlike
Shot (the headline "punish an FPS1 holder who didn't wrap" mechanic). Both events remain in the
compiled ABI (src/abis/fcs/FCS.json) so a future handler can be added without an ABI change.
*/

ponder.on('FCS:Wrapped', async ({ event, context }) => {
	const who = normalizeAddress(event.args.who);

	const counter = await context.db
		.insert(CommonEcosystem)
		.values({ id: 'FCS:WrappedCounter', value: '', amount: 1n })
		.onConflictDoUpdate((current) => ({ amount: current.amount + 1n }));

	await context.db.insert(FCSWrapped).values({
		who,
		amount: event.args.amount,
		count: counter.amount,
		created: event.block.timestamp,
		txHash: event.transaction.hash,
	});
});

ponder.on('FCS:Unwrapped', async ({ event, context }) => {
	const who = normalizeAddress(event.args.who);

	const counter = await context.db
		.insert(CommonEcosystem)
		.values({ id: 'FCS:UnwrappedCounter', value: '', amount: 1n })
		.onConflictDoUpdate((current) => ({ amount: current.amount + 1n }));

	await context.db.insert(FCSUnwrapped).values({
		who,
		amount: event.args.amount,
		count: counter.amount,
		created: event.block.timestamp,
		txHash: event.transaction.hash,
	});
});

ponder.on('FCS:Shot', async ({ event, context }) => {
	const target = normalizeAddress(event.args.target);

	const counter = await context.db
		.insert(CommonEcosystem)
		.values({ id: 'FCS:ShotCounter', value: '', amount: 1n })
		.onConflictDoUpdate((current) => ({ amount: current.amount + 1n }));

	await context.db.insert(FCSShot).values({
		target,
		votesDestroyed: event.args.votesDestroyed,
		count: counter.amount,
		created: event.block.timestamp,
		txHash: event.transaction.hash,
	});
});

ponder.on('FCS:Deposit', async ({ event, context }) => {
	const sender = normalizeAddress(event.args.sender);
	const owner = normalizeAddress(event.args.owner);
	const { assets, shares } = event.args;
	const time = event.block.timestamp;

	const counter = await context.db
		.insert(CommonEcosystem)
		.values({ id: 'FCS:DepositCounter', value: '', amount: 1n })
		.onConflictDoUpdate((current) => ({ amount: current.amount + 1n }));

	await context.db.insert(FCSDeposit).values({
		sender,
		owner,
		assets,
		shares,
		count: counter.amount,
		created: time,
		txHash: event.transaction.hash,
	});

	if (shares > 0n) {
		const lastPrice = (assets * 10n ** 18n) / shares;
		await context.db
			.insert(FCSTradeChart)
			.values({ timestamp: time, lastPrice })
			.onConflictDoUpdate(() => ({ lastPrice }));
	}
});

ponder.on('FCS:Withdraw', async ({ event, context }) => {
	const sender = normalizeAddress(event.args.sender);
	const receiver = normalizeAddress(event.args.receiver);
	const owner = normalizeAddress(event.args.owner);
	const { assets, shares } = event.args;
	const time = event.block.timestamp;

	const counter = await context.db
		.insert(CommonEcosystem)
		.values({ id: 'FCS:WithdrawCounter', value: '', amount: 1n })
		.onConflictDoUpdate((current) => ({ amount: current.amount + 1n }));

	await context.db.insert(FCSWithdraw).values({
		sender,
		receiver,
		owner,
		assets,
		shares,
		count: counter.amount,
		created: time,
		txHash: event.transaction.hash,
	});

	if (shares > 0n) {
		const lastPrice = (assets * 10n ** 18n) / shares;
		await context.db
			.insert(FCSTradeChart)
			.values({ timestamp: time, lastPrice })
			.onConflictDoUpdate(() => ({ lastPrice }));
	}
});
