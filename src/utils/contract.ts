/** Map contract reverts to 0n; rethrow transport/RPC failures so Ponder retries. */
export function zeroOnRevert(error: unknown): bigint {
	const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
	if (/reverted|AbiErrorSignatureNotFoundError/i.test(message)) return 0n;
	throw error;
}
