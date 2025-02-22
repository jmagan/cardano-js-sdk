import { Cardano, ChainHistoryProvider, EraSummary, SlotEpochCalc, createSlotEpochCalc } from '@cardano-sdk/core';
import { DelegationTracker, TransactionsTracker } from '../types';
import { Logger } from 'ts-log';
import { Observable, combineLatest, map, tap } from 'rxjs';
import {
  ObservableRewardsProvider,
  ObservableStakePoolProvider,
  createQueryStakePoolsProvider,
  createRewardAccountsTracker,
  createRewardsProvider
} from './RewardAccounts';
import { RetryBackoffConfig } from 'backoff-rxjs';
import { RewardsHistoryProvider, createRewardsHistoryProvider, createRewardsHistoryTracker } from './RewardsHistory';
import { Shutdown, contextLogger } from '@cardano-sdk/util';
import { TrackedRewardsProvider, TrackedStakePoolProvider } from '../ProviderTracker';
import { TrackerSubject } from '@cardano-sdk/util-rxjs';
import { TxWithEpoch } from './types';
import { WalletStores } from '../../persistence';
import { coldObservableProvider } from '../util';
import { transactionsWithCertificates } from './transactionCertificates';

export const createBlockEpochProvider =
  (chainHistoryProvider: ChainHistoryProvider, retryBackoffConfig: RetryBackoffConfig) => (ids: Cardano.BlockId[]) =>
    coldObservableProvider({
      provider: () => chainHistoryProvider.blocksByHashes({ ids }),
      retryBackoffConfig
    }).pipe(map((blocks) => blocks.map(({ epoch }) => epoch)));

export type BlockEpochProvider = ReturnType<typeof createBlockEpochProvider>;

export interface DelegationTrackerProps {
  rewardsTracker: TrackedRewardsProvider;
  rewardAccountAddresses$: Observable<Cardano.RewardAccount[]>;
  stakePoolProvider: TrackedStakePoolProvider;
  eraSummaries$: Observable<EraSummary[]>;
  epoch$: Observable<Cardano.EpochNo>;
  transactionsTracker: TransactionsTracker;
  retryBackoffConfig: RetryBackoffConfig;
  stores: WalletStores;
  internals?: {
    queryStakePoolsProvider?: ObservableStakePoolProvider;
    rewardsProvider?: ObservableRewardsProvider;
    rewardsHistoryProvider?: RewardsHistoryProvider;
    slotEpochCalc$?: Observable<SlotEpochCalc>;
  };
  logger: Logger;
}

export const certificateTransactionsWithEpochs = (
  transactionsTracker: TransactionsTracker,
  rewardAccountAddresses$: Observable<Cardano.RewardAccount[]>,
  slotEpochCalc$: Observable<SlotEpochCalc>,
  certificateTypes: Cardano.CertificateType[]
): Observable<TxWithEpoch[]> =>
  combineLatest([
    transactionsWithCertificates(transactionsTracker.history$, rewardAccountAddresses$, certificateTypes),
    slotEpochCalc$
  ]).pipe(
    map(([transactions, slotEpochCalc]) =>
      transactions.map((tx) => ({ epoch: slotEpochCalc(tx.blockHeader.slot), tx }))
    )
  );

export const createDelegationTracker = ({
  rewardAccountAddresses$,
  epoch$,
  rewardsTracker,
  retryBackoffConfig,
  transactionsTracker,
  eraSummaries$,
  stakePoolProvider,
  stores,
  logger,
  internals: {
    queryStakePoolsProvider = createQueryStakePoolsProvider(stakePoolProvider, stores.stakePools, retryBackoffConfig),
    rewardsHistoryProvider = createRewardsHistoryProvider(rewardsTracker, retryBackoffConfig),
    rewardsProvider = createRewardsProvider(
      epoch$,
      transactionsTracker.outgoing.confirmed$,
      rewardsTracker,
      retryBackoffConfig
    ),
    slotEpochCalc$ = eraSummaries$.pipe(map((eraSummaries) => createSlotEpochCalc(eraSummaries)))
  } = {}
}: DelegationTrackerProps): DelegationTracker & Shutdown => {
  const transactions$ = certificateTransactionsWithEpochs(
    transactionsTracker,
    rewardAccountAddresses$,
    slotEpochCalc$,
    [
      Cardano.CertificateType.StakeDelegation,
      Cardano.CertificateType.StakeKeyRegistration,
      Cardano.CertificateType.StakeKeyDeregistration
    ]
  ).pipe(tap((transactionsWithEpochs) => logger.debug(`Found ${transactionsWithEpochs.length} staking transactions`)));
  const rewardsHistory$ = new TrackerSubject(
    createRewardsHistoryTracker(
      transactions$,
      rewardAccountAddresses$,
      rewardsHistoryProvider,
      stores.rewardsHistory,
      contextLogger(logger, 'rewardsHistory$')
    )
  );
  const rewardAccounts$ = new TrackerSubject(
    createRewardAccountsTracker({
      balancesStore: stores.rewardsBalances,
      epoch$,
      rewardAccountAddresses$,
      rewardsProvider,
      stakePoolProvider: queryStakePoolsProvider,
      transactions$,
      transactionsInFlight$: transactionsTracker.outgoing.inFlight$
    })
  );
  return {
    rewardAccounts$,
    rewardsHistory$,
    shutdown: () => {
      rewardAccounts$.complete();
      rewardsHistory$.complete();
      logger.debug('Shutdown');
    }
  };
};
