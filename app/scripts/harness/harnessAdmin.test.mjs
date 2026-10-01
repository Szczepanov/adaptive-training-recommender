import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  findHubLocators,
  getHarnessStatus,
  getListeningPidsForPorts,
  reapStaleResources,
} from './harnessAdmin.mjs';

describe('harnessAdmin', () => {
  let tmpLeaseDir;
  let tmpTempDir;

  beforeEach(() => {
    tmpLeaseDir = mkdtempSync(resolve(os.tmpdir(), 'atr-test-leases-admin-'));
    tmpTempDir = mkdtempSync(resolve(os.tmpdir(), 'atr-test-temp-admin-'));
  });

  afterEach(() => {
    if (tmpLeaseDir && existsSync(tmpLeaseDir)) {
      rmSync(tmpLeaseDir, { recursive: true, force: true });
    }
    if (tmpTempDir && existsSync(tmpTempDir)) {
      rmSync(tmpTempDir, { recursive: true, force: true });
    }
  });

  it('reports empty pids for unused ports', () => {
    const pids = getListeningPidsForPorts([39999]);
    expect(Array.isArray(pids)).toBe(true);
  });

  it('finds and flags stale hub locators when port has no listener', async () => {
    const locatorPath = resolve(tmpTempDir, 'hub-demo-atr-test-21000.json');
    writeFileSync(
      locatorPath,
      JSON.stringify({
        host: '127.0.0.1',
        port: 39998,
      }),
    );

    const locators = await findHubLocators({ tmpDir: tmpTempDir, checkPortListening: true });
    expect(locators).toHaveLength(1);
    expect(locators[0].projectId).toBe('demo-atr-test-21000');
    expect(locators[0].stale).toBe(true);
  });

  it('reaps stale leases and locators while preserving active leases', async () => {
    const staleLeaseFile = resolve(tmpLeaseDir, '22000.json');
    writeFileSync(
      staleLeaseFile,
      JSON.stringify({
        pid: 9999999,
        worktree: '/dead',
        suite: 'dead',
        blockBase: 22000,
        ports: [22000, 22001],
        startedAt: new Date().toISOString(),
      }),
    );

    const activeLeaseFile = resolve(tmpLeaseDir, '23000.json');
    writeFileSync(
      activeLeaseFile,
      JSON.stringify({
        pid: process.pid,
        worktree: '/active',
        suite: 'active',
        blockBase: 23000,
        ports: [23000, 23001],
        startedAt: new Date().toISOString(),
      }),
    );

    const staleLocatorFile = resolve(tmpTempDir, 'hub-demo-atr-stale-22000.json');
    writeFileSync(
      staleLocatorFile,
      JSON.stringify({
        host: '127.0.0.1',
        port: 39997,
      }),
    );

    // Dry-run first
    const dryRunResult = await reapStaleResources({
      dryRun: true,
      leaseDir: tmpLeaseDir,
      tmpDir: tmpTempDir,
      isPidAliveFn: (pid) => pid === process.pid,
    });

    expect(dryRunResult.removedLeaseFiles).toContain(staleLeaseFile);
    expect(dryRunResult.removedLocators).toContain(staleLocatorFile);
    expect(existsSync(staleLeaseFile)).toBe(true);
    expect(existsSync(activeLeaseFile)).toBe(true);
    expect(existsSync(staleLocatorFile)).toBe(true);

    // Actual reap with dryRun: false
    const reapResult = await reapStaleResources({
      dryRun: false,
      leaseDir: tmpLeaseDir,
      tmpDir: tmpTempDir,
      isPidAliveFn: (pid) => pid === process.pid,
    });

    expect(reapResult.removedLeaseFiles).toContain(staleLeaseFile);
    expect(reapResult.removedLocators).toContain(staleLocatorFile);
    expect(existsSync(staleLeaseFile)).toBe(false);
    expect(existsSync(activeLeaseFile)).toBe(true);
    expect(existsSync(staleLocatorFile)).toBe(false);
  });
});
