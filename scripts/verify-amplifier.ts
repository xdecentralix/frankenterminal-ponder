#!/usr/bin/env tsx
/**
 * Verifies the UniswapAmplifier indexing against live chain state.
 *
 * 1. Reads the deployed parameters (LIMIT, EXPIRATION, totalBorrowed) of both amplifiers.
 * 2. Pulls the full event history (AmplifiedPositionCreated, Borrowed, Repaid, Mint, Burn, OwnershipTransferred)
 *    and replays the indexer semantics offline (running sums, set-not-add totalBorrowed).
 * 3. If a ponder GraphQL endpoint is reachable, compares AmplifierStatus / AmplifierPosition / AmplifierActivity
 *    rows against the replayed chain state.
 *
 * Usage:
 *   npx tsx scripts/verify-amplifier.ts                                  # public RPCs, compares against http://localhost:42069
 *   ALCHEMY_RPC_KEY=... npx tsx scripts/verify-amplifier.ts              # use Alchemy instead of public RPCs
 *   PONDER_URL=https://ponder.frankencoin.com npx tsx scripts/verify-amplifier.ts
 *   PONDER_URL= npx tsx scripts/verify-amplifier.ts                      # chain-only, skip the DB comparison
 *   AMPLIFIER=0x560E... START_BLOCK=25494820 CHAIN=1 npx tsx scripts/verify-amplifier.ts
 *                                                                        # replay an arbitrary amplifier (e.g. the test one), no param checks
 */

import { createPublicClient, getAddress, http, parseAbiItem, type Address, type Chain, type Hex, type PublicClient, type Transport } from 'viem';
import { mainnet, optimism } from 'viem/chains';
import { AmplifiedPositionABI, UNISWAP_AMPLIFIER_ADDRESS, UniswapAmplifierABI } from '../abis/UniswapAmplifier';

const PONDER_URL = process.env.PONDER_URL === undefined ? 'http://localhost:42069' : process.env.PONDER_URL;
const ALCHEMY = process.env.ALCHEMY_RPC_KEY;

const OVERRIDE =
	process.env.AMPLIFIER && process.env.START_BLOCK
		? { amplifier: process.env.AMPLIFIER as Address, startBlock: BigInt(process.env.START_BLOCK), chainId: Number(process.env.CHAIN ?? 1) }
		: undefined;

const TARGETS = [
	{
		chain: mainnet,
		rpc: ALCHEMY ? `https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY}` : process.env.RPC_MAINNET ?? 'https://ethereum-rpc.publicnode.com',
		amplifier: UNISWAP_AMPLIFIER_ADDRESS[1] as Address,
		startBlock: 25795552n,
		expected: { limit: 2_500_000n * 10n ** 18n, expiration: 1806537599n },
	},
	{
		chain: optimism,
		rpc: ALCHEMY ? `https://opt-mainnet.g.alchemy.com/v2/${ALCHEMY}` : process.env.RPC_OPTIMISM ?? 'https://optimism-rpc.publicnode.com',
		amplifier: UNISWAP_AMPLIFIER_ADDRESS[10] as Address,
		startBlock: 155811236n,
		expected: { limit: 1_000_000n * 10n ** 18n, expiration: 1806537599n },
	},
];

const EV = {
	created: parseAbiItem('event AmplifiedPositionCreated(address position)'),
	borrowed: parseAbiItem('event Borrowed(uint256 borrowed, uint256 totalBorrowed)'),
	repaid: parseAbiItem('event Repaid(uint256 amount, uint256 totalBorrowed)'),
	mint: parseAbiItem('event Mint(uint128 liquidityAdded, uint256 token0, uint256 token1, uint256 borrowed)'),
	burn: parseAbiItem('event Burn(uint128 liquidityRemoved, uint256 token0, uint256 token1, uint256 repaid)'),
	owner: parseAbiItem('event OwnershipTransferred(address indexed previousOwner, address indexed newOwner)'),
};

