import { reapStaleResources } from './harnessAdmin.mjs';

async function main() {
  const args = process.argv.slice(2);
  const yes = args.includes('--yes') || args.includes('-y');
  const dryRun = !yes;

  console.log(dryRun ? '=== Harness Reaper (DRY RUN - pass --yes to execute) ===' : '=== Harness Reaper (EXECUTING) ===');

  const result = await reapStaleResources({ dryRun });

  if (result.killedPids.length === 0 && result.removedLeaseFiles.length === 0 && result.removedLocators.length === 0) {
    console.log('No stale leases, listening orphan processes, or stale hub locators found.');
    return;
  }

  for (const { pid, blockBase } of result.killedPids) {
    console.log(`${dryRun ? '[dry-run] Would kill' : 'Killed'} orphan process PID ${pid} listening on stale block ${blockBase}`);
  }

  for (const leaseFile of result.removedLeaseFiles) {
    console.log(`${dryRun ? '[dry-run] Would remove' : 'Removed'} stale lease file: ${leaseFile}`);
  }

  for (const locatorFile of result.removedLocators) {
    console.log(`${dryRun ? '[dry-run] Would remove' : 'Removed'} stale hub locator: ${locatorFile}`);
  }

  if (dryRun) {
    console.log('\nRun "npm run harness:reap -- --yes" to reap stale resources.');
  } else {
    console.log('\nSuccessfully reaped all stale resources.');
  }
}

await main();
