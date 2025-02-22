/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  AssetProvider,
  ChainHistoryProvider,
  NetworkInfoProvider,
  ProviderFactory,
  RewardsProvider,
  StakePoolProvider,
  TxSubmitProvider,
  UtxoProvider
} from '@cardano-sdk/core';
import {
  AsyncKeyAgent,
  CommunicationType,
  InMemoryKeyAgent,
  KeyAgentDependencies,
  LedgerKeyAgent,
  TrezorKeyAgent,
  util
} from '@cardano-sdk/key-management';
import {
  BlockFrostAPI,
  blockfrostAssetProvider,
  blockfrostChainHistoryProvider,
  blockfrostNetworkInfoProvider,
  blockfrostRewardsProvider,
  blockfrostTxSubmitProvider,
  blockfrostUtxoProvider
} from '@cardano-sdk/blockfrost';
import { CardanoWalletFaucetProvider, FaucetProvider } from './FaucetProvider';
import { LogLevel, createLogger } from 'bunyan';
import { Logger, dummyLogger } from 'ts-log';
import { PollingConfig, SingleAddressWallet, setupWallet, storage } from '@cardano-sdk/wallet';
import {
  assetInfoHttpProvider,
  chainHistoryHttpProvider,
  networkInfoHttpProvider,
  rewardsHttpProvider,
  stakePoolHttpProvider,
  txSubmitHttpProvider,
  utxoHttpProvider
} from '@cardano-sdk/cardano-services-client';
import { createConnectionObject } from '@cardano-ogmios/client';
import { createStubStakePoolProvider } from '@cardano-sdk/util-dev';
import { ogmiosTxSubmitProvider } from '@cardano-sdk/ogmios';
import DeviceConnection from '@cardano-foundation/ledgerjs-hw-app-cardano';
import memoize from 'lodash/memoize';

// CONSTANTS
const BLOCKFROST_PROVIDER = 'blockfrost';
const BLOCKFROST_MISSING_PROJECT_ID = 'Missing project id';
const HTTP_PROVIDER = 'http';
const OGMIOS_PROVIDER = 'ogmios';
const STUB_PROVIDER = 'stub';
const KEY_AGENT_MISSING_PASSWORD = 'Missing wallet password';
const KEY_AGENT_MISSING_NETWORK_ID = 'Missing network id';
const KEY_AGENT_MISSING_ACCOUNT_INDEX = 'Missing account index';
const MISSING_URL_PARAM = 'Missing URL';

// Sharing a single BlockFrostAPI object ensures rate limiting is shared across all blockfrost providers
let blockfrostApi: BlockFrostAPI;

/**
 * Gets the singleton blockfrost API instance.
 *
 * @returns The blockfrost API instance, this function always returns the same instance.
 */
const getBlockfrostApi = async () => {
  if (blockfrostApi !== undefined) return blockfrostApi;

  if (process.env.BLOCKFROST_API_KEY === undefined) throw new Error(BLOCKFROST_MISSING_PROJECT_ID);

  return new BlockFrostAPI({ isTestnet: true, projectId: process.env.BLOCKFROST_API_KEY });
};

export const faucetProviderFactory = new ProviderFactory<FaucetProvider>();
export type CreateKeyAgent = (dependencies: KeyAgentDependencies) => Promise<AsyncKeyAgent>;
export const keyManagementFactory = new ProviderFactory<CreateKeyAgent>();
export const assetProviderFactory = new ProviderFactory<AssetProvider>();
export const chainHistoryProviderFactory = new ProviderFactory<ChainHistoryProvider>();
export const networkInfoProviderFactory = new ProviderFactory<NetworkInfoProvider>();
export const rewardsProviderFactory = new ProviderFactory<RewardsProvider>();
export const txSubmitProviderFactory = new ProviderFactory<TxSubmitProvider>();
export const utxoProviderFactory = new ProviderFactory<UtxoProvider>();
export const stakePoolProviderFactory = new ProviderFactory<StakePoolProvider>();

