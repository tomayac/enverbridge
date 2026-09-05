# enverbridge

Read Envertech EnverBridge solar microinverter data **locally over TCP**, with
no cloud dependency. No runtime dependencies.

Verified against an EnverBridge EVB202 with four microinverters: the decoded
totals match, to the watt, what envertecportal.com reports for the same moment.

## Install

```sh
npm install enverbridge
```

## Usage

```js
import { EnverBridge } from 'enverbridge';

const bridge = new EnverBridge({ host: '192.168.1.34', bridgeId: '12345670' });

for await (const reading of bridge.watch()) {
  console.log(reading.totalPowerW, reading.panels);
}
```

`bridgeId` is the eight digit id printed on the bridge, which is also the id of
the first panel.

### One-shot reads

```js
const reading = await bridge.read();
```

The bridge pushes on its own schedule rather than answering on demand, so a
single read can take up to about two minutes. Prefer `watch()` for anything long
running.

### Reconnection

`watch()` reconnects on its own and accepts an options object:

```js
for await (const reading of bridge.watch({
  signal, // optional AbortSignal to stop watching
  reconnectDelayMs: 2000, // wait between reconnect attempts
  idleTimeoutMs: 180000, // drop and reconnect if no frame arrives in time
})) {
  // ...
}
```

`idleTimeoutMs` guards against a bridge that accepts the connection but then
goes silent, or a half-open connection where the peer vanished without closing.
Since the bridge pushes at least every two minutes, the default three-minute
idle timeout forces a reconnect (which re-sends the trigger) rather than letting
the watcher hang forever. Pass `0` to disable it.

### Reading shape

```js
{
  command: 4100,
  bridgeId: '12345670',
  receivedAt: Date,
  totalPowerW: 1382.4,
  totalEnergyKwh: 3851.06,
  panels: [
    {
      id: '12345670',
      dcVoltage: 32.95,      // V
      powerW: 365.8,         // W
      energyKwh: 965.84,     // lifetime, kWh
      temperatureC: 79.0,    // see caveat below
      acVoltage: 246.03,     // V
      frequencyHz: 50.02,    // Hz
    },
    // ...
  ],
}
```

## Timing

- The bridge pushes a panel data frame about every **two minutes**.
- It also sends a short status frame every ~35 seconds, which is ignored.
- It **closes the connection after about five minutes**. `watch()` reconnects
  automatically.
- The lifetime energy counter updates far less often than instantaneous power,
  so consecutive readings frequently report identical `energyKwh`.

## Protocol

Frames are length prefixed and framed by `0x68` / `0x16`:

| Offset | Size | Meaning                                       |
| ------ | ---- | --------------------------------------------- |
| 0      | 1    | `0x68` start byte                             |
| 1      | 2    | total frame length, big endian                |
| 3      | 1    | `0x68` second marker                          |
| 4      | 2    | command: `0x1004` panel data, `0x1006` status |
| 6      | 4    | bridge id, BCD                                |
| ...    |      | payload                                       |
| n-2    | 1    | checksum (algorithm not yet identified)       |
| n-1    | 1    | `0x16` end byte                               |

A `0x1004` frame has a 20 byte header, then one 32 byte record per panel, then
the 2 byte trailer. Within a record:

| Offset | Size | Field       | Conversion      |
| ------ | ---- | ----------- | --------------- |
| 0      | 4    | panel id    | BCD             |
| 6      | 2    | DC voltage  | `/ 512`         |
| 8      | 2    | AC power    | `/ 64`          |
| 10     | 4    | energy      | `/ 8192` (kWh)  |
| 14     | 2    | temperature | `/ 128 - 40`    |
| 16     | 2    | AC voltage  | `/ 64`          |
| 18     | 2    | frequency   | `hi + lo / 255` |

The bridge sends nothing until it receives a trigger, which must be the ASCII
**text** of the hex digits `1077` + bridge id + 24 zeros + `e316`. Sending the
decoded bytes gets no reply at all.

### Caveats

- **Temperature** is the one field not independently confirmed. Readings run hot
  (75–90 °C in full sun). The offsets and scaling come from [enverproxy][], and
  every other field it documents reproduces exactly.
- The **checksum** algorithm is unknown. Frames are validated by their start and
  end bytes and their length prefix, which has proven sufficient.

## Trademark

This is an unofficial, unaffiliated project. EnverBridge and Envertech are
trademarks of Zhejiang Envertech Corporation Ltd.

## Prior art

The field offsets and scaling factors are those established by [enverproxy][] by
[@zivillian][], itself based on work by [@MEitelwein][]. `enverbridge` covers
the polling case: it talks to the bridge directly, so it needs no change to the
bridge's server mode, and leaves the cloud upload intact.

[enverproxy]: https://github.com/zivillian/enverproxy
[@zivillian]: https://github.com/zivillian
[@MEitelwein]: https://gitlab.eitelwein.net/MEitelwein/Enverbridge-Proxy

## License

Apache-2.0
