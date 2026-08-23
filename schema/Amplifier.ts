import { onchainTable, primaryKey } from 'ponder';

// UniswapAmplifier — event-sourced facts only (no valuations / prices).
// The value of a Uniswap v3 position is derived downstream by the API via live slot0() reads.

// one row per amplifier per chain
export const AmplifierStatus = onchainTable(
	'AmplifierStatus',
	(t) => ({
		chainId: t.integer().notNull(),
		address: t.hex().notNull(), // amplifier address
		pool: t.hex().notNull(), // UNISWAP_POOL (immutable)
		usd: t.hex().notNull(), // USD (immutable)
		zchf: t.hex().notNull(), // ZCHF (immutable)
		zchfIsToken0: t.boolean().notNull(), // ZCHF_IS_TOKEN0 (immutable)
		expiration: t.bigint().notNull(), // EXPIRATION (immutable)
		limit: t.bigint().notNull(), // LIMIT (immutable)
		priceAnchorX96: t.bigint().notNull(), // PRICE_ANCHOR_X96 (immutable)
		totalBorrowed: t.bigint().notNull(), // set (not accumulated) from the latest Borrowed/Repaid event
		positionCount: t.integer().notNull(), // incremented on AmplifiedPositionCreated
		created: t.bigint().notNull(), // block timestamp of first indexed event
		updated: t.bigint().notNull(), // block timestamp of latest indexed event
	}),
	(table) => ({
		pk: primaryKey({ columns: [table.chainId, table.address] }),
	})
);

// one row per AmplifiedPosition clone
export const AmplifierPosition = onchainTable(
	'AmplifierPosition',
	(t) => ({
		chainId: t.integer().notNull(),
		position: t.hex().notNull(), // clone address
		amplifier: t.hex().notNull(), // emitting amplifier
		owner: t.hex().notNull(), // read at creation, updated on OwnershipTransferred
		tickLow: t.integer().notNull(), // fixed for the clone's lifetime
		tickHigh: t.integer().notNull(), // fixed for the clone's lifetime
		// Running sum of Mint.liquidityAdded − Burn.liquidityRemoved.
		// CAVEAT: liquidity can be donated to a position by minting directly on the pool with the clone
		// as recipient; that emits no event on the clone, so this value can undercount the on-chain
		// totalLiquidity(). Treat live totalLiquidity() as the source of truth; this is a registry/fallback.
		liquidity: t.bigint().notNull(),
		borrowed: t.bigint().notNull(), // running sum of Mint.borrowed − Burn.repaid
		created: t.bigint().notNull(),
		updated: t.bigint().notNull(),
	}),
	(table) => ({
		pk: primaryKey({ columns: [table.chainId, table.position] }),
	})
);

// flat append-only log of Mint / Burn events on clones
export const AmplifierActivity = onchainTable(
	'AmplifierActivity',
	(t) => ({
		chainId: t.integer().notNull(),
		txHash: t.hex().notNull(),
		count: t.bigint().notNull(), // log index within the tx's block — disambiguates multiple rows per tx
		amplifier: t.hex().notNull(),
		position: t.hex().notNull(),
		kind: t.text().notNull(), // 'Mint' | 'Burn'
		liquidity: t.bigint().notNull(), // liquidityAdded / liquidityRemoved
		token0: t.bigint().notNull(), // raw token0 amount from the event
		token1: t.bigint().notNull(), // raw token1 amount from the event
		zchf: t.bigint().notNull(), // borrowed (Mint) / repaid (Burn)
		totalBorrowed: t.bigint().notNull(), // amplifier-wide total after this event
		sender: t.hex().notNull(), // tx sender (third parties for expiredPublicBurn)
		created: t.bigint().notNull(),
		blockheight: t.bigint().notNull(),
	}),
	(table) => ({
		pk: primaryKey({ columns: [table.chainId, table.txHash, table.count] }),
	})
);
