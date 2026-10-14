/**
 * #895 criterion 12 through the real UI: a manual link/unlink made on the Activities screen
 * must survive a later sync/reconciliation sweep. Synthetic data only; the Auth and
 * Firestore emulators back the real app (canonical Activities read model enabled in
 * `.env.e2e`).
 */
import { doc, setDoc } from 'firebase/firestore';
import type { Locator, Page } from '@playwright/test';
import { expect, test } from './support/test';
import { dismissOnboardingIfVisible, provisionAthlete, seedRecoverySnapshot, signInThroughUi, type E2EAthlete } from './support/athlete';
import { seedWithRulesDisabled } from './support/emulator';
import { readPerformedOccurrences, awaitPerformedOccurrences } from './support/roundTrip';
import type { NormalizedGarminActivity } from '../../src/engine/models';
import type { SessionExecution } from '../../src/sessions/models';
import { parseNormalizedGarminActivity } from '../../src/persistence/parsers/trainingHistory';
import { addDaysToLocalDateString } from '../../src/utils/localDate';

// DataView swallows these (console.warn) so the UI keeps rendering; a swallowed failure
// would otherwise look like a missing card rather than the real defect.
const FORBIDDEN_CONSOLE = [
  /\[training-occurrence\] unlink failed/,
  /manual link failed/,
  /activities window reconciliation failed/,
  /canonical activities read failed/,
];

function trapForbiddenConsole(page: Page): () => void {
  const hits: string[] = [];
  page.on('console', msg => {
    const text = msg.text();
    if (FORBIDDEN_CONSOLE.some(pattern => pattern.test(text))) hits.push(text);
  });
  return () => expect(hits, `Swallowed reconciliation failure logged to the console:\n${hits.join('\n')}`).toEqual([]);
}

const FINGERPRINT = 'fit-workout-v2:0123456789abcdef0123456789abcdef';

function structuredExecution(athlete: E2EAthlete, date: string, overrides: Partial<SessionExecution> = {}): SessionExecution {
  return {
    userId: athlete.userId, executionId: 'exec-manual-1', occurrenceId: 'planned-manual-1',
    sessionSource: { kind: 'catalog', workoutId: 'strength-1', catalogVersion: '1' },
    date, startedAt: `${date}T10:00:00.000Z`, completedAt: `${date}T10:40:00.000Z`, updatedAt: `${date}T10:40:00.000Z`,
    state: 'completed', schemaVersion: 1, ...overrides,
  };
}

function garminActivity(athlete: E2EAthlete, date: string, overrides: Partial<NormalizedGarminActivity> = {}): NormalizedGarminActivity {
  const activity: NormalizedGarminActivity = {
    activityId: 'act-manual-1', date, startedAt: `${date}T10:01:00.000Z`, endedAt: `${date}T10:41:00.000Z`,
    type: 'strength_training', durationMin: 40, trainingEffectAerobic: null, trainingEffectAnaerobic: null,
    averageHr: null, activityTrainingLoad: null, intensityTag: 'moderate', ...overrides,
  };
  expect(parseNormalizedGarminActivity(activity, `users/${athlete.userId}/activities/${activity.activityId}`, activity.activityId).status).toBe('AVAILABLE');
  return activity;
}

const seedExecution = (athlete: E2EAthlete, execution: SessionExecution) =>
  seedWithRulesDisabled(db => setDoc(doc(db, 'users', athlete.userId, 'session_executions', execution.executionId), execution));
const seedActivity = (athlete: E2EAthlete, activity: NormalizedGarminActivity) =>
  seedWithRulesDisabled(db => setDoc(doc(db, 'users', athlete.userId, 'activities', activity.activityId), activity));

async function openActivities(page: Page): Promise<Locator> {
  await dismissOnboardingIfVisible(page, 200);
  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('button', { name: /Data/ }).click();
  await page.getByRole('button', { name: 'Activities', exact: true }).click();
  return page.locator('article.activity-telemetry-card');
}

async function reopenActivitiesAfterReload(page: Page): Promise<Locator> {
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Check-in', exact: true })).toBeVisible();
  return openActivities(page);
}

const swept = (page: Page) => expect(page.getByText('did not evaluate every recording')).toHaveCount(0);

/** Proves the re-synced activity was processed: the stored provider ref carries the new fingerprint. */
async function expectResyncedActivityStored(athlete: E2EAthlete, date: string): Promise<void> {
  await expect.poll(async () => (await readPerformedOccurrences(athlete, date))
    .flatMap(row => row.sourceRefs)
    .filter(ref => ref.kind === 'provider_activity')
    .map(ref => (ref as { fitWorkoutFingerprint?: string }).fitWorkoutFingerprint)).toEqual([FINGERPRINT]);
}

function sourceKinds(row: { sourceRefs: { kind: string }[] }): string[] {
  return row.sourceRefs.map(ref => ref.kind).sort();
}

