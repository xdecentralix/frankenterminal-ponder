import { type Context } from 'ponder:registry';
import { MintingRevenueDaily } from 'ponder:schema';
import { ADDRESS, FrankencoinABI } from '@frankencoin/zchf';
import { parseEventLogs, type Hex } from 'viem';
import { mainnet } from 'viem/chains';
import { normalizeAddress } from '../utils/format';

const ONE_DAY_SECONDS = 86400n;

interface indexMintingRevenueProps {
	context: Context;
	hub: 'V1' | 'V2';
	kind: 'Challenge' | 'ForcedSale';
	hubAddress: Hex;
	// address reporting Profit/Loss to the Frankencoin: the hub for challenges, the position for forced sales
	reporter: Hex;
	// topic0 of the hub events that end a revenue window (ChallengeSucceeded, ForcedSale)
	boundaryTopics: Hex[];
	txHash: Hex;
	logIndex: number;
	timestamp: bigint;
}

/**
 * @dev Reads the tx logs and sums the Frankencoin Profit/Loss events reported during one
 * challenge success or forced sale. Logs are bounded by the previous boundary event of the
 * same hub in the tx, so batched calls are not double counted.
 *
 * Order within a window: [Profit (collectProfits)] | [Loss (coverLoss)], then Profit (burnWithoutReserve).
 * The last Profit is therefore the reserve release, any earlier Profit is the excess profit share.
 */
export async function indexMintingRevenue({
	context,
	hub,
	kind,
	hubAddress,
	reporter,
	boundaryTopics,
	txHash,
	logIndex,
	timestamp,
}: indexMintingRevenueProps) {
	const chainId = context.chain.id;
	const { logs } = await context.client.getTransactionReceipt({ hash: txHash });

	const hubNorm = normalizeAddress(hubAddress);
	const lowerBound = logs
		.filter((l) => normalizeAddress(l.address) === hubNorm && boundaryTopics.includes(l.topics[0] as Hex) && l.logIndex < logIndex)
		.reduce((max, l) => Math.max(max, l.logIndex), -1);

	const zchf = normalizeAddress(ADDRESS[mainnet.id].frankencoin);
	const reporterNorm = normalizeAddress(reporter);

	const events = parseEventLogs({
		abi: FrankencoinABI,
		eventName: ['Profit', 'Loss'],
		logs: logs.filter((l) => normalizeAddress(l.address) === zchf && l.logIndex > lowerBound && l.logIndex < logIndex),
	}).filter((e) => normalizeAddress(e.args.reportingMinter) === reporterNorm);

	const profits = events.filter((e) => e.eventName === 'Profit').map((e) => e.args.amount);
	const reserveReleased = profits.at(-1) ?? 0n;
	const excessProfit = profits.slice(0, -1).reduce((a, b) => a + b, 0n);
	const lossCovered = events.filter((e) => e.eventName === 'Loss').reduce((a, e) => a + e.args.amount, 0n);

	const day = timestamp - (timestamp % ONE_DAY_SECONDS);
	const date = new Date(Number(day) * 1000).toISOString().split('T')[0]!;

	await context.db
		.insert(MintingRevenueDaily)
		.values({ chainId, date, hub, kind, timestamp: day, excessProfit, reserveReleased, lossCovered, count: 1n })
		.onConflictDoUpdate((current) => ({
			excessProfit: current.excessProfit + excessProfit,
			reserveReleased: current.reserveReleased + reserveReleased,
			lossCovered: current.lossCovered + lossCovered,
			count: current.count + 1n,
		}));
}
