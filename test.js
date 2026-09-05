// SPDX-FileCopyrightText: 2026 Thomas Steiner
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict';
import net from 'node:net';
import test from 'node:test';
import {
  decodeFrame,
  FrameParser,
  createTrigger,
  EnverBridge,
} from './src/index.js';

const LIVE_A =
  '68009668100412345670a4017d5100000000000012345670a47d41e85b740078bacb3b803d82320500000000000200005680168012345671a47d44284fcf0075606a3e593d82320500000000000000000000000012345672a47d421c5e1f007565603fb33d82320508000000000000000000000012345673a47d45745036007de17e3a803d8232050000000000000000000000007916';
const LIVE_B =
  '68009668100412345670a4017d5100000000000012345670a47d41445d4b0078bacb3c263d48320900000000000200005680168012345671a47d43e2500a0075606a3e803d48320900000000000000000000000012345672a47d417e603c007565603ff33d48320908000000000000000000000012345673a47d454a5195007de17e3a8c3d4832090000000000000000000000009b16';
const STATUS =
  '680020681006123456700000000000004b000072030000010500440000007c16';

test('decodes live frame A to the value the cloud reported', () => {
  const r = decodeFrame(Buffer.from(LIVE_A, 'hex'));
  assert.equal(r.panels.length, 4);
  assert.equal(r.bridgeId, '12345670');
  assert.equal(Math.round(r.totalPowerW), 1382); // cloud said 1382 W
});

test('decodes live frame B to the value the cloud reported', () => {
  const r = decodeFrame(Buffer.from(LIVE_B, 'hex'));
  assert.equal(Math.round(r.totalPowerW), 1405); // cloud said 1405 W
});

test('per-panel physical values are sane', () => {
  const { panels } = decodeFrame(Buffer.from(LIVE_A, 'hex'));
  for (const p of panels) {
    assert.ok(p.dcVoltage > 20 && p.dcVoltage < 60, `dc ${p.dcVoltage}`);
    assert.ok(p.acVoltage > 200 && p.acVoltage < 260, `ac ${p.acVoltage}`);
    assert.ok(p.frequencyHz > 49 && p.frequencyHz < 51, `hz ${p.frequencyHz}`);
  }
  // Grid quantities must agree across panels on the same phase.
  assert.equal(new Set(panels.map((p) => p.acVoltage)).size, 1);
  assert.equal(new Set(panels.map((p) => p.frequencyHz)).size, 1);
});

test('matches the enverproxy reference record', () => {
  // enverproxy documents this record with ground truth DC 32.41 V,
  // 212.67 W, 18.8 C, 225.78 V, 50.01 Hz.
  const record =
    '111279832202' + '40d0352b001c5f391d6638723204' + '00'.repeat(12);
  const frame = Buffer.from(
    '68' +
      '0036' +
      '68' +
      '1004' +
      '11127983' +
      '00'.repeat(10) +
      record +
      '0016',
    'hex',
  );
  const { panels } = decodeFrame(frame);
  assert.equal(panels.length, 1);
  const [p] = panels;
  assert.equal(p.dcVoltage.toFixed(2), '32.41');
  assert.equal(p.powerW.toFixed(2), '212.67');
  assert.equal(p.temperatureC.toFixed(1), '18.8');
  assert.equal(p.acVoltage.toFixed(2), '225.78');
  assert.equal(p.frequencyHz.toFixed(2), '50.02');
});

test('status frames carry no panels', () => {
  const r = decodeFrame(Buffer.from(STATUS, 'hex'));
  assert.equal(r.panels, null);
  assert.equal(r.bridgeId, '12345670');
});

test('FrameParser reassembles split and concatenated frames', () => {
  const a = Buffer.from(LIVE_A, 'hex');
  const s = Buffer.from(STATUS, 'hex');
  const parser = new FrameParser();
  assert.equal(parser.push(a.subarray(0, 7)).length, 0);
  assert.equal(parser.push(a.subarray(7, 100)).length, 0);
  const out = parser.push(Buffer.concat([a.subarray(100), s, s]));
  assert.equal(out.length, 3);
  assert.equal(decodeFrame(out[0]).panels.length, 4);
  assert.equal(decodeFrame(out[2]).panels, null);
});

test('watch reconnects when a connected bridge goes silent', async () => {
  // A server that accepts connections but never sends a byte simulates the
  // half-open/silent bridge that used to leave the watcher stuck. The idle
  // timeout must force a reconnect, so we should see more than one connection.
  let connections = 0;
  const server = net.createServer((socket) => {
    connections += 1;
    socket.resume(); // drain the trigger, then stay silent
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  const bridge = new EnverBridge({
    host: '127.0.0.1',
    port,
    bridgeId: '12345670',
  });
  const controller = new AbortController();
  const start = Date.now();
  (async () => {
    // Never yields (server sends nothing); we only care about reconnects.
    for await (const _ of bridge.watch({
      signal: controller.signal,
      idleTimeoutMs: 80,
      reconnectDelayMs: 5,
    }));
  })().catch(() => {});

  while (connections < 2 && Date.now() - start < 3000) {
    await new Promise((r) => setTimeout(r, 20));
  }
  controller.abort();
  await new Promise((resolve) => server.close(resolve));
  assert.ok(connections >= 2, `expected a reconnect, saw ${connections}`);
});

test('trigger is ASCII text, not decoded bytes', () => {
  const t = createTrigger('12345670');
  assert.equal(t.length, 40);
  assert.equal(t.toString('ascii'), '107712345670' + '0'.repeat(24) + 'e316');
});
