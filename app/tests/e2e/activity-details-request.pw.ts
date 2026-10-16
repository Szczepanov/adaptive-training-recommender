import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import type { Page } from '@playwright/test';
import { expect, test } from './support/test';
import { completeTypicalCheckin, dismissOnboardingIfVisible, provisionAthlete, seedRecoverySnapshot, signInThroughUi } from './support/athlete';
import { inspectAthlete, seedWithRulesDisabled } from './support/emulator';

async function openElliptical(page: Page) {
  await page.setViewportSize({ width: 390, height: 844 });
  const athlete = await provisionAthlete();
  const date = await seedRecoverySnapshot(athlete);
  const activity = {
    activityId: 'elliptical-detail', date, type: 'elliptical', durationMin: 20,
    intensityTag: 'moderate', trainingEffectAerobic: 3, trainingEffectAnaerobic: 0,
    activityTrainingLoad: 60, averageHr: 140,
  };
  const annotation = { rpe: 6, equipmentLabel: 'Synthetic airbike', source: 'manual' };
  const lapAnnotation = { lapIndex: 1, averagePowerWatts: 210, rpe: 7, source: 'manual' };
  await seedWithRulesDisabled(async db => {
    await setDoc(doc(db, 'users', athlete.userId, 'activities', activity.activityId), activity);
    await setDoc(doc(db, 'users', athlete.userId, 'activity_annotations', activity.activityId), annotation);
    await setDoc(doc(db, 'users', athlete.userId, 'activity_annotations', activity.activityId, 'laps', '1'), lapAnnotation);
  });
  await signInThroughUi(page, athlete);
  await completeTypicalCheckin(page, athlete, date);
  await dismissOnboardingIfVisible(page);
  await page.locator('.bottom-nav').getByRole('button', { name: /More/ }).click();
  await page.getByRole('dialog', { name: 'Navigation & Settings' }).getByRole('button', { name: /Data/ }).click();
  await dismissOnboardingIfVisible(page);
  await page.getByRole('button', { name: 'Activities', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Fetch activity details', exact: true })).toBeVisible();
  return { athlete, activity, annotation, lapAnnotation };
}

test('explicit elliptical detail request reloads Garmin laps and preserves manual observations', async ({ page }) => {
  const { athlete, activity, annotation, lapAnnotation } = await openElliptical(page);
  await expect(page.getByRole('region', { name: 'Lap summaries', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Fetch activity details', exact: true }).click();
  await expect.poll(() => inspectAthlete(athlete, async db =>
    (await getDoc(doc(db, 'users', athlete.userId, 'garmin_sync_requests', 'latest'))).data()
  )).toMatchObject({ userId: athlete.userId, requestType: 'activity_details', activityId: activity.activityId, status: 'pending' });
  const laps = [{ lapIndex: 1, durationSeconds: 600, averageHrBpm: 148, maxHrBpm: 173 }, { lapIndex: 2, durationSeconds: 600, averageHrBpm: 135 }];
  await seedWithRulesDisabled(async db => {
    await updateDoc(doc(db, 'users', athlete.userId, 'activities', activity.activityId), { laps });
    await updateDoc(doc(db, 'users', athlete.userId, 'garmin_sync_requests', 'latest'), { status: 'completed', completedAt: new Date().toISOString() });
  });
  const lapRegion = page.getByRole('region', { name: 'Lap summaries', exact: true });
  await expect(lapRegion).toContainText('148 bpm');
  await expect(lapRegion).toContainText('173 bpm');
  await expect(lapRegion.getByText('210 W \u00b7 manual', { exact: true })).toBeVisible();
  await expect(lapRegion.getByText('RPE 7/10 \u00b7 manual', { exact: true })).toBeVisible();
  const details = page.getByRole('region', { name: 'Activity details', exact: true });
  await expect(details).toContainText('Whole-activity RPE: 6/10');
  await expect(details).toContainText('Actual equipment: Synthetic airbike');
  await expect(details).toContainText('Recorded by Garmin as: elliptical');
  await inspectAthlete(athlete, async db => {
    expect((await getDoc(doc(db, 'users', athlete.userId, 'activities', activity.activityId))).data()).toEqual({ ...activity, laps });
    expect((await getDoc(doc(db, 'users', athlete.userId, 'activity_annotations', activity.activityId))).data()).toEqual(annotation);
    expect((await getDoc(doc(db, 'users', athlete.userId, 'activity_annotations', activity.activityId, 'laps', '1'))).data()).toEqual(lapAnnotation);
  });
});

test('live unrelated request blocks detail fetching; no-data and failed results allow retry', async ({ page }) => {
  const { athlete } = await openElliptical(page);
  await seedWithRulesDisabled(db => setDoc(doc(db, 'users', athlete.userId, 'garmin_sync_requests', 'latest'), {
    userId: athlete.userId, requestType: 'sync', status: 'processing', requestedAt: new Date().toISOString(),
  }));
  const fetch = page.getByRole('button', { name: 'Fetch activity details', exact: true });
  await expect(fetch).toBeDisabled();
  await inspectAthlete(athlete, async db => {
    expect((await getDoc(doc(db, 'users', athlete.userId, 'garmin_sync_requests', 'latest'))).data()).toMatchObject({ requestType: 'sync', status: 'processing' });
  });
  await seedWithRulesDisabled(db => updateDoc(doc(db, 'users', athlete.userId, 'garmin_sync_requests', 'latest'), { status: 'completed' }));
  await expect(fetch).toBeEnabled();
  await fetch.click();
  await expect(page.getByText('Queued for the next Garmin sync check (up to 15 minutes).', { exact: true })).toBeVisible();
  await seedWithRulesDisabled(db => updateDoc(doc(db, 'users', athlete.userId, 'garmin_sync_requests', 'latest'), { status: 'completed' }));
  await expect(page.getByText('No laps returned by Garmin.', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Lap summaries', exact: true })).toHaveCount(0);
  await fetch.click();
  await expect(page.getByText('Queued for the next Garmin sync check (up to 15 minutes).', { exact: true })).toBeVisible();
  await seedWithRulesDisabled(db => updateDoc(doc(db, 'users', athlete.userId, 'garmin_sync_requests', 'latest'), { status: 'failed', error: 'Synthetic detail unavailable' }));
  await expect(page.getByText('Synthetic detail unavailable', { exact: true })).toBeVisible();
  await expect(fetch).toBeEnabled();
});
