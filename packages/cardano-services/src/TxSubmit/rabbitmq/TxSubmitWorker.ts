/* eslint-disable @typescript-eslint/no-shadow */
import { CONNECTION_ERROR_EVENT, TX_SUBMISSION_QUEUE, serializeError, waitForPending } from './utils';
import { Channel, Connection, Message, connect } from 'amqplib';
import { EventEmitter } from 'events';
import { Logger } from 'ts-log';
import { ProviderError, ProviderFailure, TxSubmitProvider, cslUtil } from '@cardano-sdk/core';
import { bufferToHexString } from '@cardano-sdk/util';

const moduleName = 'TxSubmitWorker';

/**
 * Configuration options parameters for the TxSubmitWorker
 */
export interface TxSubmitWorkerConfig {
  /**
   * Instructs the worker to process multiple transactions simultaneously.
   * Default: false (serial mode)
   */
  parallel?: boolean;

  /**
   * The number of Tx submitted to the txSubmitProvider in parallel.
   * Ignored in serial mode. Default: 3
   */
  parallelTxs?: number;

  /**
   * The RabbitMQ polling cycle in milliseconds.
   * Ignored in parallel mode. Default: 500
   */
  pollingCycle?: number;

  /**
   * The RabbitMQ connection URL
   */
  rabbitmqUrl: URL;
}

/**
 * Dependencies for the TxSubmitWorker
 */
export interface TxSubmitWorkerDependencies {
  /**
   * The logger. Default: silent
   */
  logger: Logger;

  /**
   * The provider to use to submit tx
   */
  txSubmitProvider: TxSubmitProvider;
}

/**
 * Controller class for the transactions submission worker which gets
 * transactions from RabbitMQ and submit them via the TxSubmitProvider
 */
export class TxSubmitWorker extends EventEmitter {
  /**
   * The RabbitMQ channel
   */
  #channel?: Channel;

  /**
   * The configuration options
   */
  #config: TxSubmitWorkerConfig;

  /**
   * The RabbitMQ connection
   */
  #connection?: Connection;

  /**
   * Flag to exit from the infinite loop in case of sequential tx handling
   */
  #continueForever = false;

  /**
   * The RabbitMQ consumerTag
   */
  #consumerTag?: string;

  /**
   * Internal messages counter
   */
  #counter = 0;

  /**
   *  The dependency objects
   */
  #dependencies: TxSubmitWorkerDependencies;

  /**
   * The internal worker status
   */
  #status: 'connected' | 'connecting' | 'error' | 'idle' = 'idle';

  /**
   * @param config The configuration options
   * @param dependencies The dependency objects
   */
  constructor(config: TxSubmitWorkerConfig, dependencies: TxSubmitWorkerDependencies) {
    super();
    this.#config = { parallelTxs: 3, pollingCycle: 500, ...config };
    this.#dependencies = dependencies;
  }

  /**
   * The common handler for errors
   *
   * @param isAsync flag to identify asynchronous errors
   * @param err the connection error itself supplied by 'close' handler runtime or by catch block of 'worker.start()'
   */
  private async connectionErrorHandler(isAsync: boolean, err?: unknown) {
    if (err) {
      this.logError(err, isAsync);
      this.#status = 'error';
      await this.stop();

      // Emit event due to connection error in order to notify the worker abstraction listener
      this.emitEvent(CONNECTION_ERROR_EVENT, err);
    }
  }

  /**
   * Get the status of the worker
   *
   * @returns the status of the worker
   */
  getStatus() {
    return this.#status;
  }

  /**
   * Emit event raised by the worker
   *
   */
  emitEvent(eventName: string, err?: unknown) {
    this.emit(eventName, err);
  }

  /**
   * Starts the worker
   *
   * In the case of a server-initiated shutdown or an error,
   * the 'close' handler will be supplied with an error indicating the cause
   * https://amqp-node.github.io/amqplib/channel_api.html#model_events
   */
  async start() {
    this.#dependencies.logger.info(`${moduleName} init: checking tx submission provider health status`);

    const { ok } = await this.#dependencies.txSubmitProvider.healthCheck();

    if (!ok) throw new ProviderError(ProviderFailure.Unhealthy);

    try {
      this.#dependencies.logger.info(`${moduleName} init: opening RabbitMQ connection`);
      this.#status = 'connecting';
      this.#connection = await connect(this.#config.rabbitmqUrl.toString());
      this.#connection.on('close', (error) => this.connectionErrorHandler(true, error));

      this.#dependencies.logger.info(`${moduleName} init: opening RabbitMQ channel`);
      this.#channel = await this.#connection.createChannel();
      this.#channel.on('close', (error) => this.connectionErrorHandler(true, error));

      this.#dependencies.logger.info(`${moduleName} init: ensuring RabbitMQ queue`);
      await this.#channel.assertQueue(TX_SUBMISSION_QUEUE);
      this.#dependencies.logger.info(`${moduleName}: init completed`);

      if (this.#config.parallel) {
        this.#dependencies.logger.info(`${moduleName}: starting parallel mode`);
        await this.#channel.prefetch(this.#config.parallelTxs!, true);

        const parallelHandler = (message: Message | null) => (message ? this.submitTx(message) : null);

        this.#consumerTag = (await this.#channel.consume(TX_SUBMISSION_QUEUE, parallelHandler)).consumerTag;
      } else {
        this.#dependencies.logger.info(`${moduleName}: starting serial mode`);
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        this.infiniteLoop();
      }

      this.#status = 'connected';
    } catch (error) {
      await this.connectionErrorHandler(false, error);
    }
  }

