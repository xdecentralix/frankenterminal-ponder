#!/usr/bin/env tsx
/**
 * Compares MintingHub V1/V2 position state in a Ponder GraphQL instance against
 * live on-chain state, read directly from mainnet via multicall.
 *
 * This is intentionally NOT scripts/verify-positions.ts (which diffs two Ponder
 * instances against each other). Two Ponder deployments share the same handler
 * code, so a bug in that code reproduces identically on both sides and a
 * Ponder-vs-Ponder diff can never see it. Reading straight from the chain is
 * ground truth that doesn't depend on the indexer being right about anything.
 *
 * Scope: only fields reconstructible from *current* on-chain state are checked
 * (price, minted, cooldown, owner, collateral balance, ...). Event-sourced-only
 * fields (denied, denyDate, created, parent, and the MintingUpdate/OwnerTransfers
 * history tables) have no live getter to check against — verifying those against
 * the chain means replaying logs, not reading state, which is out of scope here.
 *
 * Also runs two cheap invariant checks against the Ponder data itself:
 *   - at least one OwnerTransfers row exists (sanity: table isn't unexpectedly empty)
 *   - every clone position has at least one MintingUpdate (opening a clone always
 *     emits one immediately, so mintingUpdatesCounter >= 1 must hold)
 *
 * Usage:
 *   npx tsx scripts/verify-onchain.ts
 *   PONDER_URL=http://localhost:42069 npx tsx scripts/verify-onchain.ts
 *   ALCHEMY_RPC_KEY=... npx tsx scripts/verify-onchain.ts     # else falls back to a public RPC
 *   npx tsx scripts/verify-onchain.ts 0xf353...               # filter to one position
 */

import { createPublicClient, http, type Address } from 'viem';
import { mainnet } from 'viem/chains';
import { ERC20ABI, PositionV1ABI, PositionV2ABI } from '@frankencoin/zchf';

const PONDER_URL = process.env.PONDER_URL ?? 'https://ponder.frankencoin.com';
const ALCHEMY = process.env.ALCHEMY_RPC_KEY;
const RPC_URL = ALCHEMY ? `https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY}` : 'https://ethereum-rpc.publicnode.com';
const POSITION_FILTER = process.argv[2]?.toLowerCase();

const client = createPublicClient({ chain: mainnet, transport: http(RPC_URL) });

// ─── GraphQL helpers ──────────────────────────────────────────────────────────

async function gql(query: string): Promise<any> {
	const res = await fetch(PONDER_URL, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ query }),
	});
	if (!res.ok) throw new Error(`HTTP ${res.status} from ${PONDER_URL}`);
	const json = (await res.json()) as { data: any; errors?: unknown };
	if (json.errors) throw new Error(`GQL error: ${JSON.stringify(json.errors)}`);
	return json.data;
}

async function fetchAll(entity: string, fields: string): Promise<any[]> {
	const items: any[] = [];
	let cursor: string | null = null;
	let hasNext = true;
	while (hasNext) {
		const after = cursor ? `, after: "${cursor}"` : '';
		const data = await gql(`{ ${entity}(limit: 1000${after}) { items { ${fields} } pageInfo { endCursor hasNextPage } } }`);
		items.push(...data[entity].items);
		hasNext = data[entity].pageInfo.hasNextPage;
		cursor = data[entity].pageInfo.endCursor;
	}
	return items;
}

// ─── Multicall helpers ─────────────────────────────────────────────────────────

type Call = { address: Address; abi: any; functionName: string; args?: readonly unknown[] };
type Tagged = { key: string; field: string; call: Call };

async function multicallTagged(entries: Tagged[]): Promise<Map<string, Record<string, { ok: boolean; value: any }>>> {
	const results = await client.multicall({ contracts: entries.map((e) => e.call), allowFailure: true });
	const byKey = new Map<string, Record<string, { ok: boolean; value: any }>>();
	entries.forEach((e, i) => {
		const r = results[i];
		if (!r) return;
		if (!byKey.has(e.key)) byKey.set(e.key, {});
		byKey.get(e.key)![e.field] = { ok: r.status === 'success', value: r.status === 'success' ? r.result : undefined };
	});
	return byKey;
}

