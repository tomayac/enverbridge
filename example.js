// SPDX-FileCopyrightText: 2026 Thomas Steiner
// SPDX-License-Identifier: Apache-2.0

import { EnverBridge } from './src/index.js';

const { ENVER_HOST, ENVER_ID } = process.env;

if (!ENVER_HOST || !ENVER_ID) {
  console.error('Set ENVER_HOST and ENVER_ID, for example:');
  console.error('  ENVER_HOST=192.168.1.34 ENVER_ID=12345670 node example.js');
  process.exit(1);
}

const bridge = new EnverBridge({ host: ENVER_HOST, bridgeId: ENVER_ID });

for await (const reading of bridge.watch()) {
  console.log(reading.receivedAt.toISOString(), {
    totalPowerW: Math.round(reading.totalPowerW),
    totalEnergyKwh: Number(reading.totalEnergyKwh.toFixed(2)),
    panels: reading.panels.map((p) => ({
      id: p.id,
      w: Math.round(p.powerW),
      dc: Number(p.dcVoltage.toFixed(1)),
    })),
  });
}
