import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { acquirePortBlock, releasePortBlock } from './portLease.mjs';
import { APP_DIR, ROOT_DIR, SPAWN_OWN_PROCESS_GROUP, killProcessTree } from './runWithEmulators.mjs';

export function parsePortCliArgs(argv) {
  const args = [...argv];
  let suite = 'port-harness';
  let portEnv = 'PORT';
  const commandArgs = [];

  const doubleDashIdx = args.indexOf('--');
  let optionArgs = args;
  if (doubleDashIdx !== -1) {
    optionArgs = args.slice(0, doubleDashIdx);
    commandArgs.push(...args.slice(doubleDashIdx + 1));
  }

  for (let i = 0; i < optionArgs.length; i += 1) {
    const arg = optionArgs[i];
    if (arg === '--suite' && i + 1 < optionArgs.length) {
      suite = optionArgs[++i];
    } else if (arg === '--port-env' && i + 1 < optionArgs.length) {
      portEnv = optionArgs[++i];
    }
  }

  return {
    suite,
    portEnv,
    command: commandArgs,
  };
}

function serializeShellCommand(command) {
  if (typeof command === 'string') return command;
  if (command.length === 1) return command[0];
  return command
    .map((arg) => {
      if (arg.includes(' ') || arg.includes('"') || arg.includes(';')) {
        return `"${arg.replace(/"/g, '\\"')}"`;
      }
      return arg;
    })
    .join(' ');
}

export async function runWithPort({
  suite = 'port-harness',
  portEnv = 'PORT',
  command = [],
  cwd = APP_DIR,
  stdio = 'inherit',
  extraEnv = {},
} = {}) {
  const lease = await acquirePortBlock({
    suite,
    size: 2,
    worktree: ROOT_DIR,
  });

  const leasedPort = lease.ports[0];
  const injectedEnv = {
    ...process.env,
    ...extraEnv,
    [portEnv]: String(leasedPort),
  };

  const commandStr = serializeShellCommand(command);
  let childProc = null;

  const cleanup = () => {
    if (childProc && childProc.pid) {
      killProcessTree(childProc.pid);
    }
    releasePortBlock(lease);
  };

  const handleSignal = () => {
    cleanup();
    process.exit(130);
  };
  process.on('SIGINT', handleSignal);
  process.on('SIGTERM', handleSignal);

  try {
    const exitCode = await new Promise((res, rej) => {
      childProc = spawn(commandStr, {
        cwd,
        stdio,
        shell: true,
        env: injectedEnv,
        detached: SPAWN_OWN_PROCESS_GROUP,
      });
      childProc.on('error', rej);
      childProc.on('close', (code, signal) => {
        res(code ?? (signal ? 1 : 0));
      });
    });
    return exitCode;
  } finally {
    process.off('SIGINT', handleSignal);
    process.off('SIGTERM', handleSignal);
    cleanup();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const parsed = parsePortCliArgs(process.argv.slice(2));
  if (parsed.command.length === 0) {
    console.error('Usage: node runWithPort.mjs [--suite <name>] [--port-env <VAR>] -- <command...>');
    process.exit(1);
  }
  const code = await runWithPort(parsed);
  process.exit(code);
}
