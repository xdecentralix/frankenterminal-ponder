import { ADDRESS } from '@frankencoin/zchf';
import { ponder } from 'ponder:registry';
import { CommonEcosystem, FrankencoinMinter, FrankencoinProfitLoss } from 'ponder:schema';
import { erc20Abi, parseEther } from 'viem';
import { mainnet } from 'viem/chains';
import { updateTransactionLog } from './lib/TransactionLog';
import { normalizeAddress } from './utils/format';

/*
Events

Frankencoin:Profit
Frankencoin:Loss
Frankencoin:MinterApplied
Frankencoin:MinterDenied
*/

/*
@dev
Ponder doesn’t allow context.client.readContract to switch chains dynamically, because context.client is tied to the chain of the event source.
To perform a contract read on a different chain, you need to create a separate public client in your event handler or in a utility file using viem's createPublicClient.
*/

ponder.on('Frankencoin:Profit', async ({ event, context }) => {
	const minter = normalizeAddress(event.args.reportingMinter);
	const isMainnet = context.chain.id === mainnet.id;

	// upsert all independent counters + optional fpsTotalSupply read in parallel
	const [counter, , profits, losses, fpsTotalSupply] = await Promise.all([
		// upsert ProfitLossCounter
		context.db
			.insert(CommonEcosystem)
			.values({ id: 'Equity:ProfitLossCounter', value: '', amount: 1n })
			.onConflictDoUpdate((current) => ({ amount: current.amount + 1n })),
		// upsert ProfitCounter
		context.db
			.insert(CommonEcosystem)
			.values({ id: 'Equity:ProfitCounter', value: '', amount: 1n })
			.onConflictDoUpdate((current) => ({ amount: current.amount + 1n })),
		// upsert Profits
		context.db
			.insert(CommonEcosystem)
			.values({ id: 'Equity:Profits', value: '', amount: event.args.amount })
			.onConflictDoUpdate((current) => ({ amount: current.amount + event.args.amount })),
		// upsert Losses
		context.db
			.insert(CommonEcosystem)
			.values({ id: 'Equity:Losses', value: '', amount: 0n })
			.onConflictDoUpdate((current) => ({ amount: current.amount + 0n })),
		// read fpsTotalSupply if on mainnet
		isMainnet
			? context.client.readContract({ abi: erc20Abi, address: ADDRESS[mainnet.id].equity, functionName: 'totalSupply' })
			: Promise.resolve(0n),
	]);

	let earningsPerFPS = { amount: 0n };
	if (isMainnet) {
		const perToken = fpsTotalSupply > 0n ? (event.args.amount * parseEther('1')) / fpsTotalSupply : 0n;
		earningsPerFPS.amount = perToken;

		// upsert EarningsPerFPS
		await context.db
			.insert(CommonEcosystem)
			.values({ id: 'Equity:EarningsPerFPS', value: '', amount: perToken })
			.onConflictDoUpdate((current) => ({ amount: current.amount + perToken }));
	}

	// flat indexing earnings
	await context.db.insert(FrankencoinProfitLoss).values({
		chainId: context.chain.id,
		count: counter.amount,
		created: event.block.timestamp,
		kind: 'Profit',
		amount: event.args.amount,
		minter: minter,
		profits: profits.amount,
		losses: losses.amount,
		perFPS: earningsPerFPS.amount,
	});

	// update analytics
	await updateTransactionLog({
		client: context.client,
		db: context.db,
		chainId: context.chain.id,
		blockNumber: event.block.number,
		timestamp: event.block.timestamp,
		kind: 'Equity:Profit',
		amount: event.args.amount,
		txHash: event.transaction.hash,
	});
});