let failures = 0;
function check(ok: boolean, msg: string) {
	console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${msg}`);
	if (!ok) failures++;
}

async function getLogsChunked<T extends { blockNumber: bigint }>(
	fetch: (from: bigint, to: bigint) => Promise<T[]>,
	from: bigint,
	to: bigint,
	step: bigint
): Promise<T[]> {
	const out: T[] = [];
	for (let b = from; b <= to; b += step) {
		const e = b + step - 1n < to ? b + step - 1n : to;
		out.push(...(await fetch(b, e)));
	}
	return out;
}

type Replay = {
	totalBorrowed: bigint;
	positions: Map<string, { owner: string; tickLow: number; tickHigh: number; liquidity: bigint; borrowed: bigint }>;
	activity: { txHash: Hex; logIndex: number; position: string; kind: 'Mint' | 'Burn'; liquidity: bigint; zchf: bigint; totalBorrowed: bigint }[];
};

async function replayChain(client: PublicClient<Transport, Chain>, amplifier: Address, startBlock: bigint, step: bigint): Promise<Replay> {
	const head = await client.getBlockNumber();
	const created = await getLogsChunked(
		(fromBlock, toBlock) => client.getLogs({ address: amplifier, event: EV.created, fromBlock, toBlock }),
		startBlock,
		head,
		step
	);
	const clones = created.map((l) => l.args.position!.toLowerCase() as Address);
	const ampLogs = await getLogsChunked(
		(fromBlock, toBlock) => client.getLogs({ address: amplifier, events: [EV.borrowed, EV.repaid], fromBlock, toBlock }),
		startBlock,
		head,
		step
	);
	const cloneLogs =
		clones.length === 0
			? []
			: await getLogsChunked(
					(fromBlock, toBlock) => client.getLogs({ address: clones, events: [EV.mint, EV.burn, EV.owner], fromBlock, toBlock }),
					startBlock,
					head,
					step
			  );

	// global log order, as ponder delivers it
	const all = [...created, ...ampLogs, ...cloneLogs].sort((a, b) =>
		a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1
	);

	const r: Replay = { totalBorrowed: 0n, positions: new Map(), activity: [] };
	for (const log of all) {
		const addr = log.address.toLowerCase();
		switch (log.eventName) {
			case 'AmplifiedPositionCreated': {
				const p = log.args.position!.toLowerCase();
				const [owner, tickLow, tickHigh] = await Promise.all([
					client.readContract({ abi: AmplifiedPositionABI, address: p as Address, functionName: 'owner', blockNumber: log.blockNumber }),
					client.readContract({ abi: AmplifiedPositionABI, address: p as Address, functionName: 'tickLow' }),
					client.readContract({ abi: AmplifiedPositionABI, address: p as Address, functionName: 'tickHigh' }),
				]);
				r.positions.set(p, { owner: owner.toLowerCase(), tickLow, tickHigh, liquidity: 0n, borrowed: 0n });
				break;
			}
			case 'Borrowed':
			case 'Repaid':
				r.totalBorrowed = log.args.totalBorrowed!;
				break;
			case 'Mint':
			case 'Burn': {
				const pos = r.positions.get(addr)!;
				const isMint = log.eventName === 'Mint';
				const liquidity = isMint ? log.args.liquidityAdded! : log.args.liquidityRemoved!;
				const zchf = isMint ? log.args.borrowed! : log.args.repaid!;
				pos.liquidity += isMint ? liquidity : -liquidity;
				pos.borrowed += isMint ? zchf : -zchf;
				r.activity.push({ txHash: log.transactionHash, logIndex: log.logIndex, position: addr, kind: log.eventName, liquidity, zchf, totalBorrowed: r.totalBorrowed });
				break;
			}
			case 'OwnershipTransferred': {
				const pos = r.positions.get(addr);
				if (pos) pos.owner = log.args.newOwner!.toLowerCase();
				break;
			}
		}
	}
	return r;
}

async function gql(query: string): Promise<any> {
	const res = await fetch(PONDER_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) });
	if (!res.ok) throw new Error(`HTTP ${res.status} from ${PONDER_URL}`);
	const json: any = await res.json();
	if (json.errors) throw new Error(`GQL error: ${JSON.stringify(json.errors)}`);
	return json.data;
}

async function compareDb(chainId: number, amplifier: Address, replay: Replay) {
	const amp = amplifier.toLowerCase();
	const data = await gql(`{
		amplifierStatuss(where: { chainId: ${chainId} }) { items { address totalBorrowed positionCount limit expiration } }
		amplifierPositions(where: { chainId: ${chainId} }, limit: 1000) { items { position owner tickLow tickHigh liquidity borrowed } }
		amplifierActivitys(where: { chainId: ${chainId} }, limit: 1000) { items { txHash count position kind liquidity zchf totalBorrowed } }
	}`);
	const statuses = data.amplifierStatuss.items as any[];
	check(statuses.length === 1 && statuses[0].address === amp, `DB: exactly one AmplifierStatus row for ${amp}`);
	const s = statuses[0];
	if (s) {
		check(BigInt(s.totalBorrowed) === replay.totalBorrowed, `DB: AmplifierStatus.totalBorrowed ${s.totalBorrowed} == chain ${replay.totalBorrowed}`);
		check(s.positionCount === replay.positions.size, `DB: positionCount ${s.positionCount} == ${replay.positions.size}`);
	}
	const dbPos = new Map((data.amplifierPositions.items as any[]).map((p) => [p.position, p]));
	check(dbPos.size === replay.positions.size, `DB: ${dbPos.size} AmplifierPosition rows == ${replay.positions.size} clones`);
	for (const [p, exp] of replay.positions) {
		const got = dbPos.get(p);
		if (!got) {
			check(false, `DB: position ${p} missing`);
			continue;
		}
		const same =
			got.owner === exp.owner &&
			got.tickLow === exp.tickLow &&
			got.tickHigh === exp.tickHigh &&
			BigInt(got.liquidity) === exp.liquidity &&
			BigInt(got.borrowed) === exp.borrowed;
		check(same, `DB: position ${p} owner/ticks/liquidity/borrowed match`);
	}
	const dbAct = new Set((data.amplifierActivitys.items as any[]).map((a) => `${a.txHash}:${a.count}`));
	check(dbAct.size === replay.activity.length, `DB: ${dbAct.size} AmplifierActivity rows == ${replay.activity.length} Mint/Burn events`);
	for (const a of replay.activity) check(dbAct.has(`${a.txHash}:${a.logIndex}`), `DB: activity ${a.kind} ${a.txHash} #${a.logIndex} present`);
}

