import { existsSync, mkdirSync, openSync, readdirSync, readFileSync, unlinkSync, writeSync, closeSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import { dirname, resolve } from 'node:path';

export const DEFAULT_MIN_PORT = 20000;
export const DEFAULT_MAX_PORT = 39999;
export const DEFAULT_STEP = 10;
export const DEFAULT_BLOCK_SIZE = 8;

export function getDefaultLeaseDir() {
  return resolve(os.tmpdir(), 'atr-harness', 'leases');
}

export function* candidateBlockBases({
  minPort = DEFAULT_MIN_PORT,
  maxPort = DEFAULT_MAX_PORT,
  step = DEFAULT_STEP,
} = {}) {
  for (let port = minPort; port <= maxPort; port += step) {
    yield port;
  }
}

export function portsForBlock(blockBase, size = DEFAULT_BLOCK_SIZE) {
  if (!Number.isInteger(blockBase) || blockBase <= 0) {
    throw new Error(`Invalid blockBase: ${blockBase}`);
  }
  if (!Number.isInteger(size) || size <= 0) {
    throw new Error(`Invalid block size: ${size}`);
  }
  const ports = [];
  for (let i = 0; i < size; i += 1) {
    ports.push(blockBase + i);
  }
  return ports;
}

export function serializeLease(lease) {
  return JSON.stringify(
    {
      pid: lease.pid,
      worktree: lease.worktree,
      suite: lease.suite,
      blockBase: lease.blockBase,
      ports: lease.ports,
      startedAt: lease.startedAt ?? new Date().toISOString(),
    },
    null,
    2,
  );
}

export function deserializeLease(content) {
  const parsed = JSON.parse(content);
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof parsed.pid !== 'number' ||
    typeof parsed.blockBase !== 'number' ||
    !Array.isArray(parsed.ports)
  ) {
    throw new Error('Invalid lease content');
  }
  return parsed;
}

export function isPidAlive(pid) {
  if (typeof pid !== 'number' || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err?.code === 'EPERM';
  }
}

export function isStale(lease, { isPidAliveFn = isPidAlive } = {}) {
  if (!lease || typeof lease.pid !== 'number') return true;
  return !isPidAliveFn(lease.pid);
}

let _ipv6Supported = null;
export async function isIpv6Supported() {
  if (_ipv6Supported !== null) return _ipv6Supported;
  return new Promise((res) => {
    const s = net.createServer();
    s.unref();
    s.on('error', (err) => {
      _ipv6Supported = !(err.code === 'EADDRNOTAVAIL' || err.code === 'EAFNOSUPPORT');
      res(_ipv6Supported);
    });
    s.listen({ port: 0, host: '::1', exclusive: true }, () => {
      s.close(() => {
        _ipv6Supported = true;
        res(true);
      });
    });
  });
}

export async function canBindPort(port, host) {
  return new Promise((res) => {
    const s = net.createServer();
    s.unref();
    s.on('error', () => {
      res(false);
    });
    s.listen({ port, host, exclusive: true }, () => {
      s.close(() => {
        res(true);
      });
    });
  });
}

export async function probeBlockPorts(ports, { checkIpv6 = null } = {}) {
  const hasIpv6 = checkIpv6 ?? (await isIpv6Supported());
  for (const port of ports) {
    const v4Ok = await canBindPort(port, '127.0.0.1');
    if (!v4Ok) return false;
    if (hasIpv6) {
      const v6Ok = await canBindPort(port, '::1');
      if (!v6Ok) return false;
    }
  }
  return true;
}

export async function acquirePortBlock({
  suite = 'unknown',
  size = DEFAULT_BLOCK_SIZE,
  leaseDir = getDefaultLeaseDir(),
  worktree = process.cwd(),
  pid = process.pid,
  minPort = DEFAULT_MIN_PORT,
  maxPort = DEFAULT_MAX_PORT,
  step = DEFAULT_STEP,
  probePorts = true,
  isPidAliveFn = isPidAlive,
} = {}) {
  mkdirSync(leaseDir, { recursive: true });

  for (const blockBase of candidateBlockBases({ minPort, maxPort, step })) {
    const leaseFile = resolve(leaseDir, `${blockBase}.json`);
    const ports = portsForBlock(blockBase, size);
    let fd = null;

    try {
      fd = openSync(leaseFile, 'wx');
    } catch (err) {
      if (err.code === 'EEXIST') {
        // Check if existing lease is stale
        let existing = null;
        try {
          existing = deserializeLease(readFileSync(leaseFile, 'utf8'));
        } catch {
          // Unparseable or empty file from crash
        }

        if (existing && !isStale(existing, { isPidAliveFn })) {
          continue; // Owner is still alive, skip block
        }

        // Stale lease: try to reclaim by removing and recreating
        try {
          unlinkSync(leaseFile);
          fd = openSync(leaseFile, 'wx');
        } catch {
          // Raced with another process, continue
          continue;
        }
      } else {
        throw err;
      }
    }

    // Acquired exclusive file descriptor
    const leaseData = {
      pid,
      worktree,
      suite,
      blockBase,
      ports,
      startedAt: new Date().toISOString(),
    };

    try {
      const serialized = serializeLease(leaseData);
      writeSync(fd, `${serialized}\n`);
    } finally {
      closeSync(fd);
    }

    if (probePorts) {
      const probeOk = await probeBlockPorts(ports);
      if (!probeOk) {
        // Port probing failed; release block and try next
        try {
          unlinkSync(leaseFile);
        } catch {
          // Ignore
        }
        continue;
      }
    }

    return {
      ...leaseData,
      leaseFile,
      released: false,
    };
  }

  throw new Error(`Failed to acquire port block of size ${size} in range ${minPort}-${maxPort}`);
}

export function releasePortBlock(lease, { leaseDir = getDefaultLeaseDir() } = {}) {
  if (!lease) return;
  if (lease.released) return;

  const leaseFile = lease.leaseFile || resolve(leaseDir, `${lease.blockBase}.json`);
  try {
    unlinkSync(leaseFile);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  lease.released = true;
}

export function listLeases({
  leaseDir = getDefaultLeaseDir(),
  isPidAliveFn = isPidAlive,
} = {}) {
  if (!existsSync(leaseDir)) return [];

  const files = readdirSync(leaseDir).filter((f) => f.endsWith('.json'));
  const leases = [];

  for (const file of files) {
    const fullPath = resolve(leaseDir, file);
    try {
      const content = readFileSync(fullPath, 'utf8');
      const data = deserializeLease(content);
      const stale = isStale(data, { isPidAliveFn });
      leases.push({
        ...data,
        leaseFile: fullPath,
        stale,
      });
    } catch {
      // Unparseable file: treat as stale orphan
      const match = /^(\d+)\.json$/.exec(file);
      const blockBase = match ? Number(match[1]) : NaN;
      leases.push({
        pid: -1,
        worktree: 'unknown',
        suite: 'unknown',
        blockBase,
        ports: Number.isInteger(blockBase) ? portsForBlock(blockBase) : [],
        startedAt: 'unknown',
        leaseFile: fullPath,
        stale: true,
      });
    }
  }

  return leases.sort((a, b) => a.blockBase - b.blockBase);
}