  /**
   * Stops the worker.
   */
  async stop() {
    this.#dependencies.logger.info(`${moduleName} shutdown: closing RabbitMQ channel`);

    // In case of parallel worker; first of all cancel the consumer
    if (this.#consumerTag)
      try {
        // Let's immediately reset this.#consumerTag to be sure the cancel operation is called
        // only once even if the this.stop method is called more than once
        const consumerTag = this.#consumerTag;
        this.#consumerTag = undefined;

        await this.#channel!.cancel(consumerTag);
      } catch (error) {
        this.logError(error);
      }
    // In case of serial worker; just instruct the infinite loop it can exit
    else this.#continueForever = false;

    // Wait for pending operations before closing
    await waitForPending(this.#channel);

    try {
      await this.#channel?.close();
    } catch (error) {
      this.logError(error);
    }

    this.#dependencies.logger.info(`${moduleName} shutdown: closing RabbitMQ connection`);

    try {
      await this.#connection?.close();
    } catch (error) {
      this.logError(error);
    }

    this.#dependencies.logger.info(`${moduleName}: shutdown completed`);
    this.#channel = undefined;
    this.#connection = undefined;
    this.#status = 'idle';
  }

  /**
   * Wrapper to log errors from try/catch blocks
   *
   * @param error the error to log
   * @param isAsync flag to set in case the error is asynchronous
   * @param asWarning flag to log the error with warning log level
   */
  private logError(error: unknown, isAsync = false, asWarning = false) {
    const errorMessage =
      // eslint-disable-next-line prettier/prettier
      error instanceof Error ? error.message : (typeof error === 'string' ? error : JSON.stringify(error));
    const errorObject = { error: error instanceof Error ? error.name : 'Unknown error', isAsync, module: moduleName };

    if (asWarning) this.#dependencies.logger.warn(errorObject, errorMessage);
    else this.#dependencies.logger.error(errorObject, errorMessage);
    if (error instanceof Error) this.#dependencies.logger.debug(`${moduleName}:`, error.stack);
  }

  /**
   * The infinite loop to perform serial tx submission
   */
  private async infiniteLoop() {
    this.#continueForever = true;

    while (this.#continueForever) {
      const message = await this.#channel?.get(TX_SUBMISSION_QUEUE);

      // If there is a message, handle it, otherwise wait #pollingCycle ms
      await (message
        ? this.submitTx(message)
        : new Promise((resolve) => setTimeout(resolve, this.#config.pollingCycle!)));
    }
  }

  /**
   * Submit a tx to the provider and ack (or nack) the message
   *
   * @param message the message containing the transaction
   */
  private async submitTx(message: Message) {
    const counter = ++this.#counter;
    let isRetryable = false;
    let serializableError: unknown;
    let txId = '';

    try {
      const { content } = message;
      const txBody = new Uint8Array(content);

      // Register the handling of current transaction
      txId = cslUtil.deserializeTx(txBody).id.toString();

      this.#dependencies.logger.info(`${moduleName}: submitting tx #${counter} id: ${txId}`);
      this.#dependencies.logger.debug(`${moduleName}: tx #${counter} dump:`, [content.toString('hex')]);
      await this.#dependencies.txSubmitProvider.submitTx({ signedTransaction: bufferToHexString(Buffer.from(txBody)) });

      this.#dependencies.logger.debug(`${moduleName}: ACKing RabbitMQ message #${counter}`);
      this.#channel?.ack(message);
    } catch (error) {
      ({ isRetryable, serializableError } = await this.submitTxErrorHandler(error, counter, message));
    } finally {
      // If there is no error or the error can't be retried
      if (!serializableError || !isRetryable) {
        // Send the response to the original submitter
        try {
          // An empty response message means successful submission
          const message = serializableError || {};
          await this.#channel!.assertQueue(txId);
          this.logError(`${moduleName}: sending response for message #${counter}`);
          this.#channel!.sendToQueue(txId, Buffer.from(JSON.stringify(message)));
        } catch (error) {
          this.logError(`${moduleName}: while sending response for message #${counter}`);
          this.logError(error);
        }
      }
    }
  }

  /**
   * The error handler of submitTx method
   */
  private async submitTxErrorHandler(err: unknown, counter: number, message: Message) {
    const { isRetryable, serializableError } = serializeError(err);

    if (isRetryable) this.#dependencies.logger.warn(`${moduleName}: submitting tx #${counter}`);
    else this.#dependencies.logger.error(`${moduleName}: submitting tx #${counter}`);
    this.logError(err, false, isRetryable);

    const action = `${isRetryable ? 'N' : ''}ACKing RabbitMQ message #${counter}`;

    try {
      this.#dependencies.logger.info(`${moduleName}: ${action}`);
      // In RabbitMQ language, NACKing a message means to ask to retry for it
      // We NACK only those messages which had an error which can be retried
      if (isRetryable) this.#channel?.nack(message);
      else this.#channel?.ack(message);
    } catch (error) {
      this.logError(`${moduleName}: while ${action}`);
      this.logError(error);
    }

    return { isRetryable, serializableError };
  }
}
