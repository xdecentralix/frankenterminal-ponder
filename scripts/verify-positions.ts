#!/usr/bin/env tsx
/**
 * Compares position-related data between production and a local ponder instance.
 *
 * Usage:
 *   LOCAL_URL=http://localhost:42069 PROD_URL=https://ponder.frankencoin.com npx tsx scripts/verify-positions.ts
 *   npx tsx scripts/verify-positions.ts                          # uses defaults above
 *   npx tsx scripts/verify-positions.ts 0xf353...               # filter to one position
 */

const LOCAL_URL = process.env.LOCAL_URL ?? 'https://ponder-prepare-frankencoincom.up.railway.app/';
const PROD_URL = process.env.PROD_URL ?? 'https://ponder.frankencoin.com';
const POSITION_FILTER = process.argv[2]?.toLowerCase();

// ─── GraphQL helpers ──────────────────────────────────────────────────────────

async function gql(url: string, query: string): Promise<any> {
	const res = await fetch(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ query }),
	});
	if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
	const json = await res.json();
	if (json.errors) throw new Error(`GQL error: ${JSON.stringify(json.errors)}`);
	return json.data;
}

async function fetchAll(url: string, entity: string, fields: string): Promise<any[]> {
	const items: any[] = [];
	let cursor: string | null = null;
	let hasNext = true;
	while (hasNext) {
		const after = cursor ? `, after: "${cursor}"` : '';
		const data = await gql(url, `{ ${entity}(limit: 1000${after}) { items { ${fields} } pageInfo { endCursor hasNextPage } } }`);
		items.push(...data[entity].items);
		hasNext = data[entity].pageInfo.hasNextPage;
		cursor = data[entity].pageInfo.endCursor;
	}
	return items;
}

// ─── Comparison ───────────────────────────────────────────────────────────────

type Diff = { key: string; field: string; prod: unknown; local: unknown };

function compareItems(
	prodItems: any[],
	localItems: any[],
	keyFn: (item: any) => string,
	ignoredFields: string[] = []
): { onlyInProd: string[]; onlyInLocal: string[]; diffs: Diff[] } {
	const prodMap = new Map(prodItems.map((i) => [keyFn(i), i]));
	const localMap = new Map(localItems.map((i) => [keyFn(i), i]));

	const onlyInProd = [...prodMap.keys()].filter((k) => !localMap.has(k));
	const onlyInLocal = [...localMap.keys()].filter((k) => !prodMap.has(k));
	const diffs: Diff[] = [];

	for (const [key, prodItem] of prodMap) {
		const localItem = localMap.get(key);
		if (!localItem) continue;
		for (const field of Object.keys(prodItem)) {
			if (ignoredFields.includes(field)) continue;
			const pv = String(prodItem[field]);
			const lv = String(localItem[field]);
			if (pv !== lv) diffs.push({ key, field, prod: prodItem[field], local: localItem[field] });
		}
	}

	return { onlyInProd, onlyInLocal, diffs };
}

function printResult(label: string, prodCount: number, localCount: number, onlyInProd: string[], onlyInLocal: string[], diffs: Diff[]) {
	const ok = onlyInProd.length === 0 && onlyInLocal.length === 0 && diffs.length === 0;
	const status = ok ? '✓' : '✗';
	console.log(`\n${status} ${label}  (prod: ${prodCount}  local: ${localCount})`);

	if (onlyInProd.length > 0) {
		console.log(`  Missing in local (${onlyInProd.length}):`);
		onlyInProd.slice(0, 10).forEach((k) => console.log(`    - ${k}`));
		if (onlyInProd.length > 10) console.log(`    ... and ${onlyInProd.length - 10} more`);
	}
	if (onlyInLocal.length > 0) {
		console.log(`  Extra in local (${onlyInLocal.length}):`);
		onlyInLocal.slice(0, 10).forEach((k) => console.log(`    + ${k}`));
		if (onlyInLocal.length > 10) console.log(`    ... and ${onlyInLocal.length - 10} more`);
	}
	if (diffs.length > 0) {
		console.log(`  Field diffs (${diffs.length}):`);
		diffs.slice(0, 20).forEach((d) => console.log(`    ${d.key}  ${d.field}: prod=${d.prod}  local=${d.local}`));
		if (diffs.length > 20) console.log(`    ... and ${diffs.length - 20} more`);
	}
}

// ─── Entity definitions ───────────────────────────────────────────────────────

const V1_POSITION_FIELDS = `
  position owner zchf collateral price created isOriginal isClone
  denied denyDate closed original
  minimumCollateral annualInterestPPM reserveContribution
  start cooldown expiration challengePeriod
  collateralName collateralSymbol collateralDecimals
  collateralBalance limitForPosition limitForClones
  availableForPosition availableForClones minted
`.trim();

