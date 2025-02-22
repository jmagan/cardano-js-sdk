import { AccountBalanceModel, RewardEpochModel } from './types';
import { Cardano, EpochRange } from '@cardano-sdk/core';
import { Logger } from 'ts-log';
import { Pool, QueryResult } from 'pg';
import { findAccountBalance, findRewardsHistory } from './queries';

export class RewardsBuilder {
  #db: Pool;
  #logger: Logger;
  constructor(db: Pool, logger: Logger) {
    this.#db = db;
    this.#logger = logger;
  }
  public async getAccountBalance(rewardAccount: Cardano.RewardAccount) {
    this.#logger.debug('About to run findAccountBalance query');
    const result: QueryResult<AccountBalanceModel> = await this.#db.query(findAccountBalance, [
      rewardAccount.toString()
    ]);
    return result.rows.length > 0 ? result.rows[0] : undefined;
  }
  public async getRewardsHistory(rewardAccounts: Cardano.RewardAccount[], epochs?: EpochRange) {
    const params: (string[] | number)[] = [rewardAccounts.map((rewardAcc) => rewardAcc.toString())];
    this.#logger.debug('About to run findRewardsHistory query');
    const result: QueryResult<RewardEpochModel> = await this.#db.query(
      findRewardsHistory(epochs?.lowerBound, epochs?.upperBound),
      params
    );
    return result.rows.length > 0 ? result.rows : [];
  }
}
