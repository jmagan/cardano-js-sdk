import { CommonProgramOptions } from '../ProgramsCommon';
import { TxSubmitWorker, TxSubmitWorkerConfig } from '@cardano-sdk/rabbitmq';
import { createDnsResolver, getOgmiosTxSubmitProvider, getRabbitMqUrl } from '../Program';
import { createLogger } from 'bunyan';

export type TxWorkerOptions = CommonProgramOptions &
  Pick<TxSubmitWorkerConfig, 'parallel' | 'parallelTxs' | 'pollingCycle'>;

export interface TxWorkerArgs {
  options: TxWorkerOptions;
}

export const loadTxWorker = async (args: TxWorkerArgs) => {
  const { loggerMinSeverity, serviceDiscoveryBackoffFactor, serviceDiscoveryTimeout } = args.options;
  const logger = createLogger({ level: loggerMinSeverity, name: 'tx-worker' });
  const dnsResolver = createDnsResolver(
    {
      factor: serviceDiscoveryBackoffFactor,
      maxRetryTime: serviceDiscoveryTimeout
    },
    logger
  );
  const txSubmitProvider = await getOgmiosTxSubmitProvider(dnsResolver, args.options);
  const url = await getRabbitMqUrl(dnsResolver, args.options);

  return new TxSubmitWorker({ ...args.options, rabbitmqUrl: url }, { logger, txSubmitProvider });
};
