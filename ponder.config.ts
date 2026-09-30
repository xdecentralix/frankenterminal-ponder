import { createConfig, factory, mergeAbis } from 'ponder';
import { arbitrum, avalanche, base, gnosis, mainnet, optimism, polygon, sonic } from 'viem/chains';
import { createPublicClient, erc20Abi, http } from 'viem';
import {
	ADDRESS,
	BLOCKNUMBER,
	AmplifiedPositionABI,
	BridgeAccountingABI,
	BridgedVotesABI,
	CCIPAdminABI,
	CrossChainReferenceABI,
	EquityABI,
	FCSABI,
	FrankencoinABI,
	LeadrateV2ABI,
	MainnetVotesABI,
	MinterGovernanceABI,
	MintingHubV1ABI,
	MintingHubV2ABI,
	PositionRollerV2ABI,
	PositionV1ABI,
	PositionV2ABI,
	SavingsABI,
	SavingsV2ABI,
	TransferReferenceABI,
	UniswapAmplifierABI,
	UniswapV3PoolABI,
} from '@frankencoin/zchf';

// Ponder logs "Indexed block" at info level for every realtime block (~4/s on Arbitrum) and offers no per-message
// filter. Its pretty logger writes through the global console.log, so drop the lines for blocks without events here.
// Lives in the config (not src/) on purpose: src/ file contents feed Ponder's build ID, this file's code does not.
// Set LOG_EMPTY_BLOCKS=true to restore.
const LOG_FILTER_INSTALLED = Symbol.for('frankencoin.ponder.logFilter');
if (process.env.LOG_EMPTY_BLOCKS !== 'true' && !(globalThis as Record<symbol, unknown>)[LOG_FILTER_INSTALLED]) {
	(globalThis as Record<symbol, unknown>)[LOG_FILTER_INSTALLED] = true;
	const log = console.log.bind(console);
	const emptyBlock = /Indexed block.*\bevent_count=0(?!\d)/;
	console.log = (...args: unknown[]) => {
		if (typeof args[0] === 'string' && emptyBlock.test(args[0])) return;
		log(...args);
	};
}

export const addr = ADDRESS;
export const block = BLOCKNUMBER;

export const config = {
	// core deployment
	[mainnet.id]: {
		rpc: `https://eth-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_RPC_KEY}`,
		maxRequestsPerSecond: parseInt(process.env.MAX_REQUESTS_PER_SECOND || '10'),
		pollingInterval: parseInt(process.env.POLLING_INTERVAL_MS || '30000'),
		ethGetLogsBlockRange: 5000, // ~12s blocks
	},

	// multichain support
	[polygon.id]: {
		rpc: `https://polygon-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_RPC_KEY}`,
		maxRequestsPerSecond: parseInt(process.env.MAX_REQUESTS_PER_SECOND || '10'),
		pollingInterval: parseInt(process.env.POLLING_INTERVAL_MS || '30000'),
		ethGetLogsBlockRange: 5000, // ~2s blocks
	},
	[arbitrum.id]: {
		rpc: `https://arb-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_RPC_KEY}`,
		maxRequestsPerSecond: parseInt(process.env.MAX_REQUESTS_PER_SECOND || '10'),
		// Ponder's realtime sync ingests at most 50 blocks per poll. Arbitrum produces ~4 blocks/s,
		// so with a 30s poll (1.7 blocks/s ceiling) it falls behind permanently. 4s gives 12.5 blocks/s.
		pollingInterval: Math.min(parseInt(process.env.POLLING_INTERVAL_MS || '30000'), 4000),
		ethGetLogsBlockRange: 10000, // ~250ms blocks — batch more to reduce request count
	},
	[optimism.id]: {
		rpc: `https://opt-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_RPC_KEY}`,
		maxRequestsPerSecond: parseInt(process.env.MAX_REQUESTS_PER_SECOND || '10'),
		pollingInterval: parseInt(process.env.POLLING_INTERVAL_MS || '30000'),
		ethGetLogsBlockRange: 5000, // ~2s blocks
	},
	[base.id]: {
		rpc: `https://base-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_RPC_KEY}`,
		maxRequestsPerSecond: parseInt(process.env.MAX_REQUESTS_PER_SECOND || '10'),
		pollingInterval: parseInt(process.env.POLLING_INTERVAL_MS || '30000'),
		ethGetLogsBlockRange: 5000, // ~2s blocks
	},
	[avalanche.id]: {
		// Alchemy's Avalanche node intermittently returns logs inconsistent with block.logsBloom. Ponder retries
		// for ~10 min and then crashes (exit 75). A second provider lets the retries land on a consistent node.
		// Chain settings are not part of Ponder's build ID, so changing RPCs does not trigger a reindex.
		rpc: [
			`https://avax-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_RPC_KEY}`,
			process.env.AVALANCHE_FALLBACK_RPC || 'https://api.avax.network/ext/bc/C/rpc',
		],
		maxRequestsPerSecond: parseInt(process.env.MAX_REQUESTS_PER_SECOND || '10'),
		pollingInterval: parseInt(process.env.POLLING_INTERVAL_MS || '30000'),
		ethGetLogsBlockRange: 5000, // ~2s blocks
	},
	[gnosis.id]: {
		rpc: `https://gnosis-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_RPC_KEY}`,
		maxRequestsPerSecond: parseInt(process.env.MAX_REQUESTS_PER_SECOND || '10'),
		pollingInterval: parseInt(process.env.POLLING_INTERVAL_MS || '30000'),
		ethGetLogsBlockRange: 5000, // ~5s blocks
	},
	[sonic.id]: {
		rpc: `https://sonic-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_RPC_KEY}`,
		maxRequestsPerSecond: parseInt(process.env.MAX_REQUESTS_PER_SECOND || '10'),
		// Sonic produces ~1-2 blocks/s, close to the 50-blocks-per-poll ceiling at 30s. 10s gives 5 blocks/s.
		pollingInterval: Math.min(parseInt(process.env.POLLING_INTERVAL_MS || '30000'), 10000),
		ethGetLogsBlockRange: 5000, // ~500ms blocks
	},
};