const asAddr = (v: unknown) => String(v).toLowerCase();

// ─── Diff reporting ─────────────────────────────────────────────────────────────

type Diff = { key: string; field: string; ponder: unknown; onchain: unknown };

function printResult(label: string, checked: number, diffs: Diff[], reverted: Set<string>) {
	const ok = diffs.length === 0;
	console.log(`\n${ok ? '✓' : '✗'} ${label}  (checked: ${checked})`);
	if (reverted.size > 0) {
		console.log(`  Calls reverted for ${reverted.size} position(s), those fields skipped:`);
		[...reverted].slice(0, 10).forEach((k) => console.log(`    ! ${k}`));
		if (reverted.size > 10) console.log(`    ... and ${reverted.size - 10} more`);
	}
	if (diffs.length > 0) {
		console.log(`  Field diffs (${diffs.length}):`);
		diffs.slice(0, 20).forEach((d) => console.log(`    ${d.key}  ${d.field}: ponder=${d.ponder}  onchain=${d.onchain}`));
		if (diffs.length > 20) console.log(`    ... and ${diffs.length - 20} more`);
	}
	return ok;
}

// ─── Position field checks ──────────────────────────────────────────────────────

const V1_FIELDS = `
  position owner zchf collateral price isOriginal isClone
  closed original minimumCollateral annualInterestPPM reserveContribution
  start cooldown expiration challengePeriod
  collateralName collateralSymbol collateralDecimals
  collateralBalance limitForClones availableForClones minted
`.trim();

const V2_FIELDS = `
  position owner zchf collateral price isOriginal isClone
  closed original minimumCollateral riskPremiumPPM reserveContribution
  start cooldown expiration challengePeriod
  collateralName collateralSymbol collateralDecimals
  collateralBalance limitForClones availableForClones availableForMinting minted
`.trim();

function buildErc20Calls(key: string, token: Address, position: Address): Tagged[] {
	return [
		{ key, field: 'erc20Name', call: { address: token, abi: ERC20ABI, functionName: 'name' } },
		{ key, field: 'erc20Symbol', call: { address: token, abi: ERC20ABI, functionName: 'symbol' } },
		{ key, field: 'erc20Decimals', call: { address: token, abi: ERC20ABI, functionName: 'decimals' } },
		{ key, field: 'erc20Balance', call: { address: token, abi: ERC20ABI, functionName: 'balanceOf', args: [position] } },
	];
}

