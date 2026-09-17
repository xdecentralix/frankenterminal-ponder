import { ADDRESS, OCR2AggregatorABI } from '@frankencoin/zchf';
import { ponder } from 'ponder:registry';
import { PriceDiscovery } from 'ponder:schema';
import { parseUnits } from 'viem';
import { mainnet } from 'viem/chains';
import { max, eq, and } from 'drizzle-orm';
import { readWithFallback } from './utils/rpc';

ponder.on('UniswapV3Pool:Swap', async ({ event, context }) => {
	const calc = event.args.sqrtPriceX96 * event.args.sqrtPriceX96;
	const calcDiv = calc / 2n ** 96n;
	const calcMul = calcDiv * parseUnits('1', 18 * 2 - 6);
	const price = calcMul / 2n ** 96n;

	// Third-party oracle: a permanent failure (e.g. aggregator not yet deployed at this
	// block) records 0; a transient RPC failure propagates instead of storing a fake 0.
	const rawOracle = await readWithFallback(
		() =>
			context.client.readContract({
				abi: OCR2AggregatorABI,
				address: ADDRESS[mainnet.id].chainlinkOCR2Aggregator,
				functionName: 'latestAnswer',
			}),
		0n,
		'chainlink.latestAnswer'
	);
	const oracle = (rawOracle * 10n ** 18n) / 10n ** 8n;

	const existingRecords = await context.db.sql
		.select({ maxCount: max(PriceDiscovery.count) })
		.from(PriceDiscovery)
		.where(
			and(
				eq(PriceDiscovery.source, 'UniswapV3Pool:Swap'),
				eq(PriceDiscovery.blockheight, event.block.number)
			)
		);

	const currentMaxCount = (existingRecords.length > 0 && existingRecords[0]?.maxCount !== null 
		? existingRecords[0]?.maxCount 
		: -1n) ?? -1n;
	const nextCount = currentMaxCount + 1n;

	await context.db
		.insert(PriceDiscovery)
		.values({
			sender: event.args.sender,
			txHash: event.transaction.hash,
			source: 'UniswapV3Pool:Swap',
			created: event.block.timestamp,
			blockheight: event.block.number,
			count: nextCount,
			price,
			oracle,
		});
});