// Faucet providers
faucetProviderFactory.register('cardano-wallet', CardanoWalletFaucetProvider.create);

// Asset providers

assetProviderFactory.register(HTTP_PROVIDER, async (params: any, logger: Logger): Promise<AssetProvider> => {
  if (params.baseUrl === undefined) throw new Error(`${assetInfoHttpProvider.name}: ${MISSING_URL_PARAM}`);

  return new Promise<AssetProvider>(async (resolve) => {
    resolve(assetInfoHttpProvider({ baseUrl: params.baseUrl, logger }));
  });
});

assetProviderFactory.register(
  BLOCKFROST_PROVIDER,
  async (): Promise<AssetProvider> =>
    new Promise<AssetProvider>(async (resolve) => {
      resolve(blockfrostAssetProvider(await getBlockfrostApi()));
    })
);

// Chain history providers
chainHistoryProviderFactory.register(
  BLOCKFROST_PROVIDER,
  async (_params: any, logger: Logger): Promise<ChainHistoryProvider> =>
    new Promise<ChainHistoryProvider>(async (resolve) => {
      resolve(blockfrostChainHistoryProvider(await getBlockfrostApi(), logger));
    })
);

chainHistoryProviderFactory.register(
  HTTP_PROVIDER,
  async (params: any, logger: Logger): Promise<ChainHistoryProvider> => {
    if (params.baseUrl === undefined) throw new Error(`${chainHistoryHttpProvider.name}: ${MISSING_URL_PARAM}`);

    return new Promise<ChainHistoryProvider>(async (resolve) => {
      resolve(chainHistoryHttpProvider({ baseUrl: params.baseUrl, logger }));
    });
  }
);

// Network info providers
networkInfoProviderFactory.register(
  BLOCKFROST_PROVIDER,
  async (): Promise<NetworkInfoProvider> =>
    new Promise<NetworkInfoProvider>(async (resolve) => {
      resolve(blockfrostNetworkInfoProvider(await getBlockfrostApi()));
    })
);

networkInfoProviderFactory.register(
  HTTP_PROVIDER,
  async (params: any, logger: Logger): Promise<NetworkInfoProvider> => {
    if (params.baseUrl === undefined) throw new Error(`${networkInfoHttpProvider.name}: ${MISSING_URL_PARAM}`);

    return new Promise<NetworkInfoProvider>(async (resolve) => {
      resolve(networkInfoHttpProvider({ baseUrl: params.baseUrl, logger }));
    });
  }
);

// Rewards providers
rewardsProviderFactory.register(
  BLOCKFROST_PROVIDER,
  async (): Promise<RewardsProvider> =>
    new Promise<RewardsProvider>(async (resolve) => {
      resolve(blockfrostRewardsProvider(await getBlockfrostApi()));
    })
);

rewardsProviderFactory.register(HTTP_PROVIDER, async (params: any, logger: Logger): Promise<RewardsProvider> => {
  if (params.baseUrl === undefined) throw new Error(`${rewardsHttpProvider.name}: ${MISSING_URL_PARAM}`);

  return new Promise<RewardsProvider>(async (resolve) => {
    resolve(rewardsHttpProvider({ baseUrl: params.baseUrl, logger }));
  });
});

// Tx submit providers
txSubmitProviderFactory.register(
  BLOCKFROST_PROVIDER,
  async (): Promise<TxSubmitProvider> =>
    new Promise<TxSubmitProvider>(async (resolve) => {
      resolve(blockfrostTxSubmitProvider(await getBlockfrostApi()));
    })
);

