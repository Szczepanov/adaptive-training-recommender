import { spawnSync, fork } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  acquirePortBlock,
  candidateBlockBases,
  deserializeLease,
  getDefaultLeaseDir,
  isPidAlive,
  isStale,
  listLeases,
  portsForBlock,
  releasePortBlock,
  serializeLease,
} from './portLease.mjs';

describe('portLease pure helpers', () => {
  it('generates sequential candidate bases with step', () => {
    const bases = Array.from(candidateBlockBases({ minPort: 20000, maxPort: 20040, step: 10 }));
    expect(bases).toEqual([20000, 20010, 20020, 20030, 20040]);
  });

  it('generates ports for a block of given size', () => {
    expect(portsForBlock(21000, 4)).toEqual([21000, 21001, 21002, 21003]);
    expect(portsForBlock(25000, 8)).toEqual([
      25000, 25001, 25002, 25003, 25004, 25005, 25006, 25007,
    ]);
  });

  it('serializes and deserializes lease definitions cleanly', () => {
    const lease = {
      pid: 12345,
      worktree: '/test/worktree',
      suite: 'rules',
      blockBase: 22000,
      ports: [22000, 22001],
      startedAt: '2026-10-01T08:00:00.000Z',
    };
    const serialized = serializeLease(lease);
    const parsed = deserializeLease(serialized);
    expect(parsed).toEqual(lease);
  });

  it('detects alive and dead pids with isPidAlive and isStale', () => {
    expect(isPidAlive(process.pid)).toBe(true);
    expect(isPidAlive(-1)).toBe(false);

    const liveLease = { pid: process.pid, blockBase: 20000 };
    expect(isStale(liveLease)).toBe(false);

    const deadLease = { pid: 9999999, blockBase: 20000 };
    // Using mock isPidAliveFn
    expect(isStale(deadLease, { isPidAliveFn: () => false })).toBe(true);
    expect(isStale(deadLease, { isPidAliveFn: () => true })).toBe(false);
  });
});

describe('portLease lifecycle', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(resolve(os.tmpdir(), 'atr-test-leases-'));
  });

  afterEach(() => {
    if (tmpDir && existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('acquires and releases a block idempotently', async () => {
    const lease = await acquirePortBlock({
      leaseDir: tmpDir,
      minPort: 21000,
      maxPort: 21020,
      step: 10,
      size: 4,
      probePorts: false,
    });

    expect(lease.blockBase).toBe(21000);
    expect(lease.ports).toEqual([21000, 21001, 21002, 21003]);
    expect(existsSync(resolve(tmpDir, '21000.json'))).toBe(true);

    releasePortBlock(lease, { leaseDir: tmpDir });
    expect(existsSync(resolve(tmpDir, '21000.json'))).toBe(false);

    // Second call is idempotent and does not throw
    expect(() => releasePortBlock(lease, { leaseDir: tmpDir })).not.toThrow();
  });

  it('reclaims a stale lease when the owner pid is dead', async () => {
    const staleFile = resolve(tmpDir, '22000.json');
    writeFileSync(
      staleFile,
      JSON.stringify({
        pid: 9999999,
        worktree: '/dead',
        suite: 'dead',
        blockBase: 22000,
        ports: [22000, 22001],
        startedAt: new Date().toISOString(),
      }),
    );

    const lease = await acquirePortBlock({
      leaseDir: tmpDir,
      minPort: 22000,
      maxPort: 22020,
      step: 10,
      size: 2,
      probePorts: false,
      isPidAliveFn: (pid) => pid !== 9999999,
    });

    // Successfully reclaimed the stale block
    expect(lease.blockBase).toBe(22000);
    expect(lease.pid).toBe(process.pid);
  });

  it('skips a block whose owner pid is alive', async () => {
    const activeFile = resolve(tmpDir, '23000.json');
    writeFileSync(
      activeFile,
      JSON.stringify({
        pid: process.pid,
        worktree: '/active',
        suite: 'active',
        blockBase: 23000,
        ports: [23000, 23001],
        startedAt: new Date().toISOString(),
      }),
    );

    const lease = await acquirePortBlock({
      leaseDir: tmpDir,
      minPort: 23000,
      maxPort: 23020,
      step: 10,
      size: 2,
      probePorts: false,
    });

    // Skipped 23000 and acquired 23010
    expect(lease.blockBase).toBe(23010);
  });

  it('skips a block with an unbindable port during probing', async () => {
    // Start a listener on 24001 to make block 24000 fail probing
    const blocker = net.createServer();
    await new Promise((res) => blocker.listen({ port: 24001, host: '127.0.0.1' }, res));

    try {
      const lease = await acquirePortBlock({
        leaseDir: tmpDir,
        minPort: 24000,
        maxPort: 24020,
        step: 10,
        size: 4,
        probePorts: true,
      });

      // 24000 should have failed probe, so 24010 was acquired instead
      expect(lease.blockBase).toBe(24010);
      expect(existsSync(resolve(tmpDir, '24000.json'))).toBe(false);
    } finally {
      await new Promise((res) => blocker.close(res));
    }
  });

  it('lists active and stale leases', async () => {
    const lease1 = await acquirePortBlock({
      leaseDir: tmpDir,
      minPort: 25000,
      maxPort: 25020,
      step: 10,
      size: 2,
      suite: 'rules-1',
      probePorts: false,
    });

    writeFileSync(
      resolve(tmpDir, '25010.json'),
      JSON.stringify({
        pid: 9999999,
        worktree: '/dead',
        suite: 'dead-suite',
        blockBase: 25010,
        ports: [25010, 25011],
        startedAt: new Date().toISOString(),
      }),
    );

    const listed = listLeases({
      leaseDir: tmpDir,
      isPidAliveFn: (pid) => pid === process.pid,
    });

    expect(listed).toHaveLength(2);
    expect(listed[0].blockBase).toBe(25000);
    expect(listed[0].stale).toBe(false);
    expect(listed[1].blockBase).toBe(25010);
    expect(listed[1].stale).toBe(true);

    releasePortBlock(lease1, { leaseDir: tmpDir });
  });

  it('ensures two concurrent acquirers never share a block', async () => {
    const helperScript = resolve(tmpDir, 'acquire-helper.mjs');
    const portLeaseUrl = new URL('./portLease.mjs', import.meta.url).href;
    writeFileSync(
      helperScript,
      `
import { acquirePortBlock } from '${portLeaseUrl}';
const lease = await acquirePortBlock({
  leaseDir: process.argv[2],
  minPort: 26000,
  maxPort: 26050,
  step: 10,
  size: 4,
  probePorts: false,
});
console.log(JSON.stringify(lease));
// Keep process alive until signaled
process.stdin.resume();
`,
    );

    const { spawn } = await import('node:child_process');

    const spawnAcquirer = () => {
      return new Promise((res, rej) => {
        const proc = spawn(process.execPath, [helperScript, tmpDir], {
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        let output = '';
        proc.stdout.on('data', (d) => {
          output += d.toString();
          if (output.includes('\n')) {
            const lease = JSON.parse(output.trim());
            res({ proc, lease });
          }
        });
        proc.on('error', rej);
      });
    };

    const first = await spawnAcquirer();
    const second = await spawnAcquirer();

    try {
      expect(first.lease.blockBase).not.toBe(second.lease.blockBase);
      expect(new Set([...first.lease.ports, ...second.lease.ports]).size).toBe(
        first.lease.ports.length + second.lease.ports.length,
      );
    } finally {
      first.proc.kill();
      second.proc.kill();
    }
  });
});
