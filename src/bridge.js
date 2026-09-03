// SPDX-FileCopyrightText: 2026 Thomas Steiner
// SPDX-License-Identifier: Apache-2.0

import net from 'node:net';
import { FrameParser, decodeFrame, COMMAND_PANEL_DATA } from './decode.js';

export const DEFAULT_PORT = 14889;

/**
 * Builds the trigger the bridge expects before it sends anything.
 *
 * The bridge wants the ASCII *text* of these hex digits, not the bytes they
 * represent. Sending decoded bytes yields no reply at all.
 *
 * @param {string} bridgeId The 8 digit bridge id.
 * @returns {Buffer} The trigger payload.
 */
export function createTrigger(bridgeId) {
  if (!/^[0-9a-f]{8}$/i.test(bridgeId)) {
    throw new Error(`Invalid bridge id: ${bridgeId}`);
  }
  return Buffer.from(`1077${bridgeId}${'0'.repeat(24)}e316`, 'ascii');
}

/**
 * A local connection to an Envertech EnverBridge.
 *
 * The bridge pushes a panel data frame roughly every two minutes and closes
 * the connection after about five minutes, so `watch()` reconnects for you.
 */
export class EnverBridge {
  #host;
  #port;
  #bridgeId;

  /**
   * @param {object} options
   * @param {string} options.host Address of the bridge.
   * @param {string} options.bridgeId The 8 digit bridge id, which is also the
   *   id of the first panel.
   * @param {number} [options.port] Defaults to 14889.
   */
  constructor({ host, bridgeId, port = DEFAULT_PORT }) {
    if (!host) {
      throw new Error('host is required');
    }
    createTrigger(bridgeId);
    this.#host = host;
    this.#port = port;
    this.#bridgeId = bridgeId;
  }

  /**
   * Opens a connection and yields decoded readings until `signal` aborts.
   *
   * @param {object} [options]
   * @param {AbortSignal} [options.signal] Stops the iteration when aborted.
   * @param {number} [options.reconnectDelayMs] Pause before reconnecting.
   * @yields {object} A decoded panel data reading.
   */
  async *watch({ signal, reconnectDelayMs = 2000 } = {}) {
    while (!signal?.aborted) {
      let queue = [];
      let wake;
      let done = false;
      const socket = net.createConnection(
        { host: this.#host, port: this.#port },
        () => socket.write(createTrigger(this.#bridgeId)),
      );
      const parser = new FrameParser();
      const finish = () => {
        done = true;
        wake?.();
      };
      socket.on('data', (chunk) => {
        for (const frame of parser.push(chunk)) {
          let reading;
          try {
            reading = decodeFrame(frame);
          } catch {
            continue;
          }
          if (reading.command === COMMAND_PANEL_DATA) {
            queue.push({ ...reading, receivedAt: new Date() });
          }
        }
        wake?.();
      });
      socket.on('error', finish);
      socket.on('close', finish);
      const onAbort = () => socket.destroy();
      signal?.addEventListener('abort', onAbort, { once: true });

      try {
        while (!done && !signal?.aborted) {
          if (queue.length === 0) {
            await new Promise((resolve) => {
              wake = resolve;
            });
            wake = undefined;
            continue;
          }
          const batch = queue;
          queue = [];
          yield* batch;
        }
        yield* queue;
      } finally {
        signal?.removeEventListener('abort', onAbort);
        socket.destroy();
      }

      if (signal?.aborted) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, reconnectDelayMs));
    }
  }

  /**
   * Reads a single panel data frame.
   *
   * The bridge pushes on its own schedule, so this can take up to about two
   * minutes. Long running callers should prefer `watch()`.
   *
   * @param {object} [options]
   * @param {number} [options.timeoutMs] Defaults to 150000.
   * @returns {Promise<object>} The decoded reading.
   */
  async read({ timeoutMs = 150000 } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      for await (const reading of this.watch({ signal: controller.signal })) {
        return reading;
      }
      throw new Error(`No panel data within ${timeoutMs} ms`);
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  }
}
