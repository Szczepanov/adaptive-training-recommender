import { getHarnessStatus } from './harnessAdmin.mjs';

async function main() {
  const { leases, hubLocators } = await getHarnessStatus();

  console.log('=== Test Harness Leases ===');
  if (leases.length === 0) {
    console.log('No leases found.');
  } else {
    for (const l of leases) {
      const statusStr = l.stale ? '[STALE: PID DEAD]' : '[ACTIVE]';
      console.log(
        `${statusStr} Block ${l.blockBase} (${l.ports.join(', ')}) - Suite: ${l.suite} - PID: ${l.pid} - Worktree: ${l.worktree} - Started: ${l.startedAt}`,
      );
    }
  }

  console.log('\n=== Firebase Emulator Hub Locators ===');
  if (hubLocators.length === 0) {
    console.log('No demo hub locators in %TEMP%.');
  } else {
    for (const h of hubLocators) {
      const statusStr = h.stale ? '[STALE: NOT LISTENING]' : '[ACTIVE]';
      console.log(`${statusStr} ${h.file} (Project: ${h.projectId}, Port: ${h.port ?? 'n/a'})`);
    }
  }
}

await main();
