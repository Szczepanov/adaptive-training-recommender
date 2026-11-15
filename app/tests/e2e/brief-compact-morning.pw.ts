import { doc, setDoc } from 'firebase/firestore';
import { expect, test } from './support/test';
import { completeTypicalCheckin, provisionAthlete, seedRecoverySnapshot, signInThroughUi } from './support/athlete';
import { seedWithRulesDisabled } from './support/emulator';
import { buildV6Plan, coachSession, seedExternalPlanRevision, seedLedgerModePreferences, seedPlacement } from './support/roundTrip';
import { openMoreDestination } from './support/navigation';
import { addDaysToLocalDateString } from '../../src/utils/localDate';
import { weekdayOf } from './support/externalPlan';
import type { PerformedTrainingOccurrence } from '../../src/training-occurrence/models';

const UPCOMING_TITLE = 'E2E upcoming tempo';

// The morning export in ledger mode (the default): Today / Yesterday / Upcoming sections, with
// the second Markdown copy abbreviating user context the reader already holds.
test('compact morning brief: sections, unchanged-context abbreviation and full-context override at 1440px and 390px', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const athlete = await provisionAthlete();
  const today = await seedRecoverySnapshot(athlete);
  await seedLedgerModePreferences(athlete, today);
  const yesterday = addDaysToLocalDateString(today, -1);
  const upcoming = addDaysToLocalDateString(today, 3);

  const plan = buildV6Plan(today, {
    sessions: [
      coachSession(today),
      coachSession(upcoming, { id: 'session-upcoming', title: UPCOMING_TITLE, placement: { week: 1, preferredDay: weekdayOf(upcoming), flexibility: 'fixed', ifMissed: 'drop' } }),
    ],
  });
  await seedExternalPlanRevision(athlete, plan, today);
  await seedPlacement(athlete, {
    userId: athlete.userId, planId: plan.planId, revision: plan.revision, updatedAt: `${today}T06:00:00.000Z`,
    assignments: [
      { sessionId: 'session-today', date: today, status: 'planned' },
      { sessionId: 'session-upcoming', date: upcoming, status: 'planned' },
    ],
  });
  const occurrence: PerformedTrainingOccurrence = {
    schemaVersion: 1, performedOccurrenceId: 'e2e-yesterday-strength', userId: athlete.userId, status: 'active',
    startedAt: `${yesterday}T16:00:00.000Z`, endedAt: `${yesterday}T16:45:00.000Z`, localDate: yesterday, modality: 'strength',
    sourceRefs: [{ kind: 'provider_activity', provider: 'garmin', activityId: 'e2e-yesterday-strength' }],
    reconciliation: { state: 'single_source' },
    createdAt: `${today}T06:00:00.000Z`, updatedAt: `${today}T06:00:00.000Z`,
  };
  await seedWithRulesDisabled(db => setDoc(doc(db, 'users', athlete.userId, 'performedTrainingOccurrences', occurrence.performedOccurrenceId), occurrence));

  await page.setViewportSize({ width: 1440, height: 900 });
  await signInThroughUi(page, athlete);
  await page.getByRole('button', { name: 'Check-in', exact: true }).click();
  await completeTypicalCheckin(page, athlete, today);
  await openMoreDestination(page, /^📤 Export Context for AI/);
  await page.getByRole('button', { name: /Morning Coach/ }).click();

  const brief = page.locator('textarea.brief-text');
  await expect.poll(() => brief.inputValue()).toContain('# Ledger update');
  const copy = async () => {
    await page.getByRole('button', { name: 'Copy to clipboard', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Copied', exact: true })).toBeVisible();
    return page.evaluate(() => navigator.clipboard.readText());
  };

  const chat = page.getByLabel('Chat', { exact: true });
  const reopenBrief = async () => {
    await page.reload();
    await openMoreDestination(page, /^📤 Export Context for AI/);
    await page.getByRole('button', { name: /Morning Coach/ }).click();
    await expect.poll(() => brief.inputValue()).toContain('# Ledger update');
  };
  const nameChat = async (name: string) => {
    await chat.fill(name);
    await chat.press('Enter');
  };

  // No chat named: full context, and there is nothing to confirm.
  await expect(page.getByRole('button', { name: 'Added to this chat', exact: true })).toBeDisabled();
  await nameChat('Coach');
  const first = await copy();
  expect(first).toContain(`## Today (${today})`);
  expect(first).toContain(`## Yesterday (${yesterday})`);
  expect(first.slice(first.indexOf('## Yesterday'), first.indexOf('## Upcoming'))).toContain('strength · 45 min');
  expect(first).toContain('## Upcoming (');
  expect(first).toContain(UPCOMING_TITLE);
  expect(first).not.toContain('unchanged since');

  // Copying alone never advances the checkpoint: after a reload the export is still full.
  await reopenBrief();
  await expect(chat).toHaveValue('Coach');
  expect(await copy()).not.toContain('unchanged since');

  // Confirming the exported snapshot does; the next export abbreviates what the chat holds.
  const confirm = page.getByRole('button', { name: 'Added to this chat', exact: true });
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(page.getByRole('status').filter({ hasText: 'Checkpoint saved for "Coach"' })).toBeVisible();
  await reopenBrief();
  await expect.poll(() => brief.inputValue()).toContain('unchanged since');
  const second = await copy();
  expect(second).toContain('unchanged since');
  expect(second).toContain(UPCOMING_TITLE);

  // A different chat has no checkpoint.
  await nameChat('New chat');
  await expect.poll(() => brief.inputValue()).not.toContain('unchanged since');
  const other = await copy();
  expect(other).not.toContain('unchanged since');
  expect(other).not.toContain('New chat');
  await nameChat('Coach');
  await expect.poll(() => brief.inputValue()).toContain('unchanged since');

  // Same checks at phone width: the toggle is the way back to the full context.
  await page.setViewportSize({ width: 390, height: 900 });
  const fullContext = page.getByLabel('Include full context');
  await expect(fullContext).toBeVisible();
  await fullContext.check();
  await expect.poll(() => brief.inputValue()).not.toContain('unchanged since');
  const full = await copy();
  expect(full).not.toContain('unchanged since');
  expect(full).toContain(`## Upcoming (`);
  await fullContext.uncheck();
  await expect.poll(() => brief.inputValue()).toContain('unchanged since');
});
