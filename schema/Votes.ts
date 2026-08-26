import { onchainTable, primaryKey } from 'ponder';

// FCS vote delegation — populated by both MainnetVotes:Delegation (mainnet) and BridgedVotes:Delegation
// (L2s). Same event shape, mutually exclusive by chain, so one table with chainId in the pk.
export const FCSDelegation = onchainTable(
	'FCSDelegation',
	(t) => ({
		chainId: t.integer().notNull(),
		owner: t.hex().notNull(),
		delegatedTo: t.hex().notNull(),
	}),
	(table) => ({
		pk: primaryKey({ columns: [table.chainId, table.owner] }),
	})
);

// CCIP-send side (mainnet only): MainnetVotes.pushFCSVotes -> FCSVotesSynced
export const MainnetVotesSynced = onchainTable(
	'MainnetVotesSynced',
	(t) => ({
		targetChain: t.bigint().notNull(),
		receiver: t.hex().notNull(),
		syncedVoters: t.text().notNull(), // JSON-serialized address[]
		count: t.bigint().notNull(),
		created: t.bigint().notNull(),
		txHash: t.hex().notNull(),
	}),
	(table) => ({
		pk: primaryKey({ columns: [table.targetChain, table.receiver, table.count] }),
	})
);

// CCIP-receive side (7 L2s): BridgedVotes._ccipReceive -> FCSVotesReceived
export const BridgedVotesReceived = onchainTable(
	'BridgedVotesReceived',
	(t) => ({
		chainId: t.integer().notNull(),
		messageId: t.hex().notNull(),
		sourceChain: t.bigint().notNull(),
		totalVotes: t.bigint().notNull(),
		syncedVotes: t.text().notNull(), // JSON-serialized SyncVote[] ({voter, votes, delegatee}[])
		created: t.bigint().notNull(),
		txHash: t.hex().notNull(),
	}),
	(table) => ({
		pk: primaryKey({ columns: [table.chainId, table.messageId] }),
	})
);
