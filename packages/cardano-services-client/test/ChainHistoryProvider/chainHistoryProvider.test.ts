/* eslint-disable sonarjs/no-duplicate-string */
import { ProviderFailure } from '@cardano-sdk/core';
import { axiosError } from '../util';
import { chainHistoryHttpProvider } from '../../src';
import { logger } from '@cardano-sdk/util-dev';
import MockAdapter from 'axios-mock-adapter';
import axios from 'axios';

const config = { baseUrl: 'http://some-hostname:3000/history', logger };

describe('chainHistoryProvider', () => {
  describe('healthCheck', () => {
    it('is not ok if cannot connect', async () => {
      const provider = chainHistoryHttpProvider(config);
      await expect(provider.healthCheck()).resolves.toEqual({ ok: false });
    });
  });
  describe('mocked', () => {
    let axiosMock: MockAdapter;
    beforeAll(() => {
      axiosMock = new MockAdapter(axios);
    });

    afterEach(() => {
      axiosMock.reset();
    });

    afterAll(() => {
      axiosMock.restore();
    });
    describe('healthCheck', () => {
      it('is ok if 200 response body is { ok: true }', async () => {
        axiosMock.onPost().replyOnce(200, { ok: true });
        const provider = chainHistoryHttpProvider(config);
        await expect(provider.healthCheck()).resolves.toEqual({ ok: true });
      });

      it('is not ok if 200 response body is { ok: false }', async () => {
        axiosMock.onPost().replyOnce(200, { ok: false });
        const provider = chainHistoryHttpProvider(config);
        await expect(provider.healthCheck()).resolves.toEqual({ ok: false });
      });
    });

    describe('blocks', () => {
      it('resolves if successful', async () => {
        axiosMock.onPost().replyOnce(200, []);
        const provider = chainHistoryHttpProvider(config);
        await expect(provider.blocksByHashes({ ids: [] })).resolves.not.toThrow();
      });

      describe('errors', () => {
        it('maps unknown errors to ProviderFailure', async () => {
          axiosMock.onPost().replyOnce(() => {
            throw axiosError();
          });
          const provider = chainHistoryHttpProvider(config);
          await expect(provider.blocksByHashes({ ids: [] })).rejects.toThrow(ProviderFailure.Unknown);
        });
      });
    });

    describe('transactionsByHashes', () => {
      it('resolves if successful', async () => {
        axiosMock.onPost().replyOnce(200, []);
        const provider = chainHistoryHttpProvider(config);
        await expect(provider.transactionsByHashes({ ids: [] })).resolves.not.toThrow();
      });

      describe('errors', () => {
        it('maps unknown errors to ProviderFailure', async () => {
          axiosMock.onPost().replyOnce(() => {
            throw axiosError();
          });
          const provider = chainHistoryHttpProvider(config);
          await expect(provider.transactionsByHashes({ ids: [] })).rejects.toThrow(ProviderFailure.Unknown);
        });
      });
    });

    describe('transactionsByAddresses', () => {
      it('resolves if successful', async () => {
        axiosMock.onPost().replyOnce(200, []);
        const provider = chainHistoryHttpProvider(config);
        await expect(provider.transactionsByAddresses({ addresses: [] })).resolves.not.toThrow();
      });

      describe('errors', () => {
        it('maps unknown errors to ProviderFailure', async () => {
          axiosMock.onPost().replyOnce(() => {
            throw axiosError();
          });
          const provider = chainHistoryHttpProvider(config);
          await expect(provider.transactionsByAddresses({ addresses: [] })).rejects.toThrow(ProviderFailure.Unknown);
        });
      });
    });
  });
});
