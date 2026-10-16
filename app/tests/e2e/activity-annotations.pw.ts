import { doc, getDoc, setDoc } from 'firebase/firestore';
import { expect, test } from './support/test';
import { completeTypicalCheckin, dismissOnboardingIfVisible, provisionAthlete, seedRecoverySnapshot, signInThroughUi } from './support/athlete';
import { inspectAthlete, seedWithRulesDisabled } from './support/emulator';

test('airbike lap watts and RPE stay separate from workout effort and original Garmin telemetry', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const athlete = await provisionAthlete();
  const date = await seedRecoverySnapshot(athlete);
  const activity = {
    activityId: 'airbike-laps', date, type: 'elliptical', durationMin: 36,
    intensityTag: 'moderate', trainingEffectAerobic: 3, trainingEffectAnaerobic: 0,
    activityTrainingLoad: 80, averageHr: 145,
    laps: [
      { lapIndex: 1, durationSeconds: 600, averageHrBpm: 150 },
      { lapIndex: 2, durationSeconds: 120, averageHrBpm: 125 },
      { lapIndex: 3, durationSeconds: 600, averageHrBpm: 155 },
      { lapIndex: 4, durationSeconds: 120, averageHrBpm: 128 },
      { lapIndex: 5, durationSeconds: 600, averageHrBpm: 158 },
    ],
  };
  await seedWithRulesDisabled(async db => {
    await setDoc(doc(db, 'users', athlete.userId, 'activities', activity.activityId), activity);
    await setDoc(doc(db, 'users', athlete.userId, 'activity_overrides', activity.activityId), {
      activityId: activity.activityId, userId: athlete.userId, date,
      originalType: activity.type, originalIntensityTag: activity.intensityTag,
      overriddenModality: 'Cross Training', overriddenIntensity: 'moderate', rpe: 5.5,
      createdAt: `${date}T08:00:00Z`, updatedAt: `${date}T08:00:00Z`,
    });
  });
  await signInThroughUi(page, athlete);
  await completeTypicalCheckin(page, athlete, date);
  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('dialog', { name: 'Navigation & Settings' }).getByRole('button', { name: /Data/ }).click();
  await dismissOnboardingIfVisible(page);
  await page.getByRole('button', { name: 'Activities', exact: true }).click();
  const laps = page.getByRole('region', { name: 'Lap summaries', exact: true });
  const details = page.getByRole('region', { name: 'Activity details', exact: true });
  await expect(details).toContainText('Recorded by Garmin as: elliptical');
  await expect(details).toContainText('Whole-activity RPE: 5.5/10');
  for (const lap of [1, 3, 5]) {
    await laps.getByRole('button', { name: `Edit lap ${lap} details`, exact: true }).click();
    await laps.getByRole('spinbutton', { name: `Lap ${lap} average power (W)` }).fill('253');
    await laps.getByRole('spinbutton', { name: `Lap ${lap} RPE (1–10)` }).fill('7');
    await laps.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(laps.getByRole('status')).toHaveText(`Details saved for lap ${lap}.`);
  }
  await expect(details).toContainText('Whole-activity RPE: 5.5/10');
  await details.getByRole('button', { name: 'Edit activity details' }).click();
  await details.getByLabel('Whole-activity RPE (1–10, optional)').fill('');
  await details.getByLabel('Actual equipment (optional)').fill('Airbike — Rogue/Assault');
  await details.getByRole('button', { name: 'Save activity details' }).click();
  await expect(details).toContainText('Whole-activity RPE: Not recorded');
  await page.reload();
  await dismissOnboardingIfVisible(page);
  await page.getByRole('button', { name: 'Activities', exact: true }).click();
  await expect(details).toContainText('Whole-activity RPE: Not recorded');
  await expect(details).toContainText('Actual equipment: Airbike — Rogue/Assault');
  await expect(laps.getByText('253 W · manual', { exact: true })).toHaveCount(3);
  await expect(laps.getByText('RPE 7/10 · manual', { exact: true })).toHaveCount(3);
  await expect(laps).toContainText('158 bpm');
  await details.getByRole('button', { name: 'Edit activity details' }).click();
  await details.getByLabel('Whole-activity RPE (1–10, optional)').fill('6');
  await details.getByRole('button', { name: 'Save activity details' }).click();
  await expect(details).toContainText('Whole-activity RPE: 6/10');
  await laps.getByRole('button', { name: 'Edit lap 1 details', exact: true }).click();
  const watts = laps.getByRole('spinbutton', { name: 'Lap 1 average power (W)' });
  const rpe = laps.getByRole('spinbutton', { name: 'Lap 1 RPE (1–10)' });
  await watts.fill('225');
  await laps.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(laps.getByText('253 W · manual', { exact: true })).toHaveCount(3);
  await laps.getByRole('button', { name: 'Edit lap 1 details', exact: true }).click();
  await watts.fill('');
  await laps.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(laps.getByText('253 W · manual', { exact: true })).toHaveCount(2);
  await expect(laps.getByText('RPE 7/10 · manual', { exact: true })).toHaveCount(3);
  await page.screenshot({ path: testInfo.outputPath('activity-annotations-mobile.png'), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: testInfo.outputPath('activity-annotations-desktop.png'), fullPage: true });
  await laps.getByRole('button', { name: 'Edit lap 1 details', exact: true }).click();
  await rpe.fill('');
  await laps.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(laps.getByText('RPE 7/10 · manual', { exact: true })).toHaveCount(2);
  await inspectAthlete(athlete, async db => {
    expect((await getDoc(doc(db, 'users', athlete.userId, 'activities', activity.activityId))).data()).toEqual(activity);
    expect((await getDoc(doc(db, 'users', athlete.userId, 'activity_annotations', activity.activityId))).data()).toEqual({ rpe: 6, equipmentLabel: 'Airbike — Rogue/Assault', source: 'manual' });
    for (const lap of ['1', '2', '4']) {
      expect((await getDoc(doc(db, 'users', athlete.userId, 'activity_annotations', activity.activityId, 'laps', lap))).exists()).toBe(false);
    }
    expect((await getDoc(doc(db, 'users', athlete.userId, 'activity_annotations', activity.activityId, 'laps', '5'))).data()).toMatchObject({ averagePowerWatts: 253, rpe: 7, source: 'manual' });
  });
});