export const mainnetClient = createPublicClient({
	chain: mainnet,
	transport: http(config[mainnet.id].rpc),
});

const openPositionEventV1 = MintingHubV1ABI.find((a) => a.type === 'event' && a.name === 'PositionOpened');
if (openPositionEventV1 === undefined) throw new Error('openPositionEventV1 not found.');

const openPositionEventV2 = MintingHubV2ABI.find((a) => a.type === 'event' && a.name === 'PositionOpened');
if (openPositionEventV2 === undefined) throw new Error('openPositionEventV2 not found.');

const amplifiedPositionCreatedEvent = UniswapAmplifierABI.find((a) => a.type === 'event' && a.name === 'AmplifiedPositionCreated');
if (amplifiedPositionCreatedEvent === undefined) throw new Error('amplifiedPositionCreatedEvent not found.');

export default createConfig({
	chains: {
		// ### NATIVE CHAIN SUPPORT ###
		[mainnet.name]: {
			id: mainnet.id,
			maxRequestsPerSecond: config[mainnet.id].maxRequestsPerSecond,
			pollingInterval: config[mainnet.id].pollingInterval,
			ethGetLogsBlockRange: config[mainnet.id].ethGetLogsBlockRange,
			rpc: http(config[mainnet.id].rpc),
		},

		// ### MULTI CHAIN SUPPORT ###
		[polygon.name]: {
			id: polygon.id,
			maxRequestsPerSecond: config[polygon.id].maxRequestsPerSecond,
			pollingInterval: config[polygon.id].pollingInterval,
			ethGetLogsBlockRange: config[polygon.id].ethGetLogsBlockRange,
			rpc: http(config[polygon.id].rpc),
		},
		[arbitrum.name]: {
			id: arbitrum.id,
			maxRequestsPerSecond: config[arbitrum.id].maxRequestsPerSecond,
			pollingInterval: config[arbitrum.id].pollingInterval,
			ethGetLogsBlockRange: config[arbitrum.id].ethGetLogsBlockRange,
			rpc: http(config[arbitrum.id].rpc),
		},
		[optimism.name]: {
			id: optimism.id,
			maxRequestsPerSecond: config[optimism.id].maxRequestsPerSecond,
			pollingInterval: config[optimism.id].pollingInterval,
			ethGetLogsBlockRange: config[optimism.id].ethGetLogsBlockRange,
			rpc: http(config[optimism.id].rpc),
		},
		[base.name]: {
			id: base.id,
			maxRequestsPerSecond: config[base.id].maxRequestsPerSecond,
			pollingInterval: config[base.id].pollingInterval,
			ethGetLogsBlockRange: config[base.id].ethGetLogsBlockRange,
			rpc: http(config[base.id].rpc),
		},
		[avalanche.name]: {
			id: avalanche.id,
			maxRequestsPerSecond: config[avalanche.id].maxRequestsPerSecond,
			pollingInterval: config[avalanche.id].pollingInterval,
			ethGetLogsBlockRange: config[avalanche.id].ethGetLogsBlockRange,
			rpc: config[avalanche.id].rpc,
		},
		[gnosis.name]: {
			id: gnosis.id,
			maxRequestsPerSecond: config[gnosis.id].maxRequestsPerSecond,
			pollingInterval: config[gnosis.id].pollingInterval,
			ethGetLogsBlockRange: config[gnosis.id].ethGetLogsBlockRange,
			rpc: http(config[gnosis.id].rpc),
		},
		[sonic.name]: {
			id: sonic.id,
			maxRequestsPerSecond: config[sonic.id].maxRequestsPerSecond,
			pollingInterval: config[sonic.id].pollingInterval,
			ethGetLogsBlockRange: config[sonic.id].ethGetLogsBlockRange,
			rpc: http(config[sonic.id].rpc),
		},
	},
	contracts: {
		// ### NATIVE CONTRACT ###
		Frankencoin: {
			// Core
			abi: FrankencoinABI,
			chain: {
				[mainnet.name]: {
					address: addr[mainnet.id].frankencoin,
					startBlock: block[mainnet.id].frankencoin,
				},
				[polygon.name]: {
					address: addr[polygon.id].ccipBridgedFrankencoin,
					startBlock: block[polygon.id].ccipBridgedFrankencoin,
				},
				[arbitrum.name]: {
					address: addr[arbitrum.id].ccipBridgedFrankencoin,
					startBlock: block[arbitrum.id].ccipBridgedFrankencoin,
				},
				[optimism.name]: {
					address: addr[optimism.id].ccipBridgedFrankencoin,
					startBlock: block[optimism.id].ccipBridgedFrankencoin,
				},
				[base.name]: {
					address: addr[base.id].ccipBridgedFrankencoin,
					startBlock: block[base.id].ccipBridgedFrankencoin,
				},
				[avalanche.name]: {
					address: addr[avalanche.id].ccipBridgedFrankencoin,
					startBlock: block[avalanche.id].ccipBridgedFrankencoin,
				},
				[gnosis.name]: {
					address: addr[gnosis.id].ccipBridgedFrankencoin,
					startBlock: block[gnosis.id].ccipBridgedFrankencoin,
				},
				[sonic.name]: {
					address: addr[sonic.id].ccipBridgedFrankencoin,
					startBlock: block[sonic.id].ccipBridgedFrankencoin,
				},
			},
		},
		Equity: {
			// Core
			chain: mainnet.name,
			abi: EquityABI,
			address: addr[mainnet.id].equity,
			startBlock: block[mainnet.id].frankencoin,
		},
		FCS: {
			// mainnet-only ERC-4626 vault wrapping Equity 1:1
			chain: mainnet.name,
			abi: FCSABI,
			address: addr[mainnet.id].fcs,
			startBlock: block[mainnet.id].fcs,
		},
		MintingHubV1: {
			// V1
			chain: mainnet.name,
			abi: MintingHubV1ABI,
			address: addr[mainnet.id].mintingHubV1,
			startBlock: block[mainnet.id].mintingHubV1,
		},
		PositionV1: {
			// V1
			chain: mainnet.name,
			abi: PositionV1ABI,
			address: factory({
				address: addr[mainnet.id].mintingHubV1,
				event: openPositionEventV1,
				parameter: 'position',
			}),
			startBlock: block[mainnet.id].mintingHubV1,
		},
		MintingHubV2: {
			// V2
			chain: mainnet.name,
			abi: MintingHubV2ABI,
			address: addr[mainnet.id].mintingHubV2,
			startBlock: block[mainnet.id].mintingHubV2,
		},
		PositionV2: {
			// V2
			chain: mainnet.name,
			abi: PositionV2ABI,
			address: factory({
				address: addr[mainnet.id].mintingHubV2,
				event: openPositionEventV2,
				parameter: 'position',
			}),
			startBlock: block[mainnet.id].mintingHubV2,
		},
		SavingsV2: {
			// V2
			chain: mainnet.name,
			abi: SavingsV2ABI,
			address: addr[mainnet.id].savingsV2,
			startBlock: block[mainnet.id].mintingHubV2,
		},
		RollerV2: {
			// V2
			chain: mainnet.name,
			abi: PositionRollerV2ABI,
			address: addr[mainnet.id].rollerV2,
			startBlock: block[mainnet.id].mintingHubV2,
		},
		Leadrate: {
			// incl. SavingsV2, SavingsReferral, BridgedSavingsReferal
			abi: LeadrateV2ABI,
			chain: {
				[mainnet.name]: {
					address: [addr[mainnet.id].savingsV2, addr[mainnet.id].savingsReferral],
					startBlock: block[mainnet.id].mintingHubV2,
				},
				[polygon.name]: {
					address: [addr[polygon.id].ccipBridgedSavings],
					startBlock: block[polygon.id].ccipBridgedFrankencoin,
				},
				[arbitrum.name]: {
					address: [addr[arbitrum.id].ccipBridgedSavings],
					startBlock: block[arbitrum.id].ccipBridgedFrankencoin,
				},
				[optimism.name]: {
					address: [addr[optimism.id].ccipBridgedSavings],
					startBlock: block[optimism.id].ccipBridgedFrankencoin,
				},
				[base.name]: {
					address: [addr[base.id].ccipBridgedSavings],
					startBlock: block[base.id].ccipBridgedFrankencoin,
				},
				[avalanche.name]: {
					address: [addr[avalanche.id].ccipBridgedSavings],
					startBlock: block[avalanche.id].ccipBridgedFrankencoin,
				},
				[gnosis.name]: {
					address: [addr[gnosis.id].ccipBridgedSavings],
					startBlock: block[gnosis.id].ccipBridgedFrankencoin,
				},
				[sonic.name]: {
					address: [addr[sonic.id].ccipBridgedSavings],
					startBlock: block[sonic.id].ccipBridgedFrankencoin,
				},
			},
		},
		SavingsReferral: {
			// incl. SavingsReferral, BridgedSavingsReferral
			abi: SavingsABI,
			chain: {
				[mainnet.name]: {
					address: [addr[mainnet.id].savingsReferral],
					startBlock: block[mainnet.id].savingsReferral,
				},
				[polygon.name]: {
					address: [addr[polygon.id].ccipBridgedSavings],
					startBlock: block[polygon.id].ccipBridgedSavings,
				},
				[arbitrum.name]: {
					address: [addr[arbitrum.id].ccipBridgedSavings],
					startBlock: block[arbitrum.id].ccipBridgedSavings,
				},
				[optimism.name]: {
					address: [addr[optimism.id].ccipBridgedSavings],
					startBlock: block[optimism.id].ccipBridgedSavings,
				},
				[base.name]: {
					address: [addr[base.id].ccipBridgedSavings],
					startBlock: block[base.id].ccipBridgedSavings,
				},
				[avalanche.name]: {
					address: [addr[avalanche.id].ccipBridgedSavings],
					startBlock: block[avalanche.id].ccipBridgedSavings,
				},
				[gnosis.name]: {
					address: [addr[gnosis.id].ccipBridgedSavings],
					startBlock: block[gnosis.id].ccipBridgedSavings,
				},
				[sonic.name]: {
					address: [addr[sonic.id].ccipBridgedSavings],
					startBlock: block[sonic.id].ccipBridgedSavings,
				},
			},
		},
		MinterGovernance: {
			// one instance per chain (all 8)
			abi: MinterGovernanceABI,
			chain: {
				[mainnet.name]: {
					address: addr[mainnet.id].minterGovernance,
					startBlock: block[mainnet.id].minterGovernance,
				},
				[polygon.name]: {
					address: addr[polygon.id].minterGovernance,
					startBlock: block[polygon.id].minterGovernance,
				},
				[arbitrum.name]: {
					address: addr[arbitrum.id].minterGovernance,
					startBlock: block[arbitrum.id].minterGovernance,
				},
				[optimism.name]: {
					address: addr[optimism.id].minterGovernance,
					startBlock: block[optimism.id].minterGovernance,
				},
				[base.name]: {
					address: addr[base.id].minterGovernance,
					startBlock: block[base.id].minterGovernance,
				},
				[avalanche.name]: {
					address: addr[avalanche.id].minterGovernance,
					startBlock: block[avalanche.id].minterGovernance,
				},
				[gnosis.name]: {
					address: addr[gnosis.id].minterGovernance,
					startBlock: block[gnosis.id].minterGovernance,
				},
				[sonic.name]: {
					address: addr[sonic.id].minterGovernance,
					startBlock: block[sonic.id].minterGovernance,
				},
			},
		},

		// ### AMPLIFIER (mainnet + optimism) ###
		UniswapAmplifier: {
			abi: UniswapAmplifierABI,
			chain: {
				[mainnet.name]: {
					address: addr[mainnet.id].uniswapAmplifier,
					startBlock: block[mainnet.id].uniswapAmplifier,
				},
				[optimism.name]: {
					address: addr[optimism.id].uniswapAmplifier,
					startBlock: block[optimism.id].uniswapAmplifier,
				},
			},
		},
		AmplifiedPosition: {
			// EIP-1167 clones, factory-discovered from UniswapAmplifier:AmplifiedPositionCreated
			abi: AmplifiedPositionABI,
			chain: {
				[mainnet.name]: {
					address: factory({
						address: addr[mainnet.id].uniswapAmplifier,
						event: amplifiedPositionCreatedEvent,
						parameter: 'position',
					}),
					startBlock: block[mainnet.id].uniswapAmplifier,
				},
				[optimism.name]: {
					address: factory({
						address: addr[optimism.id].uniswapAmplifier,
						event: amplifiedPositionCreatedEvent,
						parameter: 'position',
					}),
					startBlock: block[optimism.id].uniswapAmplifier,
				},
			},
		},

		// ### COMMON CONTRACTS ###
		UniswapV3Pool: {
			chain: mainnet.name,
			abi: UniswapV3PoolABI,
			address: addr[mainnet.id].uniswapPoolV3ZCHFUSDT,
			startBlock: block[mainnet.id].uniswapPoolV3ZCHFUSDT,
		},

		ERC20: {
			abi: erc20Abi,
			chain: {
				[mainnet.name]: {
					address: [addr[mainnet.id].frankencoin, addr[mainnet.id].equity, addr[mainnet.id].fcs],
					startBlock: block[mainnet.id].frankencoin,
				},
				[polygon.name]: {
					address: [addr[polygon.id].ccipBridgedFrankencoin],
					startBlock: block[polygon.id].ccipBridgedFrankencoin,
				},
				[arbitrum.name]: {
					address: [addr[arbitrum.id].ccipBridgedFrankencoin],
					startBlock: block[arbitrum.id].ccipBridgedFrankencoin,
				},
				[optimism.name]: {
					address: [addr[optimism.id].ccipBridgedFrankencoin],
					startBlock: block[optimism.id].ccipBridgedFrankencoin,
				},
				[base.name]: {
					address: [addr[base.id].ccipBridgedFrankencoin],
					startBlock: block[base.id].ccipBridgedFrankencoin,
				},
				[avalanche.name]: {
					address: [addr[avalanche.id].ccipBridgedFrankencoin],
					startBlock: block[avalanche.id].ccipBridgedFrankencoin,
				},
				[gnosis.name]: {
					address: [addr[gnosis.id].ccipBridgedFrankencoin],
					startBlock: block[gnosis.id].ccipBridgedFrankencoin,
				},
				[sonic.name]: {
					address: [addr[sonic.id].ccipBridgedFrankencoin],
					startBlock: block[sonic.id].ccipBridgedFrankencoin,
				},
			},
		},

		// ### CROSS CHAIN SUPPORT ###

		CCIPAdmin: {
			abi: CCIPAdminABI,
			chain: {
				[mainnet.name]: {
					address: addr[mainnet.id].ccipAdmin,
					startBlock: block[mainnet.id].ccipAdmin,
				},
				[polygon.name]: {
					address: addr[polygon.id].ccipAdmin,
					startBlock: block[polygon.id].ccipBridgedFrankencoin,
				},
				[arbitrum.name]: {
					address: addr[arbitrum.id].ccipAdmin,
					startBlock: block[arbitrum.id].ccipBridgedFrankencoin,
				},
				[optimism.name]: {
					address: addr[optimism.id].ccipAdmin,
					startBlock: block[optimism.id].ccipBridgedFrankencoin,
				},
				[base.name]: {
					address: addr[base.id].ccipAdmin,
					startBlock: block[base.id].ccipBridgedFrankencoin,
				},
				[avalanche.name]: {
					address: addr[avalanche.id].ccipAdmin,
					startBlock: block[avalanche.id].ccipBridgedFrankencoin,
				},
				[gnosis.name]: {
					address: addr[gnosis.id].ccipAdmin,
					startBlock: block[gnosis.id].ccipBridgedFrankencoin,
				},
				[sonic.name]: {
					address: addr[sonic.id].ccipAdmin,
					startBlock: block[sonic.id].ccipBridgedFrankencoin,
				},
			},
		},

		// Note: MainnetVotes/BridgedVotes break this section's usual "all-multichain-map" pattern —
		// MainnetVotes is single-instance mainnet-only (like Equity/FCS above), and BridgedVotes is the
		// first contract in this codebase deployed on the 7 L2s with mainnet deliberately excluded.
		MainnetVotes: {
			// mainnet-only, single instance, CCIPSender (auto-deployed by FCS's constructor)
			chain: mainnet.name,
			abi: MainnetVotesABI,
			address: addr[mainnet.id].mainnetVotes,
			startBlock: block[mainnet.id].mainnetVotes,
		},

		BridgedVotes: {
			// one instance per L2 (7 chains — NOT mainnet), CCIPReceiver
			abi: BridgedVotesABI,
			chain: {
				[polygon.name]: {
					address: addr[polygon.id].bridgedVotes,
					startBlock: block[polygon.id].bridgedVotes,
				},
				[arbitrum.name]: {
					address: addr[arbitrum.id].bridgedVotes,
					startBlock: block[arbitrum.id].bridgedVotes,
				},
				[optimism.name]: {
					address: addr[optimism.id].bridgedVotes,
					startBlock: block[optimism.id].bridgedVotes,
				},
				[base.name]: {
					address: addr[base.id].bridgedVotes,
					startBlock: block[base.id].bridgedVotes,
				},
				[avalanche.name]: {
					address: addr[avalanche.id].bridgedVotes,
					startBlock: block[avalanche.id].bridgedVotes,
				},
				[gnosis.name]: {
					address: addr[gnosis.id].bridgedVotes,
					startBlock: block[gnosis.id].bridgedVotes,
				},
				[sonic.name]: {
					address: addr[sonic.id].bridgedVotes,
					startBlock: block[sonic.id].bridgedVotes,
				},
				// no [mainnet.name] entry — BridgedVotes is not deployed on mainnet, see MainnetVotes above
			},
		},

		CCIPBridgedAccounting: {
			abi: BridgeAccountingABI,
			chain: mainnet.name,
			address: addr[mainnet.id].ccipBridgeAccounting,
			startBlock: block[mainnet.id].ccipBridgeAccounting,
		},

		TransferReference: {
			abi: mergeAbis([TransferReferenceABI, CrossChainReferenceABI]),
			chain: {
				[mainnet.name]: {
					address: [addr[mainnet.id].transferReference],
					startBlock: block[mainnet.id].transferReference,
				},
				[polygon.name]: {
					address: [addr[polygon.id].ccipBridgedFrankencoin],
					startBlock: block[polygon.id].ccipBridgedFrankencoin,
				},
				[arbitrum.name]: {
					address: [addr[arbitrum.id].ccipBridgedFrankencoin],
					startBlock: block[arbitrum.id].ccipBridgedFrankencoin,
				},
				[optimism.name]: {
					address: [addr[optimism.id].ccipBridgedFrankencoin],
					startBlock: block[optimism.id].ccipBridgedFrankencoin,
				},
				[base.name]: {
					address: [addr[base.id].ccipBridgedFrankencoin],
					startBlock: block[base.id].ccipBridgedFrankencoin,
				},
				[avalanche.name]: {
					address: [addr[avalanche.id].ccipBridgedFrankencoin],
					startBlock: block[avalanche.id].ccipBridgedFrankencoin,
				},
				[gnosis.name]: {
					address: [addr[gnosis.id].ccipBridgedFrankencoin],
					startBlock: block[gnosis.id].ccipBridgedFrankencoin,
				},
				[sonic.name]: {
					address: [addr[sonic.id].ccipBridgedFrankencoin],
					startBlock: block[sonic.id].ccipBridgedFrankencoin,
				},
			},
		},
	},
});
