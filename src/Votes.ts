import { ponder } from 'ponder:registry';
import { BridgedVotesReceived, CommonEcosystem, FCSDelegation, MainnetVotesSynced } from 'ponder:schema';
import { normalizeAddress } from './utils/format';

/*
Events

MainnetVotes:Delegation
MainnetVotes:FCSVotesSynced
BridgedVotes:Delegation
BridgedVotes:FCSVotesReceived
*/

const toJson = (obj: unknown): string => JSON.stringify(obj, (_, v) => (typeof v === 'bigint' ? v.toString() : v));

ponder.on('MainnetVotes:Delegation', async ({ event, context }) => {
	await context.db
		.insert(FCSDelegation)
		.values({
			chainId: context.chain.id,
			owner: normalizeAddress(event.args.from),
			delegatedTo: normalizeAddress(event.args.to),
		})
		.onConflictDoUpdate(() => ({
			delegatedTo: normalizeAddress(event.args.to),
		}));
});

ponder.on('BridgedVotes:Delegation', async ({ event, context }) => {
	await context.db
		.insert(FCSDelegation)
		.values({
			chainId: context.chain.id,
			owner: normalizeAddress(event.args.from),
			delegatedTo: normalizeAddress(event.args.to),
		})
		.onConflictDoUpdate(() => ({
			delegatedTo: normalizeAddress(event.args.to),
		}));
});

ponder.on('MainnetVotes:FCSVotesSynced', async ({ event, context }) => {
	const { chain, receiver, syncedVoters } = event.args;

	const counter = await context.db
		.insert(CommonEcosystem)
		.values({ id: 'MainnetVotes:FCSVotesSyncedCounter', value: '', amount: 1n })
		.onConflictDoUpdate((current) => ({ amount: current.amount + 1n }));

	await context.db.insert(MainnetVotesSynced).values({
		targetChain: BigInt(chain),
		receiver: normalizeAddress(receiver),
		syncedVoters: toJson(syncedVoters),
		count: counter.amount,
		created: event.block.timestamp,
		txHash: event.transaction.hash,
	});
});

ponder.on('BridgedVotes:FCSVotesReceived', async ({ event, context }) => {
	const { messageId, sourceChain, totalVotes, syncedVotes } = event.args;

	await context.db.insert(BridgedVotesReceived).values({
		chainId: context.chain.id,
		messageId,
		sourceChain: BigInt(sourceChain),
		totalVotes,
		syncedVotes: toJson(syncedVotes),
		created: event.block.timestamp,
		txHash: event.transaction.hash,
	});
});
