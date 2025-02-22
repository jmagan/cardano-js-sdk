/* eslint-disable sonarjs/no-identical-functions */
/* eslint-disable @typescript-eslint/no-empty-function */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable sonarjs/no-duplicate-string */
/* eslint-disable max-len */
import { Cardano, TxSubmitProvider } from '@cardano-sdk/core';
import { Connection } from '@cardano-ogmios/client';
import {
  HttpServer,
  HttpServerConfig,
  RunningTxSubmitWorker,
  TxSubmitHttpService,
  createDnsResolver,
  getOgmiosTxSubmitProvider,
  getRabbitMqTxSubmitProvider,
  getRunningTxSubmitWorker,
  loadAndStartTxWorker,
  startTxSubmitWorkerWithDiscovery
} from '../../../src';
import { Ogmios } from '@cardano-sdk/ogmios';
import { RabbitMQContainer } from '../../TxSubmit/rabbitmq/docker';
import { SrvRecord } from 'dns';
import { bufferToHexString } from '@cardano-sdk/util';
import { createLogger } from 'bunyan';
import { createMockOgmiosServer } from '../../../../ogmios/test/mocks/mockOgmiosServer';
import { dummyLogger } from 'ts-log';
import { getPort, getRandomPort } from 'get-port-please';
import { listenPromise, serverClosePromise } from '../../../src/util';
import { ogmiosServerReady } from '../../util';
import { txsPromise } from '../../TxSubmit/rabbitmq/utils';
import { types } from 'util';
import axios from 'axios';
import http from 'http';

const flushPromises = () => new Promise((resolve) => setImmediate(resolve));

let rabbitmqPort: number;
let rabbitmqUrl: URL;

jest.mock('dns', () => ({
  promises: {
    resolveSrv: async (serviceName: string): Promise<SrvRecord[]> => {
      if (serviceName === process.env.OGMIOS_SRV_SERVICE_NAME)
        return [{ name: 'localhost', port: 1337, priority: 6, weight: 5 }];
      if (serviceName === process.env.RABBITMQ_SRV_SERVICE_NAME)
        return [{ name: 'localhost', port: rabbitmqPort, priority: 6, weight: 5 }];
      return [];
    }
  }
}));

