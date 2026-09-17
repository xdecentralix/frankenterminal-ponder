/**
 * Error classification for RPC reads.
 *
 * Two kinds of failures reach an indexing function:
 *
 * 1. PERMANENT: the call is deterministic and will fail at this block forever.
 *    The contract reverted, is not a contract, does not implement the function, or
 *    returned data that does not decode against the ABI. Typical for user-supplied
 *    collateral tokens, including ones built to confuse indexers. Retrying is pointless;
 *    the caller must substitute a fallback and continue.
 *
 * 2. TRANSIENT: connectivity, rate limits, provider outages, timeouts. Ponder's RPC
 *    layer already retries these with exponential backoff (~1 minute) before the error
 *    surfaces here. If it still fails, the only safe outcome is to let the error
 *    propagate: Ponder stops and resumes from its last checkpoint, and no wrong data
 *    is persisted. Substituting a fallback here would silently corrupt the database.
 *
 * Classification is done on viem's error `name` strings rather than `instanceof`, so it
 * keeps working if the error was created by a different copy of viem (ESM/CJS dual
 * package hazard between Ponder's runtime and user code).
 */

/** viem error names that mean the call can never succeed at this block. */
const PERMANENT_ERROR_NAMES: ReadonlySet<string> = new Set([
	'ContractFunctionRevertedError', // reverted, with or without a decodable reason
	'ContractFunctionZeroDataError', // returned 0x: not a contract, or function not implemented
	'ExecutionRevertedError', // node-level "execution reverted"
	'RawContractError', // raw revert data from the node
	'AbiErrorSignatureNotFoundError', // reverted with a custom error the ABI does not know
	'AbiFunctionNotFoundError', // function missing from the ABI (programming error, but deterministic)
	'AbiDecodingZeroDataError', // returned no data to decode
	'AbiDecodingDataSizeTooSmallError', // returned garbage that does not fit the ABI
	'AbiDecodingDataSizeInvalidError', // returned garbage that does not fit the ABI
	'InvalidAddressError', // address is malformed
]);

/** JSON-RPC error codes some providers use for a revert instead of a structured error. */
const REVERT_RPC_CODES: ReadonlySet<number> = new Set([3, -32000, -32015]);

/** Walks `error` and its `cause` chain, guarding against cycles. */
function* causeChain(error: unknown): Generator<Record<string, unknown>> {
	const seen = new Set<unknown>();
	let current: unknown = error;
	while (current !== null && typeof current === 'object' && !seen.has(current)) {
		seen.add(current);
		yield current as Record<string, unknown>;
		current = (current as { cause?: unknown }).cause;
	}
}

export function isPermanentContractError(error: unknown): boolean {
	for (const e of causeChain(error)) {
		if (typeof e.name === 'string' && PERMANENT_ERROR_NAMES.has(e.name)) return true;

		if (typeof e.code === 'number' && REVERT_RPC_CODES.has(e.code) && typeof e.message === 'string' && /revert/i.test(e.message)) {
			return true;
		}
	}
	return false;
}

function describe(error: unknown): string {
	for (const e of causeChain(error)) {
		if (typeof e.shortMessage === 'string') return e.shortMessage;
	}
	return error instanceof Error ? error.message : String(error);
}

/**
 * Runs a contract read against an untrusted contract.
 *
 * Returns `fallback` if the failure is permanent (see `isPermanentContractError`).
 * Rethrows if the failure is transient so that Ponder can retry or restart from its
 * checkpoint instead of persisting a fabricated value.
 *
 * Use this for reads on contracts the protocol does not control (collateral tokens,
 * third-party oracles), and for views on Frankencoin's own contracts that call into such
 * a contract internally (PositionV2.availableForClones / availableForMinting read
 * collateral.balanceOf). Storage-only views on Frankencoin's own contracts should not be
 * wrapped: a revert there indicates a real bug and must surface.
 */
export async function readWithFallback<T>(read: () => Promise<T>, fallback: T, label: string): Promise<T> {
	try {
		return await read();
	} catch (error) {
		if (isPermanentContractError(error)) {
			console.warn(`[readWithFallback] ${label}: permanent contract error, using fallback. ${describe(error)}`);
			return fallback;
		}
		throw error;
	}
}
