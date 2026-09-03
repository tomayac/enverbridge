// SPDX-FileCopyrightText: 2026 Thomas Steiner
// SPDX-License-Identifier: Apache-2.0

import { EnverBridge } from './src/index.js';

const bridge = new EnverBridge({
  host: process.env.ENVER_HOST ?? '192.168.1.34',
  bridgeId: process.env.ENVER_ID ?? '12345670',
});

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