async function verifyV1(): Promise<boolean> {
	let positions = await fetchAll('mintingHubV1PositionV1s', V1_FIELDS);
	if (POSITION_FILTER) positions = positions.filter((p) => p.position.toLowerCase() === POSITION_FILTER);
	if (positions.length === 0) {
		console.log('\n(no V1 positions to check)');
		return true;
	}

	const entries: Tagged[] = [];
	for (const p of positions) {
		const address = p.position as Address;
		const abi = PositionV1ABI;
		entries.push(
			{ key: address, field: 'price', call: { address, abi, functionName: 'price' } },
			{ key: address, field: 'minted', call: { address, abi, functionName: 'minted' } },
			{ key: address, field: 'cooldown', call: { address, abi, functionName: 'cooldown' } },
			{ key: address, field: 'isClosed', call: { address, abi, functionName: 'isClosed' } },
			{ key: address, field: 'owner', call: { address, abi, functionName: 'owner' } },
			{ key: address, field: 'original', call: { address, abi, functionName: 'original' } },
			{ key: address, field: 'expiration', call: { address, abi, functionName: 'expiration' } },
			{ key: address, field: 'annualInterestPPM', call: { address, abi, functionName: 'annualInterestPPM' } },
			{ key: address, field: 'reserveContribution', call: { address, abi, functionName: 'reserveContribution' } },
			{ key: address, field: 'collateral', call: { address, abi, functionName: 'collateral' } },
			{ key: address, field: 'challengePeriod', call: { address, abi, functionName: 'challengePeriod' } },
			{ key: address, field: 'start', call: { address, abi, functionName: 'start' } },
			{ key: address, field: 'minimumCollateral', call: { address, abi, functionName: 'minimumCollateral' } },
			{ key: address, field: 'limitForClones', call: { address, abi, functionName: 'limitForClones' } },
			{ key: address, field: 'zchf', call: { address, abi, functionName: 'zchf' } },
			...buildErc20Calls(address, p.collateral as Address, address)
		);
	}

	const byKey = await multicallTagged(entries);
	const diffs: Diff[] = [];
	const reverted = new Set<string>();

	for (const p of positions) {
		const key = p.position as string;
		const f = byKey.get(key) ?? {};
		const get = (field: string) => {
			const v = f[field];
			if (!v || !v.ok) {
				reverted.add(key);
				return undefined;
			}
			return v.value;
		};

		const cmp = (field: string, ponderValue: unknown, onchainValue: unknown) => {
			if (onchainValue === undefined) return;
			if (String(ponderValue) !== String(onchainValue)) diffs.push({ key, field, ponder: ponderValue, onchain: onchainValue });
		};

		const original = get('original');
		if (original !== undefined) {
			const isOriginal = asAddr(original) === asAddr(key);
			cmp('isOriginal', p.isOriginal, isOriginal);
			cmp('isClone', p.isClone, !isOriginal);
		}
		cmp('original', p.original, original !== undefined ? asAddr(original) : undefined);
		cmp('owner', p.owner, asAddrOrUndef(get('owner')));
		cmp('zchf', p.zchf, asAddrOrUndef(get('zchf')));
		cmp('collateral', p.collateral, asAddrOrUndef(get('collateral')));
		cmp('price', p.price, get('price'));
		cmp('minted', p.minted, get('minted'));
		cmp('cooldown', p.cooldown, get('cooldown'));
		cmp('closed', p.closed, get('isClosed'));
		cmp('expiration', p.expiration, get('expiration'));
		cmp('annualInterestPPM', p.annualInterestPPM, get('annualInterestPPM'));
		cmp('reserveContribution', p.reserveContribution, get('reserveContribution'));
		cmp('challengePeriod', p.challengePeriod, get('challengePeriod'));
		cmp('start', p.start, get('start'));
		cmp('minimumCollateral', p.minimumCollateral, get('minimumCollateral'));
		// limitForClones/availableForClones are only as fresh as this position's own last
		// MintingUpdate — a sibling clone consuming shared limit won't retrigger an update
		// here, so a diff can reflect known staleness (see issue #28) rather than a bug.
		cmp('limitForClones', p.limitForClones, get('limitForClones'));
		cmp('availableForClones', p.availableForClones, get('limitForClones'));
		cmp('collateralName', p.collateralName, get('erc20Name'));
		cmp('collateralSymbol', p.collateralSymbol, get('erc20Symbol'));
		cmp('collateralDecimals', p.collateralDecimals, get('erc20Decimals'));
		cmp('collateralBalance', p.collateralBalance, get('erc20Balance'));
	}

	return printResult('V1 Positions vs on-chain', positions.length, diffs, reverted);
}

function asAddrOrUndef(v: unknown) {
	return v === undefined ? undefined : asAddr(v);
}