describe('Program/services/rabbitmq', () => {
  describe('http-server', () => {
    const APPLICATION_JSON = 'application/json';
    const container = new RabbitMQContainer();
    const logger = dummyLogger;
    const dnsResolver = createDnsResolver({ factor: 1.1, maxRetryTime: 1000 }, logger);

    beforeAll(async () => ({ rabbitmqPort, rabbitmqUrl } = await container.load()));

    describe('RabbitMQ-dependant service with service discovery', () => {
      let apiUrlBase: string;
      let txSubmitProvider: TxSubmitProvider;
      let httpServer: HttpServer;
      let port: number;
      let config: HttpServerConfig;

      describe('Established connection', () => {
        beforeAll(async () => {
          port = await getPort();
          apiUrlBase = `http://localhost:${port}/tx-submit`;
          config = { listen: { port } };
          txSubmitProvider = await getRabbitMqTxSubmitProvider(dnsResolver, logger, {
            rabbitmqSrvServiceName: process.env.RABBITMQ_SRV_SERVICE_NAME,
            serviceDiscoveryBackoffFactor: 1.1,
            serviceDiscoveryTimeout: 1000
          });
          httpServer = new HttpServer(config, {
            logger,
            services: [new TxSubmitHttpService({ logger, txSubmitProvider })]
          });
          await httpServer.initialize();
          await httpServer.start();
        });

        afterAll(async () => {
          await httpServer.shutdown();
        });

        it('txSubmitProvider should be instance of a Proxy ', () => {
          expect(types.isProxy(txSubmitProvider)).toEqual(true);
        });

        it('forwards the txSubmitProvider health response', async () => {
          const res = await axios.post(`${apiUrlBase}/health`, {
            headers: { 'Content-Type': APPLICATION_JSON }
          });
          expect(res.status).toBe(200);
          expect(res.data).toEqual({ ok: true });
        });
      });
    });

    describe('RabbitMQ-dependant service with static config', () => {
      let apiUrlBase: string;
      let txSubmitProvider: TxSubmitProvider;
      let httpServer: HttpServer;
      let port: number;
      let config: HttpServerConfig;

      describe('Established connection', () => {
        beforeAll(async () => {
          port = await getPort();
          apiUrlBase = `http://localhost:${port}/tx-submit`;
          config = { listen: { port } };
          txSubmitProvider = await getRabbitMqTxSubmitProvider(dnsResolver, logger, { rabbitmqUrl });
          httpServer = new HttpServer(config, {
            logger,
            services: [new TxSubmitHttpService({ logger, txSubmitProvider })]
          });
          await httpServer.initialize();
          await httpServer.start();
        });

        afterAll(async () => {
          await httpServer.shutdown();
        });

        it('txSubmitProvider should not be a instance of Proxy ', () => {
          expect(types.isProxy(txSubmitProvider)).toEqual(false);
        });

        it('forwards the txSubmitProvider health response', async () => {
          const res = await axios.post(`${apiUrlBase}/health`, {
            headers: { 'Content-Type': APPLICATION_JSON }
          });
          expect(res.status).toBe(200);
          expect(res.data).toEqual({ ok: true });
        });
      });
    });

    describe('TxSubmitProvider with service discovery and RabbitMQ server failover', () => {
      let mockServer: http.Server;
      let connection: Connection;
      let provider: TxSubmitProvider;
      let txSubmitWorker: RunningTxSubmitWorker;
      const ogmiosPortDefault = 1337;

      beforeEach(async () => {
        connection = Ogmios.createConnectionObject({ port: ogmiosPortDefault });
        // Setup working a default Ogmios with submitTx operation throwing a non-connection error
        mockServer = createMockOgmiosServer({
          healthCheck: { response: { networkSynchronization: 0.999, success: true } },
          submitTx: { response: { failWith: { type: 'eraMismatch' }, success: false } }
        });
        await listenPromise(mockServer, connection);
        await ogmiosServerReady(connection);

        txSubmitWorker = await loadAndStartTxWorker(
          {
            options: {
              loggerMinSeverity: 'error',
              ogmiosSrvServiceName: process.env.OGMIOS_SRV_SERVICE_NAME,
              parallel: true,
              rabbitmqSrvServiceName: process.env.RABBITMQ_SRV_SERVICE_NAME,
              serviceDiscoveryBackoffFactor: 1.1,
              serviceDiscoveryTimeout: 1000
            }
          },
          logger
        );
      });

      afterEach(async () => {
        if (mockServer !== undefined) {
          await serverClosePromise(mockServer);
        }
        if (txSubmitWorker !== undefined) {
          await txSubmitWorker.stop();
        }
      });

      it('should initially fail with a connection error, then re-resolve the port and propagate the correct non-connection error to the caller', async () => {
        const srvRecord = { name: 'localhost', port: rabbitmqPort, priority: 1, weight: 1 };
        const failingRabbitMqMockPort = await getRandomPort();
        let resolverAlreadyCalled = false;

        // Initially resolves with a failing rabbitmq port, then swap to the default one
        const dnsResolverMock = jest.fn().mockImplementation(async () => {
          if (!resolverAlreadyCalled) {
            resolverAlreadyCalled = true;
            return { ...srvRecord, port: failingRabbitMqMockPort };
          }
          return srvRecord;
        });

        provider = await getRabbitMqTxSubmitProvider(dnsResolverMock, logger, {
          rabbitmqSrvServiceName: process.env.RABBITMQ_SRV_SERVICE_NAME!,
          serviceDiscoveryBackoffFactor: 1.1,
          serviceDiscoveryTimeout: 1000
        });

        const txs = await txsPromise;
        await expect(
          provider.submitTx({ signedTransaction: bufferToHexString(Buffer.from(txs[0].txBodyUint8Array)) })
        ).rejects.toBeInstanceOf(Cardano.TxSubmissionErrors.EraMismatchError);
        expect(dnsResolverMock).toBeCalledTimes(2);
      });

      it('should execute a provider operation without to intercept it', async () => {
        provider = await getRabbitMqTxSubmitProvider(dnsResolver, logger, {
          rabbitmqSrvServiceName: process.env.RABBITMQ_SRV_SERVICE_NAME,
          serviceDiscoveryBackoffFactor: 1.1,
          serviceDiscoveryTimeout: 1000
        });

        await expect(provider.healthCheck()).resolves.toEqual({ ok: true });
      });
      ('');
    });
  });

  describe('tx-worker', () => {
    const logger = createLogger({ level: 'error', name: 'test' });

    beforeAll(async () => {
      const container = new RabbitMQContainer();

      ({ rabbitmqPort, rabbitmqUrl } = await container.load());
    });

    describe('getRunningTxSubmitWorker', () => {
      let mockServer: http.Server;
      let connection: Connection;
      let txSubmitWorker: RunningTxSubmitWorker;
      let txSubmitProvider: TxSubmitProvider;
      const ogmiosPortDefault = 1337;
      const dnsResolver = createDnsResolver({ factor: 1.1, maxRetryTime: 1000 }, logger);

      beforeEach(async () => {
        connection = Ogmios.createConnectionObject({ port: ogmiosPortDefault });
        mockServer = createMockOgmiosServer({
          healthCheck: { response: { networkSynchronization: 0.999, success: true } }
        });
        await listenPromise(mockServer, connection);
        await ogmiosServerReady(connection);
      });

      afterEach(async () => {
        if (mockServer !== undefined) {
          await serverClosePromise(mockServer);
        }

        await txSubmitWorker.stop();
      });

      it('should instantiate a running worker without service discovery', async () => {
        const dnsResolverMock = jest.fn();

        txSubmitProvider = await getOgmiosTxSubmitProvider(dnsResolver, logger, {
          ogmiosUrl: new URL(connection.address.webSocket)
        });

        txSubmitWorker = await getRunningTxSubmitWorker(dnsResolverMock, txSubmitProvider, logger, { rabbitmqUrl });

        expect(dnsResolverMock).toBeCalledTimes(0);
        expect(txSubmitWorker.getStatus()).toEqual('connected');
      });

      it('should instantiate a running worker with service discovery', async () => {
        const srvRecord = { name: 'localhost', port: rabbitmqPort, priority: 1, weight: 1 };
        const dnsResolverMock = jest.fn().mockResolvedValueOnce(srvRecord);
        txSubmitProvider = await getOgmiosTxSubmitProvider(dnsResolver, logger, {
          ogmiosSrvServiceName: process.env.OGMIOS_SRV_SERVICE_NAME,
          serviceDiscoveryBackoffFactor: 1.1,
          serviceDiscoveryTimeout: 1000
        });

        txSubmitWorker = await getRunningTxSubmitWorker(dnsResolverMock, txSubmitProvider, logger, {
          rabbitmqSrvServiceName: process.env.RABBITMQ_SRV_SERVICE_NAME,
          serviceDiscoveryBackoffFactor: 1.1,
          serviceDiscoveryTimeout: 1000
        });

        expect(dnsResolverMock).toBeCalledTimes(1);
        expect(txSubmitWorker.getStatus()).toEqual('connected');
      });
    });

    describe('startTxSubmitWorkerWithDiscovery', () => {
      it('returns a started worker, which can then be stopped', async () => {
        const start = jest.fn().mockResolvedValueOnce(void 0);
        const stop = jest.fn().mockResolvedValueOnce(void 0);
        const workerFactory = jest.fn().mockImplementation(async () => ({
          on(_: string, __: any) {},
          start,
          stop
        }));

        const runnableWorker = await startTxSubmitWorkerWithDiscovery(workerFactory);
        await runnableWorker.stop();

        expect(start).toBeCalledTimes(1);
        expect(stop).toBeCalledTimes(1);
        expect(workerFactory).toBeCalledTimes(1);
      });

      it('should create and start a new instance of TxSubmitWorker when a broker connection error event is received', async () => {
        let simulateConnectionError: any = jest.fn();
        const firstStart = jest.fn().mockResolvedValueOnce(void 0);
        const secondStart = jest.fn().mockResolvedValueOnce(void 0);
        const workerFactory = jest
          .fn()
          .mockImplementationOnce(async () => ({
            on(_: string, listener: any) {
              simulateConnectionError = listener;
            },
            start: firstStart
          }))
          .mockImplementationOnce(async () => ({
            on(__: string, ___: any) {},
            start: secondStart
          }));

        await startTxSubmitWorkerWithDiscovery(workerFactory);

        expect(firstStart).toBeCalledTimes(1);
        expect(workerFactory).toBeCalledTimes(1);

        simulateConnectionError();
        await flushPromises();

        expect(secondStart).toBeCalledTimes(1);
        expect(workerFactory).toBeCalledTimes(2);
      });
    });

    it('should stop the correct worker instance when a broker connection error event is received', async () => {
      let simulateConnectionError: any = jest.fn();
      const stopSecondWorker = jest.fn().mockResolvedValueOnce(void 0);
      const workerFactory = jest
        .fn()
        .mockImplementationOnce(async () => ({
          on(_: string, listener: any) {
            simulateConnectionError = listener;
          },
          start: jest.fn().mockResolvedValueOnce(void 0)
        }))
        .mockImplementationOnce(async () => ({
          on(__: string, ___: any) {},
          start: jest.fn().mockResolvedValueOnce(void 0),
          stop: stopSecondWorker
        }));

      const runningTxSubmitWorker = await startTxSubmitWorkerWithDiscovery(workerFactory);

      simulateConnectionError();
      await flushPromises();

      expect(stopSecondWorker).toBeCalledTimes(0);

      await runningTxSubmitWorker.stop();
      expect(stopSecondWorker).toBeCalledTimes(1);
      expect(workerFactory).toBeCalledTimes(2);
    });
  });
});
