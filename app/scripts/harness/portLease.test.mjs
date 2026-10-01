import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
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

// Not a multiple of 4, so never a live Windows pid; far above the default Linux pid_max.
const DEAD_PID = 9999999;
const NL = String.fromCharCode(10);

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

    const deadLease = { pid: DEAD_PID, blockBase: 20000 };
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
        pid: DEAD_PID,
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
      isPidAliveFn: (pid) => pid !== DEAD_PID,
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
        pid: DEAD_PID,
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

  it('does not reclaim a freshly created lease that is not yet readable', async () => {
    // An acquirer that has created but not yet parsed-out its lease must keep it.
    writeFileSync(resolve(tmpDir, '27000.json'), '');

    const lease = await acquirePortBlock({
      leaseDir: tmpDir,
      minPort: 27000,
      maxPort: 27020,
      step: 10,
      size: 2,
      probePorts: false,
    });

    expect(lease.blockBase).toBe(27010);
    expect(readFileSync(resolve(tmpDir, '27000.json'), 'utf8')).toBe('');
  });

  it('reclaims an unparseable lease once it is older than the grace period', async () => {
    const orphan = resolve(tmpDir, '27100.json');
    writeFileSync(orphan, '');
    const old = new Date(Date.now() - 60_000);
    utimesSync(orphan, old, old);

    const lease = await acquirePortBlock({
      leaseDir: tmpDir,
      minPort: 27100,
      maxPort: 27120,
      step: 10,
      size: 2,
      probePorts: false,
    });

    expect(lease.blockBase).toBe(27100);
  });

  it('never writes a partial lease file', async () => {
    const lease = await acquirePortBlock({
      leaseDir: tmpDir,
      minPort: 27200,
      maxPort: 27220,
      step: 10,
      size: 2,
      probePorts: false,
    });

    expect(deserializeLease(readFileSync(lease.leaseFile, 'utf8')).pid).toBe(process.pid);
    expect(readdirSync(tmpDir).filter((f) => !f.endsWith('.json'))).toEqual([]);
  });

  describe('concurrent acquirers in separate processes', () => {
    const ACQUIRERS = 6;

    function writeHelper({ minPort, maxPort }) {
      const helperScript = resolve(tmpDir, `acquire-helper-${minPort}.mjs`);
      const portLeaseUrl = new URL('./portLease.mjs', import.meta.url).href;
      writeFileSync(
        helperScript,
        `
import { acquirePortBlock } from '${portLeaseUrl}';
const lease = await acquirePortBlock({
  leaseDir: process.argv[2],
  minPort: ${minPort},
  maxPort: ${maxPort},
  step: 10,
  size: 4,
  probePorts: false,
});
console.log(JSON.stringify(lease));
// Hold the lease (pid stays alive) until the test kills the process.
process.stdin.resume();
`,
      );
      return helperScript;
    }

    function spawnAcquirer(helperScript) {
      return new Promise((res, rej) => {
        const proc = spawn(process.execPath, [helperScript, tmpDir], {
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        let output = '';
        let errors = '';
        proc.stdout.on('data', (d) => {
          output += d.toString();
          if (output.includes(NL)) res({ proc, lease: JSON.parse(output.trim()) });
        });
        proc.stderr.on('data', (d) => {
          errors += d.toString();
        });
        proc.on('error', rej);
        proc.on('exit', (code) => {
          if (!output.includes(NL)) rej(new Error(`acquirer exited ${code}: ${errors}`));
        });
      });
    }

    async function acquireConcurrently(helperScript) {
      const results = await Promise.allSettled(
        Array.from({ length: ACQUIRERS }, () => spawnAcquirer(helperScript)),
      );
      const acquired = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
      try {
        expect(results.filter((r) => r.status === 'rejected')).toEqual([]);
        return acquired.map((a) => a.lease);
      } finally {
        for (const { proc } of acquired) proc.kill();
      }
    }

    function expectDisjoint(leases) {
      const bases = leases.map((l) => l.blockBase);
      expect(new Set(bases).size).toBe(leases.length);
      const ports = leases.flatMap((l) => l.ports);
      expect(new Set(ports).size).toBe(ports.length);
    }

    it('never share a block', async () => {
      const leases = await acquireConcurrently(writeHelper({ minPort: 26000, maxPort: 26090 }));
      expectDisjoint(leases);
    });

    it('never share a block while reclaiming the same stale lease', async () => {
      // Every acquirer sees the dead-pid lease on the first block at the same time; only one
      // may reclaim it.
      writeFileSync(
        resolve(tmpDir, '28000.json'),
        serializeLease({
          pid: DEAD_PID,
          worktree: '/dead',
          suite: 'dead',
          blockBase: 28000,
          ports: [28000, 28001, 28002, 28003],
        }),
      );

      const leases = await acquireConcurrently(writeHelper({ minPort: 28000, maxPort: 28090 }));
      expectDisjoint(leases);
      expect(leases.filter((l) => l.blockBase === 28000)).toHaveLength(1);
    });
  });
});
