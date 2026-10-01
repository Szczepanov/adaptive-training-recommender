import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BLOCK_SIZE,
  DEFAULT_MAX_PORT,
  DEFAULT_MIN_PORT,
  portsForBlock,
} from './harness/portLease.mjs';
import { parseShard, shardEmulatorConfig } from './run-rules-shard.mjs';

function emulatorPorts(emulators) {
  return [
    emulators.firestore?.port,
    emulators.firestore?.websocketPort ?? 9150,
    emulators.hub?.port ?? 4400,
    emulators.logging?.port ?? 4500,
    emulators.auth?.port,
  ].filter((port) => port !== undefined);
}

describe('run-rules-shard', () => {
  it('parses index/total shard arguments without arbitrary cap', () => {
    expect(parseShard('1/2')).toEqual({ index: 1, total: 2 });
    expect(parseShard('9/9')).toEqual({ index: 9, total: 9 });
    expect(parseShard('1/10')).toEqual({ index: 1, total: 10 });
    expect(parseShard('12/16')).toEqual({ index: 12, total: 16 });
  });

  it.each(['', '0/2', '3/2', '0/0', '-1/2', '1', 'a/b', undefined])('rejects %s', (arg) => {
    expect(() => parseShard(arg)).toThrow(/Expected <index>\/<total>/);
  });

  it('generates config using leased ports and singleProjectMode: false', () => {
    const fakeLease = { ports: [22100, 22101, 22102, 22103, 22104, 22105] };
    const config = shardEmulatorConfig(fakeLease);

    expect(config.emulators.firestore.port).toBe(22100);
    expect(config.emulators.firestore.websocketPort).toBe(22101);
    expect(config.emulators.hub.port).toBe(22102);
    expect(config.emulators.logging.port).toBe(22103);
    expect(config.emulators.singleProjectMode).toBe(false);
  });

  it('leases only from a range disjoint from firebase.json defaults', () => {
    const firebaseJson = JSON.parse(readFileSync(resolve('firebase.json'), 'utf8'));
    const highestLeasable = DEFAULT_MAX_PORT + DEFAULT_BLOCK_SIZE - 1;

    for (const port of emulatorPorts(firebaseJson.emulators)) {
      expect(
        port < DEFAULT_MIN_PORT || port > highestLeasable,
        `firebase.json default port ${port} lies inside the lease range`,
      ).toBe(true);
    }
  });

  it('points each shard at the same rules file as firebase.json', () => {
    const firebaseJson = JSON.parse(readFileSync(resolve('firebase.json'), 'utf8'));
    const lease = { ports: portsForBlock(DEFAULT_MIN_PORT) };
    expect(shardEmulatorConfig(lease).firestore.rules).toBe(firebaseJson.firestore.rules);
  });
});
