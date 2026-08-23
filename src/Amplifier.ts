import { ponder } from 'ponder:registry';
import { AmplifierActivity, AmplifierPosition, AmplifierStatus } from 'ponder:schema';
import { Address, Hex } from 'viem';
import { AmplifiedPositionABI, UniswapAmplifierABI } from '../abis/UniswapAmplifier';
import { normalizeAddress } from './utils/format';

/*
Events

UniswapAmplifier:AmplifiedPositionCreated
UniswapAmplifier:Borrowed
UniswapAmplifier:Repaid
AmplifiedPosition:Mint
AmplifiedPosition:Burn
AmplifiedPosition:OwnershipTransferred

Event ordering within one transaction (from UniswapAmplifier.sol):
- createAmplifiedPosition: clone.initialize() emits OwnershipTransferred(0x0 -> creator) BEFORE the
  amplifier emits AmplifiedPositionCreated. The OwnershipTransferred handler therefore ignores clones
  that are not registered yet; the creation handler reads owner() directly from the clone instead.
- mint: pool.mint() -> uniswapV3MintCallback -> amplifier.borrowIntoPool() emits Borrowed, THEN the
  clone emits Mint. Likewise amplifier.repay() emits Repaid BEFORE the clone emits Burn.
  Ponder delivers events in log order, so by the time Mint/Burn is handled, AmplifierStatus.totalBorrowed
  already reflects this transaction. AmplifierActivity.totalBorrowed is read from the status row without
  any delta adjustment.

The indexer stores event-sourced facts only - no valuations or pool prices.
*/

type AmplifierContext = Parameters<Parameters<typeof ponder.on<'UniswapAmplifier:Borrowed'>>[1]>[0]['context'];

// Returns the AmplifierStatus row, creating it with the on-chain immutables if it does not exist yet.
// Immutables are readable at any block after deployment, so the read is block-agnostic.
async function ensureAmplifierStatus(context: AmplifierContext, amplifier: Address, timestamp: bigint) {
	const { db, client, chain } = context;
	const chainId = chain.id;
	const address = normalizeAddress(amplifier);

	const existing = await db.find(AmplifierStatus, { chainId, address });
	if (existing) return existing;

	const [pool, usd, zchf, zchfIsToken0, expiration, limit, priceAnchorX96, totalBorrowed] = await Promise.all([
		client.readContract({ abi: UniswapAmplifierABI, address: amplifier, functionName: 'UNISWAP_POOL' }),
		client.readContract({ abi: UniswapAmplifierABI, address: amplifier, functionName: 'USD' }),
		client.readContract({ abi: UniswapAmplifierABI, address: amplifier, functionName: 'ZCHF' }),
		client.readContract({ abi: UniswapAmplifierABI, address: amplifier, functionName: 'ZCHF_IS_TOKEN0' }),
		client.readContract({ abi: UniswapAmplifierABI, address: amplifier, functionName: 'EXPIRATION' }),
		client.readContract({ abi: UniswapAmplifierABI, address: amplifier, functionName: 'LIMIT' }),
		client.readContract({ abi: UniswapAmplifierABI, address: amplifier, functionName: 'PRICE_ANCHOR_X96' }),
		client.readContract({ abi: UniswapAmplifierABI, address: amplifier, functionName: 'totalBorrowed' }),
	]);

	return await db.insert(AmplifierStatus).values({
		chainId,
		address,
		pool: normalizeAddress(pool),
		usd: normalizeAddress(usd),
		zchf: normalizeAddress(zchf),
		zchfIsToken0,
		expiration: BigInt(expiration),
		limit,
		priceAnchorX96,
		totalBorrowed,
		positionCount: 0,
		created: timestamp,
		updated: timestamp,
	});
}

// event AmplifiedPositionCreated(address position);
ponder.on('UniswapAmplifier:AmplifiedPositionCreated', async ({ event, context }) => {
	const { db, client, chain } = context;
	const chainId = chain.id;
	const amplifier = event.log.address;
	const position = event.args.position;
	const created = event.block.timestamp;

	// The clone is fully initialized before this event fires; owner / ticks appear in no creation event.
	const [owner, tickLow, tickHigh] = await Promise.all([
		client.readContract({ abi: AmplifiedPositionABI, address: position, functionName: 'owner' }),
		client.readContract({ abi: AmplifiedPositionABI, address: position, functionName: 'tickLow' }),
		client.readContract({ abi: AmplifiedPositionABI, address: position, functionName: 'tickHigh' }),
	]);

	await db
		.insert(AmplifierPosition)
		.values({
			chainId,
			position: normalizeAddress(position),
			amplifier: normalizeAddress(amplifier),
			owner: normalizeAddress(owner),
			tickLow,
			tickHigh,
			liquidity: 0n,
			borrowed: 0n,
			created,
			updated: created,
		})
		.onConflictDoNothing();

	await ensureAmplifierStatus(context, amplifier, created);
	await db.update(AmplifierStatus, { chainId, address: normalizeAddress(amplifier) }).set((current) => ({
		positionCount: current.positionCount + 1,
		updated: created,
	}));
});

