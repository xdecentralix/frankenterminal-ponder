import { ponder } from 'ponder:registry';
import { CommonEcosystem, FCSDeposit, FCSFeeDaily, FCSShot, FCSTradeChart, FCSUnwrapped, FCSWithdraw, FCSWrapped } from 'ponder:schema';
import { normalizeAddress } from './utils/format';
import { addr } from '../ponder.config';
import { mainnet } from 'viem/chains';
import { getAbiItem, toEventSelector, parseEventLogs, erc20Abi } from 'viem';
import { FCSABI } from '@frankencoin/zchf';

const ONE_DAY_SECONDS = 86400n;
const WITHDRAW_TOPIC = toEventSelector(getAbiItem({ abi: FCSABI, name: 'Withdraw' }));

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

	// Fee: ZCHF Transfer(FCS -> Equity) emitted before this Withdraw. Bounded by the previous FCS Withdraw
	// log so batched withdrawals in one tx are not double counted.
	const { logs } = await context.client.getTransactionReceipt({ hash: event.transaction.hash });
	const fcs = normalizeAddress(addr[mainnet.id].fcs);
	const zchf = normalizeAddress(addr[mainnet.id].frankencoin);
	const equity = normalizeAddress(addr[mainnet.id].equity);
	const prevWithdraw = logs
		.filter((l) => normalizeAddress(l.address) === fcs && l.topics[0] === WITHDRAW_TOPIC && l.logIndex < event.log.logIndex)
		.reduce((max, l) => Math.max(max, l.logIndex), -1);

	const transfers = parseEventLogs({
		abi: erc20Abi,
		eventName: 'Transfer',
		logs: logs.filter(
			(l) =>
				normalizeAddress(l.address) === zchf &&
				l.logIndex > prevWithdraw &&
				l.logIndex < event.log.logIndex
		),
	});

	const fee = transfers
		.filter((t) => normalizeAddress(t.args.from) === fcs && normalizeAddress(t.args.to) === equity)
		.reduce((sum, t) => sum + t.args.value, 0n);

	if (fee > 0n) {
		const day = time - (time % ONE_DAY_SECONDS);
		const date = new Date(Number(day) * 1000).toISOString().split('T')[0]!;
		await context.db
			.insert(FCSFeeDaily)
			.values({ date, timestamp: day, amount: fee, count: 1n })
			.onConflictDoUpdate((current) => ({ amount: current.amount + fee, count: current.count + 1n }));
	}
});
