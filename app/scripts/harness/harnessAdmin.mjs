import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, unlinkSync } from 'node:fs';
import os from 'node:os';
import { resolve } from 'node:path';
import {
  canBindPort,
  getDefaultLeaseDir,
  isPidAlive,
  isStale,
  listLeases,
} from './portLease.mjs';
import { killProcessTree } from './runWithEmulators.mjs';

export function getListeningPidsForPorts(targetPorts) {
  if (!targetPorts || targetPorts.length === 0) return [];
  const portSet = new Set(targetPorts);
  const pids = new Set();

  if (process.platform === 'win32') {
    try {
      const output = execSync('netstat -ano -p tcp', { encoding: 'utf8' });
      for (const line of output.split('\n')) {
        const parts = line.trim().split(/\s+/);
        if (parts[0] === 'TCP' && parts[3] === 'LISTENING') {
          const localAddr = parts[1];
          const lastColon = localAddr.lastIndexOf(':');
          if (lastColon !== -1) {
            const port = Number(localAddr.slice(lastColon + 1));
            const pid = Number(parts[4]);
            if (portSet.has(port) && Number.isInteger(pid) && pid > 0) {
              pids.add(pid);
            }
          }
        }
      }
    } catch {
      // Ignore
    }
  } else {
    for (const port of targetPorts) {
      try {
        const out = execSync(`lsof -i :${port} -sTCP:LISTEN -t`, { encoding: 'utf8' });
        for (const pidStr of out.trim().split('\n')) {
          const pid = Number(pidStr.trim());
          if (Number.isInteger(pid) && pid > 0) {
            pids.add(pid);
          }
        }
      } catch {
        // No listener
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

export async function reapStaleResources({
  dryRun = true,
  leaseDir = getDefaultLeaseDir(),
  tmpDir = os.tmpdir(),
  isPidAliveFn = isPidAlive,
} = {}) {
  const { leases, hubLocators } = await getHarnessStatus({
    leaseDir,
    tmpDir,
    isPidAliveFn,
  });

  const staleLeases = leases.filter((l) => l.stale);
  const staleLocators = hubLocators.filter((h) => h.stale);

  const reaped = {
    dryRun,
    killedPids: [],
    removedLeaseFiles: [],
    removedLocators: [],
  };

  for (const lease of staleLeases) {
    const listeningPids = getListeningPidsForPorts(lease.ports);
    for (const pid of listeningPids) {
      if (!dryRun) {
        killProcessTree(pid);
      }
      reaped.killedPids.push({ pid, blockBase: lease.blockBase });
    }

    if (!dryRun) {
      try {
        unlinkSync(lease.leaseFile);
      } catch {
        // Ignore
      }
    }
    reaped.removedLeaseFiles.push(lease.leaseFile);
  }

  for (const locator of staleLocators) {
    if (!dryRun) {
      try {
        unlinkSync(locator.filePath);
      } catch {
        // Ignore
      }
    }
    reaped.removedLocators.push(locator.filePath);
  }

  return reaped;
}
