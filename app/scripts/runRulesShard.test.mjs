import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseShard, shardEmulatorConfig } from './run-rules-shard.mjs';

function emulatorPorts(emulators) {
  return [
    emulators.firestore.port,
    emulators.firestore.websocketPort ?? 9150,
    emulators.hub?.port ?? 4400,
    emulators.logging?.port ?? 4500,
    emulators.auth?.port,
  ].filter((port) => port !== undefined);
}

describe('run-rules-shard', () => {
  it('parses index/total shard arguments', () => {
    expect(parseShard('1/2')).toEqual({ index: 1, total: 2 });
    expect(parseShard('9/9')).toEqual({ index: 9, total: 9 });
  });

  it.each(['', '0/2', '3/2', '1/10', '1', 'a/b', undefined])('rejects %s', (arg) => {
    expect(() => parseShard(arg)).toThrow(/Expected <index>\/<total>/);
  });

  it('gives every shard ports disjoint from each other and from firebase.json', () => {
    const firebaseJson = JSON.parse(readFileSync(resolve('firebase.json'), 'utf8'));
    const used = new Set(emulatorPorts(firebaseJson.emulators));
    for (let index = 1; index <= 9; index += 1) {
      for (const port of emulatorPorts(shardEmulatorConfig(index).emulators)) {
        expect(used.has(port), `port ${port} of shard ${index}`).toBe(false);
        used.add(port);
      }
    }
  });

  it('points each shard at the same rules file as firebase.json', () => {
    const firebaseJson = JSON.parse(readFileSync(resolve('firebase.json'), 'utf8'));
    expect(shardEmulatorConfig(1).firestore.rules).toBe(firebaseJson.firestore.rules);
  });
});