const V2_POSITION_FIELDS = `
  position owner zchf collateral price created isOriginal isClone
  denied denyDate closed original parent
  minimumCollateral riskPremiumPPM reserveContribution
  start cooldown expiration challengePeriod
  collateralName collateralSymbol collateralDecimals
  collateralBalance limitForClones availableForClones availableForMinting minted
`.trim();

const V1_MINTING_UPDATE_FIELDS = `
  position count txHash created owner isClone collateral
  collateralName collateralSymbol collateralDecimals
  size price minted sizeAdjusted priceAdjusted mintedAdjusted
  annualInterestPPM reserveContribution feeTimeframe feePPM feePaid
`.trim();

const V2_MINTING_UPDATE_FIELDS = `
  position count txHash created owner isClone collateral
  collateralName collateralSymbol collateralDecimals
  size price minted sizeAdjusted priceAdjusted mintedAdjusted
  annualInterestPPM basePremiumPPM riskPremiumPPM reserveContribution
  feeTimeframe feePPM feePaid
`.trim();

const OWNER_TRANSFER_FIELDS = `
  position count version txHash created previousOwner newOwner
`.trim();

const STATUS_FIELDS = `
  position ownerTransfersCounter mintingUpdatesCounter
  challengeStartedCounter challengeAvertedBidsCounter challengeSucceededBidsCounter
`.trim();

// ─── Main ─────────────────────────────────────────────────────────────────────

async function run() {
	console.log(`Comparing  PROD: ${PROD_URL}`);
	console.log(`           LOCAL: ${LOCAL_URL}`);
	if (POSITION_FILTER) console.log(`Filter: ${POSITION_FILTER}`);

	const applyFilter = (items: any[]) => (POSITION_FILTER ? items.filter((i) => i.position?.toLowerCase() === POSITION_FILTER) : items);

	type Check = {
		label: string;
		entity: string;
		fields: string;
		keyFn: (i: any) => string;
		ignored?: string[];
	};

	const checks: Check[] = [
		{
			label: 'V1 Positions',
			entity: 'mintingHubV1PositionV1s',
			fields: V1_POSITION_FIELDS,
			keyFn: (i) => i.position,
		},
		{
			label: 'V1 Minting Updates',
			entity: 'mintingHubV1MintingUpdateV1s',
			fields: V1_MINTING_UPDATE_FIELDS,
			keyFn: (i) => `${i.position}#${i.count}`,
		},
		{
			label: 'V1 Owner Transfers',
			entity: 'mintingHubV1OwnerTransfersV1s',
			fields: OWNER_TRANSFER_FIELDS,
			keyFn: (i) => `${i.position}#${i.count}`,
		},
		{
			label: 'V1 Status',
			entity: 'mintingHubV1Statuss',
			fields: STATUS_FIELDS,
			keyFn: (i) => i.position,
		},
		{
			label: 'V2 Positions',
			entity: 'mintingHubV2PositionV2s',
			fields: V2_POSITION_FIELDS,
			keyFn: (i) => i.position,
		},
		{
			label: 'V2 Minting Updates',
			entity: 'mintingHubV2MintingUpdateV2s',
			fields: V2_MINTING_UPDATE_FIELDS,
			keyFn: (i) => `${i.position}#${i.count}`,
		},
		{
			label: 'V2 Owner Transfers',
			entity: 'mintingHubV2OwnerTransfersV2s',
			fields: OWNER_TRANSFER_FIELDS,
			keyFn: (i) => `${i.position}#${i.count}`,
		},
		{
			label: 'V2 Status',
			entity: 'mintingHubV2Statuss',
			fields: STATUS_FIELDS,
			keyFn: (i) => i.position,
		},
	];

	let totalDiffs = 0;

	for (const check of checks) {
		process.stdout.write(`Fetching ${check.label}...`);
		const [prodRaw, localRaw] = await Promise.all([
			fetchAll(PROD_URL, check.entity, check.fields),
			fetchAll(LOCAL_URL, check.entity, check.fields),
		]);
		const prod = applyFilter(prodRaw);
		const local = applyFilter(localRaw);
		process.stdout.write(`\r`);

		const { onlyInProd, onlyInLocal, diffs } = compareItems(prod, local, check.keyFn, check.ignored);
		printResult(check.label, prod.length, local.length, onlyInProd, onlyInLocal, diffs);
		totalDiffs += onlyInProd.length + onlyInLocal.length + diffs.length;
	}

	console.log(`\n${'─'.repeat(60)}`);
	console.log(totalDiffs === 0 ? '✓ All data matches.' : `✗ ${totalDiffs} total discrepancies found.`);
}

run().catch((err) => {
	console.error(err.message);
	process.exit(1);
});
