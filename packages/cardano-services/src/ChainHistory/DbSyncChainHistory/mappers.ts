import { Asset, Cardano } from '@cardano-sdk/core';
import { BigIntMath } from '@cardano-sdk/util';
import {
  BlockModel,
  BlockOutputModel,
  CertificateModel,
  MultiAssetModel,
  RedeemerModel,
  TipModel,
  TxInOutModel,
  TxModel,
  TxOutMultiAssetModel,
  TxOutTokenMap,
  TxOutputModel,
  TxTokenMap,
  WithCertIndex,
  WithCertType,
  WithdrawalModel
} from './types';
import {
  isDelegationCertModel,
  isMirCertModel,
  isPoolRegisterCertModel,
  isPoolRetireCertModel,
  isStakeCertModel
} from './util';

const addMultiAssetToTokenMap = (multiAsset: MultiAssetModel, tokenMap: Cardano.TokenMap): Cardano.TokenMap => {
  const tokens = new Map(tokenMap);
  const assetId = Asset.util.assetIdFromPolicyAndName(
    Cardano.PolicyId(multiAsset.policy_id.toString('hex')),
    Cardano.AssetName(multiAsset.asset_name.toString('hex'))
  );
  const currentQuantity = tokens.get(assetId) ?? 0n;
  tokens.set(assetId, BigIntMath.sum([currentQuantity, BigInt(multiAsset.quantity)]));
  return tokens;
};

export const mapTxTokenMap = (multiAssetModels: MultiAssetModel[]): TxTokenMap => {
  const txTokenMap: TxTokenMap = new Map();
  for (const multiAsset of multiAssetModels) {
    const txId = Cardano.TransactionId(multiAsset.tx_id.toString('hex'));
    const currentTokenMap = txTokenMap.get(txId) ?? new Map();
    const tokenMap = addMultiAssetToTokenMap(multiAsset, currentTokenMap);
    txTokenMap.set(txId, tokenMap);
  }
  return txTokenMap;
};

export const mapTxOutTokenMap = (multiAssetModels: TxOutMultiAssetModel[]): TxOutTokenMap => {
  const txTokenMap: TxOutTokenMap = new Map();
  for (const multiAsset of multiAssetModels) {
    const currentTokenMap = txTokenMap.get(multiAsset.tx_out_id) ?? new Map();
    const tokenMap = addMultiAssetToTokenMap(multiAsset, currentTokenMap);
    txTokenMap.set(multiAsset.tx_out_id, tokenMap);
  }
  return txTokenMap;
};

export const mapTxIn = (txInModel: TxInOutModel): Cardano.TxIn => ({
  address: Cardano.Address(txInModel.address),
  index: txInModel.index,
  txId: Cardano.TransactionId(txInModel.tx_id.toString('hex'))
});

export const mapTxOut = (txOutModel: TxInOutModel, assets?: Cardano.TokenMap): TxOutputModel => ({
  address: Cardano.Address(txOutModel.address),
  datum: txOutModel.datum ? Cardano.util.Hash32ByteBase16(txOutModel.datum.toString('hex')) : undefined,
  index: txOutModel.index,
  txId: Cardano.TransactionId(txOutModel.tx_id.toString('hex')),
  value: {
    assets: assets && assets.size > 0 ? assets : undefined,
    coins: BigInt(txOutModel.coin_value)
  }
});

export const mapWithdrawal = (withdrawalModel: WithdrawalModel): Cardano.Withdrawal => ({
  quantity: BigInt(withdrawalModel.quantity),
  stakeAddress: Cardano.RewardAccount(withdrawalModel.stake_address)
});

export const mapRedeemer = (redeemerModel: RedeemerModel): Cardano.Redeemer => ({
  executionUnits: {
    memory: Number(redeemerModel.unit_mem),
    steps: Number(redeemerModel.unit_steps)
  },
  index: redeemerModel.index,
  purpose: redeemerModel.purpose as Cardano.RedeemerPurpose,
  scriptHash: Cardano.util.Hash28ByteBase16(redeemerModel.script_hash.toString('hex'))
});

