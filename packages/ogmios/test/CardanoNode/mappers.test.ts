import * as mappers from '../../src/CardanoNode/mappers';
import { EraSummary } from '@cardano-sdk/core';
import { Schema } from '@cardano-ogmios/client';

describe('cardano node mappers', () => {
  describe('mapEraSummary', () => {
    const eraSummary: Schema.EraSummary = {
      end: { epoch: 102, slot: 13_694_400, time: 44_064_000 },
      parameters: { epochLength: 432_000, safeZone: 129_600, slotLength: 1 },
      start: { epoch: 74, slot: 1_598_400, time: 31_968_000 }
    };
    it('maps ogmios EraSummary to core EraSummary', () => {
      const result = mappers.mapEraSummary(eraSummary, new Date(1_506_203_091_000));
      expect(result).toEqual<EraSummary>({
        parameters: {
          epochLength: 432_000,
          slotLength: 1000
        },
        start: {
          slot: 1_598_400,
          time: new Date(new Date(1_506_203_091_000).getTime() + 31_968_000 * 1000)
        }
      });
    });
  });
});
