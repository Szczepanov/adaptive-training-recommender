import type { Page } from '@playwright/test';
import { expect, test } from './support/test';
import {
  dismissOnboardingIfVisible,
  provisionAthlete,
  seedRecoverySnapshot,
  signInThroughUi,
  submitTypicalCheckin,
} from './support/athlete';
import { openMoreDestination } from './support/navigation';
import {
  buildV6Plan,
  coachSession,
  finishStrength,
  readExecutions,
  seedExternalPlanRevision,
  seedLedgerModePreferences,
} from './support/roundTrip';

async function readClipboard(page: Page): Promise<string> {
  return page.evaluate(() => navigator.clipboard.readText());
}

function expectSessionReport(text: string): void {
  expect(text).toContain('# Session:');
  expect(text).toMatch(/^## .+/m);
  expect(text).toMatch(/^ref: \S+/m);
}

// One journey: complete an authored session, copy its report from Home (the post-session entry
// point), then from History (Data > Activities) at phone and desktop width.
test('a completed session copies a Markdown report for AI from Home and History', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const athlete = await provisionAthlete();
  const today = await seedRecoverySnapshot(athlete);
  await seedLedgerModePreferences(athlete, today);
  const session = coachSession(today);
  await seedExternalPlanRevision(athlete, buildV6Plan(today, { sessions: [session] }), today);

  await signInThroughUi(page, athlete);
  await dismissOnboardingIfVisible(page, 200);
  await submitTypicalCheckin(page);
  await dismissOnboardingIfVisible(page, 200);
  await page.getByRole('button', { name: `Start ${session.title}`, exact: true }).click();
  await finishStrength(page);
  await expect.poll(async () => (await readExecutions(athlete)).filter(e => e.state === 'completed').length).toBe(1);

  // Home: the post-session entry point on the completed LedgerTodayCard row.
  const homeButton = page.getByRole('button', { name: 'Copy session for AI', exact: true });
  await expect(homeButton).toBeVisible();
  await homeButton.click();
  await expect(page.getByRole('button', { name: '✓ Copied for AI' })).toBeVisible();
  expectSessionReport(await readClipboard(page));

  // History: Data > Activities, at phone and desktop width.
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => navigator.clipboard.writeText(''));
    await page.goto('/');
    await dismissOnboardingIfVisible(page);
    await openMoreDestination(page, /Data/);
    await dismissOnboardingIfVisible(page);
    await page.getByRole('button', { name: 'Activities', exact: true }).click();
    const button = page.getByRole('button', { name: '📋 Copy for AI' }).first();
    await expect(button).toBeVisible();
    await button.click();
    await expect(page.getByRole('button', { name: '✓ Copied for AI' }).first()).toBeVisible();
    expectSessionReport(await readClipboard(page));
  }
});
