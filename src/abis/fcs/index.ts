// TODO: DELETE this directory once @frankencoin/zchf exports FCS/MainnetVotes/BridgedVotes/MinterGovernance
// ABIs — swap for the package import in ponder.config.ts (Phase 2 of the FCS rollout guideline).
// Each ABI here is the compiled artifact copied verbatim from
// /Users/frankencoin/Documents/frankencoin/main/abi/contracts/equity/shares/ (not deployed yet, so
// ponder.config.ts pairs these ABIs with zeroAddress placeholders until Phase 1 deployment addresses
// are known). Kept as `as const` TS literals rather than raw JSON imports — a plain `resolveJsonModule`
// import widens each entry's `type`/`stateMutability` to `string`, which fails viem's `Abi` type.
export { FCSABI } from './FCS';
export { MainnetVotesABI } from './MainnetVotes';
export { BridgedVotesABI } from './BridgedVotes';
export { MinterGovernanceABI } from './MinterGovernance';
