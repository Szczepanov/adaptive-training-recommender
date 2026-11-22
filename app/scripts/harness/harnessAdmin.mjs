import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import { resolve } from 'node:path';
import {
  canBindPort,
  getDefaultLeaseDir,
  isPidAlive,
  listLeases,
  withBlockLock,
} from './portLease.mjs';
import { harnessConfigPath, killProcessTree } from './runWithEmulators.mjs';

// Uses Get-NetTCPConnection on Windows: unlike `netstat` it reports IPv6 listeners too, and its
// state names are not translated on non-English Windows.
export function getListeningPidsForPorts(targetPorts) {
  if (!targetPorts || targetPorts.length === 0) return [];
  const portSet = new Set(targetPorts);
  const pids = new Set();

  if (process.platform === 'win32') {
    const script =
      'Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | ' +
      'ForEach-Object { "$($_.LocalPort) $($_.OwningProcess)" }';
    const result = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf8',
      windowsHide: true,
    });
    for (const line of (result.stdout ?? '').split(/\r?\n/)) {
      const [port, pid] = line.trim().split(/\s+/).map(Number);
      if (portSet.has(port) && Number.isInteger(pid) && pid > 0) pids.add(pid);
    }
  } else {
    for (const port of targetPorts) {
      const result = spawnSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], {
        encoding: 'utf8',
      });
      for (const pidStr of (result.stdout ?? '').trim().split('\n')) {
        const pid = Number(pidStr.trim());
        if (Number.isInteger(pid) && pid > 0) pids.add(pid);
      }
    }
  }

  return Array.from(pids).sort((a, b) => a - b);
}

export async function findHubLocators({
  tmpDir = os.tmpdir(),
  checkPortListening = true,
  isPidAliveFn = isPidAlive,
} = {}) {
  if (!existsSync(tmpDir)) return [];

  const files = readdirSync(tmpDir).filter((f) => /^hub-demo-.*\.json$/.test(f));
  const locators = [];

  for (const file of files) {
    const filePath = resolve(tmpDir, file);
    try {
      const content = readFileSync(filePath, 'utf8');
      const data = JSON.parse(content);
      let port = Number(data.port);
      let host = data.host || '127.0.0.1';
      const pid = typeof data.pid === 'number' ? data.pid : null;

      if (!Number.isInteger(port) && Array.isArray(data.origins) && data.origins[0]) {
        try {
          const parsedUrl = new URL(data.origins[0]);
          port = Number(parsedUrl.port);
          host = parsedUrl.hostname;
        } catch {
          // ignore
        }
      }

      let stale = false;
      if (pid !== null && !isPidAliveFn(pid)) {
        stale = true;
      } else if (checkPortListening && Number.isInteger(port)) {
        // If canBindPort is true, no process is listening on the hub port -> stale!
        const canBind = await canBindPort(port, host);
        stale = canBind;
      }

      locators.push({
        file,
        filePath,
        port,
        host,
        pid,
        projectId: file.replace(/^hub-/, '').replace(/\.json$/, ''),
        stale,
      });
    } catch {
      locators.push({
        file,
        filePath,
        port: null,
        host: null,
        pid: null,
        projectId: file.replace(/^hub-/, '').replace(/\.json$/, ''),
        stale: true,
      });
    }
  }

  return locators;
}

export async function getHarnessStatus({
  leaseDir = getDefaultLeaseDir(),
  tmpDir = os.tmpdir(),
  isPidAliveFn = isPidAlive,
} = {}) {
  const leases = listLeases({ leaseDir, isPidAliveFn });
  const hubLocators = await findHubLocators({ tmpDir });
  return { leases, hubLocators };
}

function sameLease(a, b) {
  return a.pid === b.pid && a.startedAt === b.startedAt;
}

export async function reapStaleResources({
  dryRun = true,
  leaseDir = getDefaultLeaseDir(),
  tmpDir = os.tmpdir(),
  isPidAliveFn = isPidAlive,
  getListeningPidsFn = getListeningPidsForPorts,
  killProcessTreeFn = killProcessTree,
} = {}) {
  const { leases, hubLocators } = await getHarnessStatus({
    leaseDir,
    tmpDir,
    isPidAliveFn,
  });

  const reaped = {
    dryRun,
    killedPids: [],
    removedLeaseFiles: [],
    removedConfigs: [],
    removedLocators: [],
    skippedLeaseFiles: [],
  };

  for (const lease of leases.filter((l) => l.stale)) {
    // Under the block lock, re-read the lease: between the listing above and now, a new run may
    // have reclaimed this block. Killing "its" port listeners or deleting its lease would break
    // that live run, so act only while the file still records the same dead owner.
    const outcome = withBlockLock(lease.leaseFile, () => {
      let current;
      try {
        current = listLeases({ leaseDir, isPidAliveFn }).find((l) => l.leaseFile === lease.leaseFile);
      } catch {
        return 'changed';
      }
      if (!current || !current.stale || !sameLease(current, lease)) return 'changed';

      for (const pid of getListeningPidsFn(lease.ports)) {
        if (!dryRun) killProcessTreeFn(pid);
        reaped.killedPids.push({ pid, blockBase: lease.blockBase });
      }
      if (!dryRun) rmSync(lease.leaseFile, { force: true });
      reaped.removedLeaseFiles.push(lease.leaseFile);

      // A hard-killed launcher never reaches its `finally`, so its generated config survives too.
      const configPath =
        typeof lease.worktree === 'string' && Number.isInteger(lease.blockBase)
          ? harnessConfigPath(lease.worktree, lease.blockBase)
          : null;
      if (configPath && existsSync(configPath)) {
        if (!dryRun) rmSync(configPath, { force: true });
        reaped.removedConfigs.push(configPath);
      }
      return 'reaped';
    });
    if (outcome !== 'reaped') reaped.skippedLeaseFiles.push(lease.leaseFile);
  }

  for (const locator of hubLocators.filter((h) => h.stale)) {
    if (!dryRun) rmSync(locator.filePath, { force: true });
    reaped.removedLocators.push(locator.filePath);
  }

  return reaped;
}
