import { gte, inArray } from 'ponder';
import { type Context } from 'ponder:registry';
import { AnalyticTransactionLog, AnalyticDailyLog, CommonEcosystem } from 'ponder:schema';
import { EquityABI, FrankencoinABI } from '@frankencoin/zchf';
import { addr } from '../../ponder.config';
import { mainnet } from 'viem/chains';

// Time constants for efficient date calculations using BigInt arithmetic
const ONE_DAY_SECONDS = 86400n;
const ONE_YEAR_SECONDS = 365n * ONE_DAY_SECONDS;

interface updateTransactionLogProps {
	client: Context['client'];
	db: Context['db'];
	chainId: number;
	blockNumber: bigint;
	timestamp: bigint;
	kind: string;
	amount: bigint;
	txHash: string;
}

/**
 * @dev: update transaction log for mainnet only
 * this function need a rebuild to reflect multichain data.
 */
export async function updateTransactionLog({
	client,
	db,
	chainId,
	blockNumber,
	timestamp,
	kind,
	amount,
	txHash,
}: updateTransactionLogProps) {
	if (process.env.ENABLE_TRANSACTION_LOG !== 'true') return;
	if (chainId != mainnet.id) return;

	const mainnetAddress = addr[mainnet.id];

	// Batch query for ecosystem data (single query instead of 8 sequential queries)
	const ecosystemIds = [
		'Equity:Profits',
		'Equity:Losses',
		'Equity:EarningsPerFPS',
		'Savings:TotalSaved',
		'Savings:TotalInterestCollected',
		'Savings:TotalWithdrawn',
	];

	const ecosystemRecords = await db.sql.select().from(CommonEcosystem).where(inArray(CommonEcosystem.id, ecosystemIds));

	// Create lookup map for O(1) access
	const ecosystemData = new Map(ecosystemRecords.map((r) => [r.id, r.amount]));

	// Extract values with defaults
	const totalInflow = ecosystemData.get('Equity:Profits') ?? 0n;
	const totalOutflow = ecosystemData.get('Equity:Losses') ?? 0n;
	const earningsPerFPS = ecosystemData.get('Equity:EarningsPerFPS') ?? 0n;

	const totalSaved = ecosystemData.get('Savings:TotalSaved') ?? 0n;
	const totalInterestCollected = ecosystemData.get('Savings:TotalInterestCollected') ?? 0n;
	const totalWithdrawn = ecosystemData.get('Savings:TotalWithdrawn') ?? 0n;
	const totalSavings = totalSaved + totalInterestCollected - totalWithdrawn;

	// Fetch all on-chain reads and db lookups in parallel
	const [totalEquity, fpsTotalSupply, fpsPrice] = await Promise.all([
		client.readContract({ abi: FrankencoinABI, address: mainnetAddress.frankencoin, functionName: 'equity' }),
		client.readContract({ abi: EquityABI, address: mainnetAddress.equity, functionName: 'totalSupply' }),
		client.readContract({ abi: EquityABI, address: mainnetAddress.equity, functionName: 'price' }),
	]);

	// calc realized earnings, rolling latest 365days
	// Use BigInt arithmetic to avoid unnecessary conversions
	const dayTimestamp = timestamp - (timestamp % ONE_DAY_SECONDS);
	const last365dayTimestamp = dayTimestamp - ONE_YEAR_SECONDS;

	const last356dayEntry = await db.sql
		.select()
		.from(AnalyticDailyLog)
		.where(gte(AnalyticDailyLog.timestamp, last365dayTimestamp))
		.orderBy(AnalyticDailyLog.timestamp)
		.limit(1);

	let realizedNetEarnings = totalInflow - totalOutflow;
	if (last356dayEntry.length > 0) {
		const item = last356dayEntry.at(0);
		const inflowAdjusted = totalInflow - item!.totalInflow;
		const outflowAdjusted = totalOutflow - item!.totalOutflow;
		realizedNetEarnings = inflowAdjusted - outflowAdjusted;
	}

	const counter = await db
		.insert(CommonEcosystem)
		.values({
			id: 'Analytics:TransactionLogCounter',
			value: '',
			amount: 1n,
		})
		.onConflictDoUpdate((current) => ({
			amount: current.amount + 1n,
		}));

	await db.insert(AnalyticTransactionLog).values({
		chainId,
		timestamp,
		count: counter.amount,
		kind,
		amount,
		txHash: txHash as `0x${string}`,

		totalInflow,
		totalOutflow,

		totalEquity,
		totalSavings,

		fpsTotalSupply,
		fpsPrice,

		realizedNetEarnings,
		earningsPerFPS,
	});

	// Use BigInt arithmetic to get day boundary (more efficient than Date manipulations)
	const timestampDay = timestamp - (timestamp % ONE_DAY_SECONDS);
	// Only convert to Date for string formatting
	const dateString = new Date(Number(timestampDay) * 1000).toISOString().split('T')[0]!;

	const dailyLogData = {
		date: dateString,
		timestamp: timestampDay,
		txHash: txHash as `0x${string}`,

		totalInflow,
		totalOutflow,

		totalEquity,
		totalSavings,

		fpsTotalSupply,
		fpsPrice,

		realizedNetEarnings,
		earningsPerFPS,
	};

	await db
		.insert(AnalyticDailyLog)
		.values(dailyLogData)
		.onConflictDoUpdate(() => dailyLogData);
}