txSubmitProviderFactory.register(OGMIOS_PROVIDER, async (params: any, logger: Logger): Promise<TxSubmitProvider> => {
  if (params.baseUrl === undefined) throw new Error(`${ogmiosTxSubmitProvider.name}: ${MISSING_URL_PARAM}`);

  const connectionConfig = {
    host: params.baseUrl.hostname,
    port: params.baseUrl.port ? Number.parseInt(params.baseUrl.port) : undefined,
    tls: params.baseUrl?.protocol === 'wss'
  };

  return new Promise<TxSubmitProvider>(async (resolve) => {
    resolve(ogmiosTxSubmitProvider(createConnectionObject(connectionConfig), logger));
  });
});

txSubmitProviderFactory.register(HTTP_PROVIDER, async (params: any, logger: Logger): Promise<TxSubmitProvider> => {
  if (params.baseUrl === undefined) throw new Error(`${txSubmitHttpProvider.name}: ${MISSING_URL_PARAM}`);

  return new Promise<TxSubmitProvider>(async (resolve) => {
    resolve(txSubmitHttpProvider({ baseUrl: params.baseUrl, logger }));
  });
});

// Utxo providers
utxoProviderFactory.register(
  BLOCKFROST_PROVIDER,
  async (): Promise<UtxoProvider> =>
    new Promise<UtxoProvider>(async (resolve) => {
      resolve(blockfrostUtxoProvider(await getBlockfrostApi()));
    })
);

utxoProviderFactory.register(HTTP_PROVIDER, async (params: any, logger: Logger): Promise<UtxoProvider> => {
  if (params.baseUrl === undefined) throw new Error(`${utxoHttpProvider.name}: ${MISSING_URL_PARAM}`);

  return new Promise<UtxoProvider>(async (resolve) => {
    resolve(utxoHttpProvider({ baseUrl: params.baseUrl, logger }));
  });
});

// Stake Pool providers
stakePoolProviderFactory.register(
  STUB_PROVIDER,
  async (): Promise<StakePoolProvider> =>
    new Promise<StakePoolProvider>(async (resolve) => {
      resolve(createStubStakePoolProvider());
    })
);

stakePoolProviderFactory.register(HTTP_PROVIDER, async (params: any, logger: Logger): Promise<StakePoolProvider> => {
  if (params.baseUrl === undefined) throw new Error(`${stakePoolHttpProvider.name}: ${MISSING_URL_PARAM}`);

  return new Promise<StakePoolProvider>(async (resolve) => {
    resolve(stakePoolHttpProvider({ baseUrl: params.baseUrl, logger }));
  });
});

// Key Agents
keyManagementFactory.register('inMemory', async (params: any): Promise<CreateKeyAgent> => {
  let mnemonicWords = (params?.mnemonic || '').split(' ');

  if (mnemonicWords.length <= 1) mnemonicWords = util.generateMnemonicWords();

  if (params.password === undefined) throw new Error(KEY_AGENT_MISSING_PASSWORD);

  if (params.networkId === undefined) throw new Error(KEY_AGENT_MISSING_NETWORK_ID);

  if (params.accountIndex === undefined) throw new Error(KEY_AGENT_MISSING_ACCOUNT_INDEX);

  return async (dependencies) =>
    util.createAsyncKeyAgent(
      await InMemoryKeyAgent.fromBip39MnemonicWords(
        {
          accountIndex: params.accountIndex,
          getPassword: async () => Buffer.from(params.password),
          mnemonicWords,
          networkId: params.networkId
        },
        dependencies
      )
    );
});

keyManagementFactory.register('ledger', async (params: any): Promise<CreateKeyAgent> => {
  if (params.networkId === undefined) throw new Error(KEY_AGENT_MISSING_NETWORK_ID);

  if (params.accountIndex === undefined) throw new Error(KEY_AGENT_MISSING_ACCOUNT_INDEX);

  let deviceConnection: DeviceConnection | null | undefined;

  return async (dependencies) => {
    const ledgerKeyAgent = await LedgerKeyAgent.createWithDevice(
      {
        accountIndex: params.accountIndex,
        communicationType: CommunicationType.Node,
        deviceConnection,
        networkId: params.networkId,
        protocolMagic: 1_097_911_063
      },
      dependencies
    );

    return util.createAsyncKeyAgent(ledgerKeyAgent);
  };
});