ponder.on('Frankencoin:Loss', async ({ event, context }) => {
	const minter = normalizeAddress(event.args.reportingMinter);
	const isMainnet = context.chain.id === mainnet.id;

	// upsert all independent counters + optional fpsTotalSupply read in parallel
	const [counter, , profits, losses, fpsTotalSupply] = await Promise.all([
		// upsert ProfitLossCounter
		context.db
			.insert(CommonEcosystem)
			.values({ id: 'Equity:ProfitLossCounter', value: '', amount: 1n })
			.onConflictDoUpdate((current) => ({ amount: current.amount + 1n })),
		// upsert LossCounter
		context.db
			.insert(CommonEcosystem)
			.values({ id: 'Equity:LossCounter', value: '', amount: 1n })
			.onConflictDoUpdate((current) => ({ amount: current.amount + 1n })),
		// upsert Profits
		context.db
			.insert(CommonEcosystem)
			.values({ id: 'Equity:Profits', value: '', amount: 0n })
			.onConflictDoUpdate((current) => ({ amount: current.amount + 0n })),
		// upsert Losses
		context.db
			.insert(CommonEcosystem)
			.values({ id: 'Equity:Losses', value: '', amount: event.args.amount })
			.onConflictDoUpdate((current) => ({ amount: current.amount + event.args.amount })),
		// read fpsTotalSupply if on mainnet
		isMainnet
			? context.client.readContract({ abi: erc20Abi, address: ADDRESS[mainnet.id].equity, functionName: 'totalSupply' })
			: Promise.resolve(0n),
	]);

	let earningsPerFPS = { amount: 0n };
	if (isMainnet) {
		const perToken = fpsTotalSupply > 0n ? -(event.args.amount * parseEther('1')) / fpsTotalSupply : 0n;
		earningsPerFPS.amount = perToken;

		// upsert EarningsPerFPS
		await context.db
			.insert(CommonEcosystem)
			.values({ id: 'Equity:EarningsPerFPS', value: '', amount: perToken })
			.onConflictDoUpdate((current) => ({ amount: current.amount + perToken }));
	}

	// flat indexing earnings
	await context.db.insert(FrankencoinProfitLoss).values({
		chainId: context.chain.id,
		count: counter.amount,
		created: event.block.timestamp,
		kind: 'Loss',
		amount: event.args.amount,
		minter: minter,
		profits: profits.amount,
		losses: losses.amount,
		perFPS: earningsPerFPS.amount,
	});

	// update analytics
	await updateTransactionLog({
		client: context.client,
		db: context.db,
		chainId: context.chain.id,
		blockNumber: event.block.number,
		timestamp: event.block.timestamp,
		kind: 'Equity:Loss',
		amount: event.args.amount,
		txHash: event.transaction.hash,
	});
});

ponder.on('Frankencoin:MinterApplied', async ({ event, context }) => {
	const minter = normalizeAddress(event.args.minter);

	// upsert status
	await context.db
		.insert(CommonEcosystem)
		.values({
			id: 'Frankencoin:MinterAppliedCounter',
			value: '',
			amount: 1n,
		})
		.onConflictDoUpdate((current) => ({
			amount: current.amount + 1n,
		}));

	// upsert minter mapping
	await context.db
		.insert(FrankencoinMinter)
		.values({
			chainId: context.chain.id,
			txHash: event.transaction.hash,
			minter: minter,
			applicationPeriod: event.args.applicationPeriod,
			applicationFee: event.args.applicationFee,
			applyMessage: event.args.message,
			applyDate: event.block.timestamp,
			suggestor: event.transaction.from,
		})
		.onConflictDoUpdate((current) => ({
			txHash: event.transaction.hash,
			applicationPeriod: event.args.applicationPeriod,
			applicationFee: event.args.applicationFee,
			applyMessage: event.args.message,
			applyDate: event.block.timestamp,
			suggestor: event.transaction.from,
			denyDate: undefined,
			denyMessage: undefined,
			denyTxHash: undefined,
			vetor: undefined,
		}));
});

ponder.on('Frankencoin:MinterDenied', async ({ event, context }) => {
	const minter = normalizeAddress(event.args.minter);

	// upsert status
	await context.db
		.insert(CommonEcosystem)
		.values({
			id: 'Frankencoin:MinterDeniedCounter',
			value: '',
			amount: 1n,
		})
		.onConflictDoUpdate((current) => ({
			amount: current.amount + 1n,
		}));

	// upsert minter mapping
	await context.db.update(FrankencoinMinter, { chainId: context.chain.id, minter }).set((current) => ({
		denyMessage: event.args.message,
		denyDate: event.block.timestamp,
		denyTxHash: event.transaction.hash,
		vetor: event.transaction.from,
	}));
});