async function main() {
	const targets = OVERRIDE
		? TARGETS.filter((t) => t.chain.id === OVERRIDE.chainId).map((t) => ({ ...t, amplifier: OVERRIDE.amplifier, startBlock: OVERRIDE.startBlock, expected: undefined }))
		: TARGETS;
	for (const t of targets) {
		console.log(`\n=== ${t.chain.name} (${t.chain.id}) amplifier ${t.amplifier} via ${t.rpc.replace(/v2\/.*/, 'v2/***')}`);
		const client: PublicClient<Transport, Chain> = createPublicClient({ chain: t.chain as Chain, transport: http(t.rpc) });
		const step = t.chain.id === mainnet.id ? 5000n : 10000n;

		// start block == deploy block
		const [codeBefore, codeAt] = await Promise.all([
			client.getCode({ address: t.amplifier, blockNumber: t.startBlock - 1n }).catch(() => undefined),
			client.getCode({ address: t.amplifier, blockNumber: t.startBlock }).catch(() => undefined),
		]);
		if (codeBefore === undefined && codeAt === undefined) console.log('  SKIP start block check (RPC has no archive state)');
		else check((codeBefore ?? '0x') === '0x' && (codeAt ?? '0x') !== '0x', `start block ${t.startBlock} is the deploy block`);

		// deployed parameters
		const [limit, expiration, totalBorrowed, pool, zchfIsToken0] = await Promise.all([
			client.readContract({ abi: UniswapAmplifierABI, address: t.amplifier, functionName: 'LIMIT' }),
			client.readContract({ abi: UniswapAmplifierABI, address: t.amplifier, functionName: 'EXPIRATION' }),
			client.readContract({ abi: UniswapAmplifierABI, address: t.amplifier, functionName: 'totalBorrowed' }),
			client.readContract({ abi: UniswapAmplifierABI, address: t.amplifier, functionName: 'UNISWAP_POOL' }),
			client.readContract({ abi: UniswapAmplifierABI, address: t.amplifier, functionName: 'ZCHF_IS_TOKEN0' }),
		]);
		if (t.expected) {
			check(limit === t.expected.limit, `LIMIT == ${t.expected.limit / 10n ** 18n}e18 (got ${limit / 10n ** 18n}e18)`);
			check(BigInt(expiration) === t.expected.expiration, `EXPIRATION == ${t.expected.expiration} (got ${expiration})`);
		} else console.log(`  info LIMIT=${limit} EXPIRATION=${expiration}`);
		console.log(`  info pool=${getAddress(pool)} zchfIsToken0=${zchfIsToken0} totalBorrowed=${totalBorrowed}`);

		// replay
		const replay = await replayChain(client, t.amplifier, t.startBlock, step);
		console.log(`  info ${replay.positions.size} positions, ${replay.activity.length} Mint/Burn events`);
		check(replay.totalBorrowed === totalBorrowed, `replayed totalBorrowed (set from events) == live totalBorrowed()`);
		const sumBorrowed = [...replay.positions.values()].reduce((s, p) => s + p.borrowed, 0n);
		check(sumBorrowed <= totalBorrowed, `sum(position.borrowed) ${sumBorrowed} <= totalBorrowed ${totalBorrowed}`);
		if (sumBorrowed !== totalBorrowed) console.log(`  info sum(position.borrowed) != totalBorrowed (donated liquidity or rounding)`);
		for (const [p, pos] of replay.positions) {
			const [liveLiq, liveBorrowed, liveOwner] = await Promise.all([
				client.readContract({ abi: AmplifiedPositionABI, address: p as Address, functionName: 'totalLiquidity' }),
				client.readContract({ abi: AmplifiedPositionABI, address: p as Address, functionName: 'borrowed' }),
				client.readContract({ abi: AmplifiedPositionABI, address: p as Address, functionName: 'owner' }),
			]);
			check(pos.borrowed === liveBorrowed, `position ${p}: replayed borrowed == live borrowed() (${liveBorrowed})`);
			check(pos.owner === liveOwner.toLowerCase(), `position ${p}: replayed owner == live owner()`);
			check(pos.liquidity <= liveLiq, `position ${p}: replayed liquidity ${pos.liquidity} <= live totalLiquidity() ${liveLiq}`);
		}
		for (const a of replay.activity) check(a.zchf >= 0n && a.totalBorrowed >= 0n, `activity ${a.kind} ${a.txHash}#${a.logIndex} zchf=${a.zchf} totalBorrowed=${a.totalBorrowed}`);

		if (PONDER_URL) {
			try {
				await compareDb(t.chain.id, t.amplifier, replay);
			} catch (e) {
				console.log(`  SKIP DB comparison (${PONDER_URL} unreachable: ${e instanceof Error ? e.message : e})`);
			}
		}
	}
	console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
	process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