// event Borrowed(uint256 borrowed, uint256 totalBorrowed);
ponder.on('UniswapAmplifier:Borrowed', async ({ event, context }) => {
	const { db, chain } = context;
	const amplifier = event.log.address;

	// totalBorrowed is SET from the event (running total after the event), never accumulated, so the DB cannot drift.
	await ensureAmplifierStatus(context, amplifier, event.block.timestamp);
	await db.update(AmplifierStatus, { chainId: chain.id, address: normalizeAddress(amplifier) }).set({
		totalBorrowed: event.args.totalBorrowed,
		updated: event.block.timestamp,
	});
});

// event Repaid(uint256 amount, uint256 totalBorrowed);
ponder.on('UniswapAmplifier:Repaid', async ({ event, context }) => {
	const { db, chain } = context;
	const amplifier = event.log.address;

	await ensureAmplifierStatus(context, amplifier, event.block.timestamp);
	await db.update(AmplifierStatus, { chainId: chain.id, address: normalizeAddress(amplifier) }).set({
		totalBorrowed: event.args.totalBorrowed,
		updated: event.block.timestamp,
	});
});

// event Mint(uint128 liquidityAdded, uint256 token0, uint256 token1, uint256 borrowed);
ponder.on('AmplifiedPosition:Mint', async ({ event, context }) => {
	await handlePositionActivity(context, {
		kind: 'Mint',
		position: event.log.address,
		liquidity: event.args.liquidityAdded,
		token0: event.args.token0,
		token1: event.args.token1,
		zchf: event.args.borrowed,
		sender: event.transaction.from,
		txHash: event.transaction.hash,
		logIndex: event.log.logIndex,
		timestamp: event.block.timestamp,
		blockheight: event.block.number,
	});
});

// event Burn(uint128 liquidityRemoved, uint256 token0, uint256 token1, uint256 repaid);
ponder.on('AmplifiedPosition:Burn', async ({ event, context }) => {
	await handlePositionActivity(context, {
		kind: 'Burn',
		position: event.log.address,
		liquidity: event.args.liquidityRemoved,
		token0: event.args.token0,
		token1: event.args.token1,
		zchf: event.args.repaid,
		sender: event.transaction.from,
		txHash: event.transaction.hash,
		logIndex: event.log.logIndex,
		timestamp: event.block.timestamp,
		blockheight: event.block.number,
	});
});

type PositionActivity = {
	kind: 'Mint' | 'Burn';
	position: Address;
	liquidity: bigint;
	token0: bigint;
	token1: bigint;
	zchf: bigint;
	sender: Address;
	txHash: Hex;
	logIndex: number;
	timestamp: bigint;
	blockheight: bigint;
};

async function handlePositionActivity(context: AmplifierContext, a: PositionActivity) {
	const { db, chain } = context;
	const chainId = chain.id;
	const position = normalizeAddress(a.position);
	const sign = a.kind === 'Mint' ? 1n : -1n;

	const positionRow = await db.find(AmplifierPosition, { chainId, position });
	if (!positionRow) {
		// Cannot happen with factory discovery: AmplifiedPositionCreated is always processed before any Mint/Burn.
		console.error(`AmplifierPosition not found in ${a.kind} event:`, {
			chainId,
			position: a.position,
			txHash: a.txHash,
			blockNumber: a.blockheight,
		});
		throw new Error('AmplifierPosition not found');
	}

	// Running sums. See the schema comment on `liquidity` for the donated-liquidity caveat.
	await db.update(AmplifierPosition, { chainId, position }).set((current) => ({
		liquidity: current.liquidity + sign * a.liquidity,
		borrowed: current.borrowed + sign * a.zchf,
		updated: a.timestamp,
	}));

	// The amplifier's Borrowed/Repaid event precedes Mint/Burn in the same tx (see header comment),
	// so the status row already holds the post-transaction total.
	const status = await db.find(AmplifierStatus, { chainId, address: positionRow.amplifier });
	if (!status) {
		console.error(`AmplifierStatus not found in ${a.kind} event:`, {
			chainId,
			amplifier: positionRow.amplifier,
			position: a.position,
			txHash: a.txHash,
		});
	}

	await db.insert(AmplifierActivity).values({
		chainId,
		txHash: a.txHash,
		count: BigInt(a.logIndex), // log index is unique within the block, hence within the tx
		amplifier: positionRow.amplifier,
		position,
		kind: a.kind,
		liquidity: a.liquidity,
		token0: a.token0,
		token1: a.token1,
		zchf: a.zchf,
		totalBorrowed: status?.totalBorrowed ?? 0n,
		sender: normalizeAddress(a.sender),
		created: a.timestamp,
		blockheight: a.blockheight,
	});
}

// event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
ponder.on('AmplifiedPosition:OwnershipTransferred', async ({ event, context }) => {
	const { db, chain } = context;
	const chainId = chain.id;
	const position = normalizeAddress(event.log.address);

	// The initialization transfer (0x0 -> creator) fires before AmplifiedPositionCreated registers the clone.
	// The creation handler reads owner() itself, so the event can safely be ignored for unknown positions.
	const existing = await db.find(AmplifierPosition, { chainId, position });
	if (!existing) return;

	await db.update(AmplifierPosition, { chainId, position }).set({
		owner: normalizeAddress(event.args.newOwner),
		updated: event.block.timestamp,
	});
});