export const mapCertificate = (
  certModel: WithCertType<CertificateModel>
): WithCertIndex<Cardano.Certificate> | null => {
  if (isPoolRetireCertModel(certModel))
    return {
      __typename: Cardano.CertificateType.PoolRetirement,
      cert_index: certModel.cert_index,
      epoch: certModel.retiring_epoch,
      poolId: Cardano.PoolId(certModel.pool_id)
    } as WithCertIndex<Cardano.PoolRetirementCertificate>;

  if (isPoolRegisterCertModel(certModel))
    return {
      __typename: Cardano.CertificateType.PoolRegistration,
      cert_index: certModel.cert_index,
      poolParameters: null as unknown as Cardano.PoolParameters
    } as WithCertIndex<Cardano.PoolRegistrationCertificate>;

  if (isMirCertModel(certModel))
    return {
      __typename: Cardano.CertificateType.MIR,
      cert_index: certModel.cert_index,
      pot: certModel.pot === 'reserve' ? Cardano.MirCertificatePot.Reserves : Cardano.MirCertificatePot.Treasury,
      quantity: BigInt(certModel.amount),
      rewardAccount: Cardano.RewardAccount(certModel.address)
    } as WithCertIndex<Cardano.MirCertificate>;

  if (isStakeCertModel(certModel))
    return {
      __typename: certModel.registration
        ? Cardano.CertificateType.StakeKeyRegistration
        : Cardano.CertificateType.StakeKeyDeregistration,
      cert_index: certModel.cert_index,
      stakeKeyHash: Cardano.Ed25519KeyHash.fromRewardAccount(Cardano.RewardAccount(certModel.address))
    } as WithCertIndex<Cardano.StakeAddressCertificate>;

  if (isDelegationCertModel(certModel))
    return {
      __typename: Cardano.CertificateType.StakeDelegation,
      cert_index: certModel.cert_index,
      poolId: Cardano.PoolId(certModel.pool_id),
      stakeKeyHash: Cardano.Ed25519KeyHash.fromRewardAccount(Cardano.RewardAccount(certModel.address))
    } as WithCertIndex<Cardano.StakeDelegationCertificate>;

  return null;
};

interface TxAlonzoData {
  inputs: Cardano.TxIn[];
  outputs: Cardano.TxOut[];
  mint?: Cardano.TokenMap;
  withdrawals?: Cardano.Withdrawal[];
  redeemers?: Cardano.Redeemer[];
  metadata?: Cardano.TxMetadata;
  collaterals?: Cardano.TxIn[];
  certificates?: Cardano.Certificate[];
}

export const mapTxAlonzo = (
  txModel: TxModel,
  { inputs, outputs, mint, withdrawals, redeemers, metadata, collaterals, certificates }: TxAlonzoData
): Cardano.TxAlonzo => ({
  auxiliaryData:
    metadata && metadata.size > 0
      ? {
          body: {
            blob: metadata
          }
        }
      : undefined,
  blockHeader: {
    blockNo: txModel.block_no,
    hash: Cardano.BlockId(txModel.block_hash.toString('hex')),
    slot: Number(txModel.block_slot_no)
  },
  body: {
    certificates,
    collaterals,
    fee: BigInt(txModel.fee),
    inputs,
    mint,
    outputs,
    validityInterval: {
      invalidBefore: Number(txModel.invalid_before) || undefined,
      invalidHereafter: Number(txModel.invalid_hereafter) || undefined
    },
    withdrawals
  },
  id: Cardano.TransactionId(txModel.id.toString('hex')),
  index: txModel.index,
  txSize: txModel.size,
  witness: {
    // TODO: fetch bootstrap witnesses, datums and scripts
    redeemers,
    // TODO: fetch signatures
    signatures: new Map()
  }
});

export const mapBlock = (blockModel: BlockModel, blockOutputModel: BlockOutputModel, tip: TipModel): Cardano.Block => ({
  confirmations: tip.block_no - blockModel.block_no,
  date: new Date(blockModel.time),
  epoch: blockModel.epoch_no,
  epochSlot: blockModel.epoch_slot_no,
  fees: BigInt(blockOutputModel?.fees ?? 0),
  header: {
    blockNo: blockModel.block_no,
    hash: Cardano.BlockId(blockModel.hash.toString('hex')),
    slot: Number(blockModel.slot_no)
  },
  nextBlock: blockModel.next_block ? Cardano.BlockId(blockModel.next_block.toString('hex')) : undefined,
  previousBlock: blockModel.previous_block ? Cardano.BlockId(blockModel.previous_block.toString('hex')) : undefined,
  size: blockModel.size,
  slotLeader: blockModel.slot_leader_pool
    ? Cardano.SlotLeader(blockModel.slot_leader_pool)
    : Cardano.SlotLeader(blockModel.slot_leader_hash.toString('hex')),
  totalOutput: BigInt(blockOutputModel?.output ?? 0),
  txCount: Number(blockModel.tx_count),
  vrf: Cardano.VrfVkBech32(blockModel.vrf)
});