async function verifyV2(): Promise<boolean> {
	let positions = await fetchAll('mintingHubV2PositionV2s', V2_FIELDS);
	if (POSITION_FILTER) positions = positions.filter((p) => p.position.toLowerCase() === POSITION_FILTER);
	if (positions.length === 0) {
		console.log('\n(no V2 positions to check)');
		return true;
	}

	const entries: Tagged[] = [];
	for (const p of positions) {
		const address = p.position as Address;
		const abi = PositionV2ABI;
		entries.push(
			{ key: address, field: 'price', call: { address, abi, functionName: 'price' } },
			{ key: address, field: 'minted', call: { address, abi, functionName: 'minted' } },
			{ key: address, field: 'cooldown', call: { address, abi, functionName: 'cooldown' } },
			{ key: address, field: 'isClosed', call: { address, abi, functionName: 'isClosed' } },
			{ key: address, field: 'owner', call: { address, abi, functionName: 'owner' } },
			{ key: address, field: 'original', call: { address, abi, functionName: 'original' } },
			{ key: address, field: 'expiration', call: { address, abi, functionName: 'expiration' } },
			{ key: address, field: 'riskPremiumPPM', call: { address, abi, functionName: 'riskPremiumPPM' } },
			{ key: address, field: 'reserveContribution', call: { address, abi, functionName: 'reserveContribution' } },
			{ key: address, field: 'collateral', call: { address, abi, functionName: 'collateral' } },
			{ key: address, field: 'challengePeriod', call: { address, abi, functionName: 'challengePeriod' } },
			{ key: address, field: 'start', call: { address, abi, functionName: 'start' } },
			{ key: address, field: 'minimumCollateral', call: { address, abi, functionName: 'minimumCollateral' } },
			{ key: address, field: 'limit', call: { address, abi, functionName: 'limit' } },
			{ key: address, field: 'availableForClones', call: { address, abi, functionName: 'availableForClones' } },
			{ key: address, field: 'availableForMinting', call: { address, abi, functionName: 'availableForMinting' } },
			{ key: address, field: 'zchf', call: { address, abi, functionName: 'zchf' } },
			...buildErc20Calls(address, p.collateral as Address, address)
		);
	}

	const byKey = await multicallTagged(entries);
	const diffs: Diff[] = [];
	const reverted = new Set<string>();

	for (const p of positions) {
		const key = p.position as string;
		const f = byKey.get(key) ?? {};
		const get = (field: string) => {
			const v = f[field];
			if (!v || !v.ok) {
				reverted.add(key);
				return undefined;
			}
			return v.value;
		};

		const cmp = (field: string, ponderValue: unknown, onchainValue: unknown) => {
			if (onchainValue === undefined) return;
			if (String(ponderValue) !== String(onchainValue)) diffs.push({ key, field, ponder: ponderValue, onchain: onchainValue });
		};

		const original = get('original');
		if (original !== undefined) {
			const isOriginal = asAddr(original) === asAddr(key);
			cmp('isOriginal', p.isOriginal, isOriginal);
			cmp('isClone', p.isClone, !isOriginal);
		}
		cmp('original', p.original, asAddrOrUndef(original));
		cmp('owner', p.owner, asAddrOrUndef(get('owner')));
		cmp('zchf', p.zchf, asAddrOrUndef(get('zchf')));
		cmp('collateral', p.collateral, asAddrOrUndef(get('collateral')));
		cmp('price', p.price, get('price'));
		cmp('minted', p.minted, get('minted'));
		cmp('cooldown', p.cooldown, get('cooldown'));
		cmp('closed', p.closed, get('isClosed'));
		cmp('expiration', p.expiration, get('expiration'));
		cmp('riskPremiumPPM', p.riskPremiumPPM, get('riskPremiumPPM'));
		cmp('reserveContribution', p.reserveContribution, get('reserveContribution'));
		cmp('challengePeriod', p.challengePeriod, get('challengePeriod'));
		cmp('start', p.start, get('start'));
		cmp('minimumCollateral', p.minimumCollateral, get('minimumCollateral'));
		cmp('limitForClones', p.limitForClones, get('limit')); // immutable on-chain, no staleness risk
		// availableForClones/availableForMinting: only the branch matching isOriginal is kept
		// live by the indexer (see src/PositionV2.ts, issue #28) — the other is expected to
		// sit at whatever it was last set to (often 0) and isn't compared here.
		if (p.isOriginal) cmp('availableForClones', p.availableForClones, get('availableForClones'));
		else cmp('availableForMinting', p.availableForMinting, get('availableForMinting'));
		cmp('collateralName', p.collateralName, get('erc20Name'));
		cmp('collateralSymbol', p.collateralSymbol, get('erc20Symbol'));
		cmp('collateralDecimals', p.collateralDecimals, get('erc20Decimals'));
		cmp('collateralBalance', p.collateralBalance, get('erc20Balance'));
	}

	return printResult('V2 Positions vs on-chain', positions.length, diffs, reverted);
}