keyManagementFactory.register('trezor', async (params: any): Promise<CreateKeyAgent> => {
  if (params.networkId === undefined) throw new Error(KEY_AGENT_MISSING_NETWORK_ID);

  if (params.accountIndex === undefined) throw new Error(KEY_AGENT_MISSING_ACCOUNT_INDEX);

  return async (dependencies) =>
    util.createAsyncKeyAgent(
      await TrezorKeyAgent.createWithDevice(
        {
          accountIndex: params.accountIndex,
          networkId: params.networkId,
          protocolMagic: 1_097_911_063,
          trezorConfig: {
            communicationType: CommunicationType.Node,
            manifest: {
              appUrl: 'https://your.application.com',
              email: 'email@developer.com'
            }
          }
        },
        dependencies
      )
    );
});

// Logger

/**
 * Gets the logger instance.
 *
 * @param severity The minimum severity of the log messages that will be logged.
 * @returns The Logger instance.
 */
export const getLogger = function (severity: string): Logger {
  return createLogger({
    level: severity as LogLevel,
    name: 'e2e tests'
  });
};

// Wallet

/**
 * Utility function to create key agents at different account indices.
 *
 * @param accountIndex The account index.
 * @param provider The provider.
 * @param params The provider parameters.
 * @returns a key agent.
 */
export const keyAgentById = memoize(async (accountIndex: number, provider: string, params: any) => {
  params.accountIndex = accountIndex;
  return keyManagementFactory.create(provider, params, dummyLogger);
});

export type GetWalletProps = {
  env: any;
  idx?: number;
  logger: Logger;
  name: string;
  polling?: PollingConfig;
  stores?: storage.WalletStores;
};

/**
 * Create a single wallet instance given the environment variables.
 *
 * @param props Wallet configuration parameters.
 * @returns an object containing the wallet and providers passed to it
 */
export const getWallet = async (props: GetWalletProps) => {
  const { env, idx, logger, name, polling, stores } = props;
  const providers = {
    assetProvider: await assetProviderFactory.create(env.ASSET_PROVIDER, env.ASSET_PROVIDER_PARAMS, logger),
    chainHistoryProvider: await chainHistoryProviderFactory.create(
      env.CHAIN_HISTORY_PROVIDER,
      env.CHAIN_HISTORY_PROVIDER_PARAMS,
      logger
    ),
    networkInfoProvider: await networkInfoProviderFactory.create(
      env.NETWORK_INFO_PROVIDER,
      env.NETWORK_INFO_PROVIDER_PARAMS,
      logger
    ),
    rewardsProvider: await rewardsProviderFactory.create(env.REWARDS_PROVIDER, env.REWARDS_PROVIDER_PARAMS, logger),
    stakePoolProvider: await stakePoolProviderFactory.create(
      env.STAKE_POOL_PROVIDER,
      env.STAKE_POOL_PROVIDER_PARAMS,
      logger
    ),
    txSubmitProvider: await txSubmitProviderFactory.create(
      env.TX_SUBMIT_PROVIDER,
      env.TX_SUBMIT_PROVIDER_PARAMS,
      logger
    ),
    utxoProvider: await utxoProviderFactory.create(env.UTXO_PROVIDER, env.UTXO_PROVIDER_PARAMS, logger)
  };
  const keyManagementParams = { ...env.KEY_MANAGEMENT_PARAMS, ...(idx === undefined ? {} : { accountIndex: idx }) };
  const { wallet } = await setupWallet({
    createKeyAgent: await keyManagementFactory.create(env.KEY_MANAGEMENT_PROVIDER, keyManagementParams, logger),
    createWallet: async (keyAgent: AsyncKeyAgent) =>
      new SingleAddressWallet({ name, polling }, { ...providers, keyAgent, logger, stores })
  });

  return { providers, wallet };
};
