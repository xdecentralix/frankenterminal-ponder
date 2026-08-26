import { ponder } from 'ponder:registry';
import { CommonEcosystem, MinterGovernanceMinterAnnounced, MinterGovernanceRewarded } from 'ponder:schema';
import { normalizeAddress } from './utils/format';

/*
Events

MinterGovernance:MinterAnnounced
MinterGovernance:Rewarded
*/

ponder.on('MinterGovernance:MinterAnnounced', async ({ event, context }) => {
	const chainId = context.chain.id;
	const who = normalizeAddress(event.args.who);
	const minter = normalizeAddress(event.args.minter);

	const counter = await context.db
		.insert(CommonEcosystem)
		.values({ id: `MinterGovernance:${chainId}:MinterAnnouncedCounter`, value: '', amount: 1n })
		.onConflictDoUpdate((current) => ({ amount: current.amount + 1n }));

	await context.db.insert(MinterGovernanceMinterAnnounced).values({
		chainId,
		who,
		minter,
		timestamp: event.args.timestamp,
		count: counter.amount,
		created: event.block.timestamp,
		txHash: event.transaction.hash,
	});
});

ponder.on('MinterGovernance:Rewarded', async ({ event, context }) => {
	const chainId = context.chain.id;
	const caller = normalizeAddress(event.args.caller);
	const token = normalizeAddress(event.args.token);

	const counter = await context.db
		.insert(CommonEcosystem)
		.values({ id: `MinterGovernance:${chainId}:RewardedCounter`, value: '', amount: 1n })
		.onConflictDoUpdate((current) => ({ amount: current.amount + 1n }));

	await context.db.insert(MinterGovernanceRewarded).values({
		chainId,
		caller,
		amount: event.args.amount,
		token,
		count: counter.amount,
		created: event.block.timestamp,
		txHash: event.transaction.hash,
	});
});
