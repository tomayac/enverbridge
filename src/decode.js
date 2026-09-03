// SPDX-FileCopyrightText: 2026 Thomas Steiner
// SPDX-License-Identifier: Apache-2.0

/**
 * Decoder for the Envertech EnverBridge local TCP protocol.
 *
 * Frame layout:
 *   0      0x68            start byte
 *   1..2   uint16be        total frame length, including these bytes
 *   3      0x68            second start marker
 *   4..5   uint16be        command (0x1004 = panel data, 0x1006 = status)
 *   6..9   BCD             bridge id, read as hex digits
 *   ...    payload
 *   n-2    uint8           checksum (algorithm not yet identified)
 *   n-1    0x16            end byte
 *
 * A 0x1004 frame carries a 20 byte header, then one 32 byte record per
 * panel, then the 2 byte trailer.
 */

export const START_BYTE = 0x68;
export const END_BYTE = 0x16;
export const COMMAND_PANEL_DATA = 0x1004;
export const COMMAND_STATUS = 0x1006;

const HEADER_LENGTH = 20;
const TRAILER_LENGTH = 2;
const RECORD_LENGTH = 32;

/**
 * Decodes a single 32 byte panel record.
 *
 * Scaling factors are those used by the enverproxy project and were
 * verified against live readings from an EnverBridge EVB202.
 *
 * @param {Buffer} record A 32 byte panel record.
 * @returns {object} The decoded panel reading.
 */
function decodeRecord(record) {
  return {
    // The id is BCD encoded, so the hex digits *are* the printed id.
    id: record.subarray(0, 4).toString('hex'),
    dcVoltage: record.readUInt16BE(6) / 512,
    powerW: record.readUInt16BE(8) / 64,
    energyKwh: record.readUInt32BE(10) / 8192,
    // Plausible but unconfirmed: readings run hot (75-90 °C) in full sun.
    temperatureC: record.readUInt16BE(14) / 128 - 40,
    acVoltage: record.readUInt16BE(16) / 64,
    frequencyHz: record[18] + record[19] / 255,
  };
}

/**
 * Decodes one complete frame.
 *
 * @param {Buffer} frame A complete frame, starting at the 0x68 start byte.
 * @returns {object} `{command, bridgeId}` plus, for panel data frames,
 *   `panels`, `totalPowerW` and `totalEnergyKwh`.
 */
export function decodeFrame(frame) {
  if (frame[0] !== START_BYTE || frame[3] !== START_BYTE) {
    throw new Error('Not an EnverBridge frame: bad start bytes');
  }
  if (frame[frame.length - 1] !== END_BYTE) {
    throw new Error('Not an EnverBridge frame: bad end byte');
  }
  const command = frame.readUInt16BE(4);
  const bridgeId = frame.subarray(6, 10).toString('hex');
  if (command !== COMMAND_PANEL_DATA) {
    return { command, bridgeId, panels: null };
  }
  const body = frame.length - HEADER_LENGTH - TRAILER_LENGTH;
  const count = Math.floor(body / RECORD_LENGTH);
  const panels = [];
  for (let i = 0; i < count; i++) {
    const start = HEADER_LENGTH + i * RECORD_LENGTH;
    panels.push(decodeRecord(frame.subarray(start, start + RECORD_LENGTH)));
  }
  return {
    command,
    bridgeId,
    panels,
    totalPowerW: panels.reduce((sum, p) => sum + p.powerW, 0),
    totalEnergyKwh: panels.reduce((sum, p) => sum + p.energyKwh, 0),
  };
}

/**
 * Incremental frame splitter. TCP gives no message boundaries, so bytes are
 * buffered until the length prefix says a frame is complete.
 */
export class FrameParser {
  #buffer = Buffer.alloc(0);

  /**
   * @param {Buffer} chunk Bytes as they arrive from the socket.
   * @returns {Buffer[]} Every complete frame contained in the stream so far.
   */
  push(chunk) {
    this.#buffer = Buffer.concat([this.#buffer, chunk]);
    const frames = [];
    while (this.#buffer.length >= 4) {
      // Resynchronise if the stream does not start on a frame boundary.
      if (this.#buffer[0] !== START_BYTE) {
        const next = this.#buffer.indexOf(START_BYTE, 1);
        if (next === -1) {
          this.#buffer = Buffer.alloc(0);
          break;
        }
        this.#buffer = this.#buffer.subarray(next);
        continue;
      }
      const length = this.#buffer.readUInt16BE(1);
      if (length < 6 || length > 4096) {
        this.#buffer = this.#buffer.subarray(1);
        continue;
      }
      if (this.#buffer.length < length) {
        break;
      }
      frames.push(this.#buffer.subarray(0, length));
      this.#buffer = this.#buffer.subarray(length);
    }
    return frames;
  }
}