// ─── Ponder-internal invariants ─────────────────────────────────────────────────

async function verifyOwnerTransfersExist(): Promise<boolean> {
	const [v1, v2] = await Promise.all([
		fetchAll('mintingHubV1OwnerTransfersV1s', 'position'),
		fetchAll('mintingHubV2OwnerTransfersV2s', 'position'),
	]);
	const total = v1.length + v2.length;
	const ok = total > 0;
	console.log(`\n${ok ? '✓' : '✗'} Owner Transfers present  (V1: ${v1.length}  V2: ${v2.length})`);
	if (!ok) console.log('  No OwnerTransfers rows in either table — indexing for OwnershipTransferred looks broken.');
	return ok;
}

async function verifyClonesHaveMintingUpdate(): Promise<boolean> {
	const [v1Positions, v2Positions, v1Status, v2Status] = await Promise.all([
		fetchAll('mintingHubV1PositionV1s', 'position isClone'),
		fetchAll('mintingHubV2PositionV2s', 'position isClone'),
		fetchAll('mintingHubV1Statuss', 'position mintingUpdatesCounter'),
		fetchAll('mintingHubV2Statuss', 'position mintingUpdatesCounter'),
	]);

	const counterByPosition = new Map<string, bigint>();
	for (const s of [...v1Status, ...v2Status]) counterByPosition.set(s.position, BigInt(s.mintingUpdatesCounter));

	const violations: string[] = [];
	for (const p of [...v1Positions, ...v2Positions]) {
		if (!p.isClone) continue;
		const filtered = POSITION_FILTER && p.position.toLowerCase() !== POSITION_FILTER;
		if (filtered) continue;
		const counter = counterByPosition.get(p.position) ?? 0n;
		if (counter < 1n) violations.push(p.position);
	}

	const ok = violations.length === 0;
	console.log(`\n${ok ? '✓' : '✗'} Clones have >=1 MintingUpdate  (clones checked: ${v1Positions.length + v2Positions.length})`);
	if (!ok) {
		console.log(`  Clones with zero MintingUpdate rows (${violations.length}):`);
		violations.slice(0, 10).forEach((v) => console.log(`    ! ${v}`));
		if (violations.length > 10) console.log(`    ... and ${violations.length - 10} more`);
	}
	return ok;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function run() {
	console.log(`Ponder:  ${PONDER_URL}`);
	console.log(`Chain:   mainnet via ${ALCHEMY ? 'Alchemy' : 'public RPC'}`);
	if (POSITION_FILTER) console.log(`Filter:  ${POSITION_FILTER}`);

	const results = await Promise.all([
		verifyV1(),
		verifyV2(),
		verifyOwnerTransfersExist(),
		verifyClonesHaveMintingUpdate(),
	]);

	const ok = results.every(Boolean);
	console.log(`\n${'─'.repeat(60)}`);
	console.log(ok ? '✓ All checks passed.' : '✗ Some checks failed — see above.');
	if (!ok) process.exitCode = 1;
}

run().catch((err) => {
	console.error(err.message);
	process.exit(1);
});