test.describe('Activities manual reconciliation survives a later sweep (#895 criterion 12)', () => {
  test.setTimeout(90_000);

  test('a manual unlink stays unlinked after a re-synced activity, reload and re-sweep', async ({ page }) => {
    const assertConsoleClean = trapForbiddenConsole(page);
    const athlete = await provisionAthlete();
    const date = addDaysToLocalDateString(await seedRecoverySnapshot(athlete), -1);
    await seedExecution(athlete, structuredExecution(athlete, date));
    await seedActivity(athlete, garminActivity(athlete, date));
    await signInThroughUi(page, athlete);

    // The first Activities load sweeps the window and auto-links the overlapping pair.
    let cards = await openActivities(page);
    await expect(cards).toHaveCount(1);
    await swept(page);
    const [matched] = await awaitPerformedOccurrences(athlete, date, 1);
    expect(sourceKinds(matched)).toEqual(['provider_activity', 'structured_execution']);

    await cards.first().getByText('Source provenance').click();
    await cards.first().getByRole('button', { name: 'Unlink Garmin source' }).click();
    await expect(cards).toHaveCount(2);
    // A separated pair is never re-offered (manualLinkCandidatesFor / excludedSourceKeys).
    await expect(page.getByRole('button', { name: /^Link Garmin/ })).toHaveCount(0);

    const expectUnlinkedStored = async () => {
      const rows = await awaitPerformedOccurrences(athlete, date, 2);
      for (const row of rows) {
        expect(row.sourceRefs).toHaveLength(1);
        expect(row.reconciliation.manualDecision).toMatchObject({ decision: 'unlink', actor: athlete.userId });
        expect(row.reconciliation.excludedSourceKeys?.length ?? 0).toBeGreaterThan(0);
      }
      expect(rows.flatMap(sourceKinds).sort()).toEqual(['provider_activity', 'structured_execution']);
      return rows.map(row => ({ id: row.performedOccurrenceId, decision: row.reconciliation.manualDecision?.decision, excluded: row.reconciliation.excludedSourceKeys }))
        .sort((a, b) => a.id.localeCompare(b.id));
    };
    const afterUnlink = await expectUnlinkedStored();

    // A later sync re-delivers the same activity with changed fields; the next Activities
    // load sweeps again and must not re-link the pair.
    await seedActivity(athlete, garminActivity(athlete, date, { endedAt: `${date}T10:42:00.000Z`, durationMin: 41, fitWorkoutFingerprint: FINGERPRINT, fitWorkoutFingerprintKind: 'semantic_definition' }));
    cards = await reopenActivitiesAfterReload(page);
    await expect(cards).toHaveCount(2);
    await expect(page.getByRole('button', { name: /^Link Garmin/ })).toHaveCount(0);
    await swept(page);
    await expectResyncedActivityStored(athlete, date);
    expect(await expectUnlinkedStored()).toEqual(afterUnlink);
    assertConsoleClean();
  });

  test('a manual link stays linked after a re-synced activity, reload and re-sweep', async ({ page }) => {
    const assertConsoleClean = trapForbiddenConsole(page);
    const athlete = await provisionAthlete();
    const date = addDaysToLocalDateString(await seedRecoverySnapshot(athlete), -1);
    // Two genuine same-day workouts: the watch recording is hours after the logged session.
    await seedExecution(athlete, structuredExecution(athlete, date));
    await seedActivity(athlete, garminActivity(athlete, date, {
      startedAt: `${date}T16:00:00.000Z`, endedAt: `${date}T16:40:00.000Z`,
    }));
    await signInThroughUi(page, athlete);

    let cards = await openActivities(page);
    await expect(cards).toHaveCount(2);
    await swept(page);
    const separate = await awaitPerformedOccurrences(athlete, date, 2);
    expect(separate.every(row => row.sourceRefs.length === 1)).toBe(true);

    const offer = page.getByRole('region', { name: 'Link watch recording' });
    await expect(offer).toHaveCount(1);
    await offer.getByRole('button', { name: /^Link Garmin/ }).click();
    await expect(cards).toHaveCount(1);
    await cards.first().getByText('Source provenance').click();
    await expect(cards.first().getByRole('button', { name: 'Unlink Garmin source' })).toBeVisible();

    const expectLinkedStored = async () => {
      const rows = await awaitPerformedOccurrences(athlete, date, 1);
      expect(sourceKinds(rows[0])).toEqual(['provider_activity', 'structured_execution']);
      expect(rows[0].reconciliation.manualDecision).toMatchObject({ decision: 'link', actor: athlete.userId });
      return { id: rows[0].performedOccurrenceId, decision: rows[0].reconciliation.manualDecision?.decision };
    };
    const afterLink = await expectLinkedStored();
    expect(separate.map(row => row.performedOccurrenceId)).toContain(afterLink.id);

    await seedActivity(athlete, garminActivity(athlete, date, {
      startedAt: `${date}T16:00:00.000Z`, endedAt: `${date}T16:42:00.000Z`, durationMin: 42,
      fitWorkoutFingerprint: FINGERPRINT, fitWorkoutFingerprintKind: 'semantic_definition',
    }));
    cards = await reopenActivitiesAfterReload(page);
    await expect(cards).toHaveCount(1);
    await swept(page);
    await cards.first().getByText('Source provenance').click();
    await expect(cards.first().getByRole('button', { name: 'Unlink Garmin source' })).toBeVisible();
    await expectResyncedActivityStored(athlete, date);
    expect(await expectLinkedStored()).toEqual(afterLink);
    assertConsoleClean();
  });
});
