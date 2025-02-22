import { Cardano } from '@cardano-sdk/core';

export interface CirculatingSupplyModel {
  circulating_supply: string;
}

export interface TotalSupplyModel {
  total_supply: string;
}

export interface ActiveStakeModel {
  active_stake: string;
}

export interface LiveStakeModel {
  live_stake: string;
}

export interface EpochModel {
  no: number;
}

export interface LedgerTipModel {
  block_no: number;
  slot_no: string;
  hash: Buffer;
}

export interface WalletProtocolParamsModel {
  coins_per_utxo_size: string;
  max_tx_size: number;
  max_val_size: string;
  min_pool_cost: string;
  key_deposit: string;
  pool_deposit: string;
  protocol_major: number;
  protocol_minor: number;
  min_fee_a: number;
  min_fee_b: number;
  max_collateral_inputs: number;
  max_block_size: number;
  max_bh_size: number;
  optimal_pool_count: number;
  influence: number;
  monetary_expand_rate: number;
  treasury_growth_rate: number;
  decentralisation: number;
  collateral_percent: number;
  price_mem: number;
  price_step: number;
  max_tx_ex_mem: string;
  max_tx_ex_steps: string;
  max_block_ex_mem: string;
  max_block_ex_steps: string;
  max_epoch: number;
}

export interface GenesisData {
  networkMagic: Cardano.CardanoNetworkMagic;
  networkId: Cardano.CardanoNetworkId;
  maxLovelaceSupply: Cardano.Lovelace;
  activeSlotsCoefficient: number;
  securityParameter: number;
  systemStart: string;
  epochLength: number;
  slotsPerKesPeriod: number;
  maxKesEvolutions: number;
  slotLength: number;
  updateQuorum: number;
}
