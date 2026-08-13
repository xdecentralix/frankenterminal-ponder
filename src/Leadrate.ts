import { ponder } from 'ponder:registry';
import { SavingsStatus, LeadrateRateChanged, LeadRateProposed } from 'ponder:schema';
import { normalizeAddress } from './utils/format';

/*
Events

Leadrate:RateChanged
Leadrate:RateProposed
*/

ponder.on('Leadrate:RateChanged', async ({ event, context }) => {
	const { newRate } = event.args;
	const updated = event.block.timestamp;
	const chainId = context.chain.id;
	const module = normalizeAddress(event.log.address);

	// update status
	const status = await context.db
		.insert(SavingsStatus)
		.values({
			chainId,
			module,
			updated,
			save: 0n,
			withdraw: 0n,
			interest: 0n,
			balance: 0n,
			rate: newRate,
			counterSave: 0n,
			counterWithdraw: 0n,
			counterInterest: 0n,
			counterRateProposed: 0n,
			counterRateChanged: 1n,
		})
		.onConflictDoUpdate((current) => ({
			updated,
			rate: newRate,
			counterRateChanged: current.counterRateChanged + 1n, // count
		}));

	// flat indexing
	await context.db.insert(LeadrateRateChanged).values({
		chainId,
		created: updated,
		blockheight: event.block.number,
		count: status.counterRateChanged,
		module,
		txHash: event.transaction.hash,
		approvedRate: newRate,
	});
});

ponder.on('Leadrate:RateProposed', async ({ event, context }) => {
	const { who, nextChange, nextRate } = event.args;

	const updated = event.block.timestamp;
	const chainId = context.chain.id;
	const module = normalizeAddress(event.log.address);
	const proposer = normalizeAddress(who);

	// update status
	const status = await context.db.update(SavingsStatus, { chainId, module }).set((current) => ({
		updated,
		counterRateProposed: current.counterRateProposed + 1n,
	}));

	// flat indexing
	await context.db.insert(LeadRateProposed).values({
		chainId,
		created: updated,
		blockheight: event.block.number,
		count: status.counterRateChanged,
		module,
		txHash: event.transaction.hash,
		proposer,
		nextRate,
		nextChange,
	});
});
