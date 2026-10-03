import { expect, test, type Page } from '@playwright/test';
import {
  dismissOnboardingIfVisible,
  hasPersistedCheckin,
  provisionAthlete,
  seedRecoverySnapshot,
  signInThroughUi,
  type E2EAthlete,
} from './support/athlete';
import { ASSESSMENT_CSV_HEADERS } from '../../src/observations/assessmentCsvExport';
import { buildOpenBarAnalysis } from '../../src/observations/fixtures/openBarAnalysisFixtures';

/** Minimal single-rep WL Analysis per-frame export: descent then one concentric ascent. */
function wlSingleRepCsv(weightKg: number, tags: string, ascentVelocity: number, peakVelocity: number): string {
  const frameRate = 30;
  const depthCm = -50;
  const descentFrames = 10;
  const ascentFrames = 10;
  const lines = [
    'Video id,date,Video resolution,Frame rate,weight,tags',
    `1,03/02/2025,1080x1920,${frameRate}.0,${weightKg},${tags}`,
    '',
    'Video id: 1',
    ', average, Min, time of min, Max, time of max',
    '"velocity (vertical, m/s)", -0.00, -0.69, 33.896,  0.87, 24.197',
    '"displacement (vertical, cm)", -18.90, -63.78, 19.197,  8.80, 35.429',
    '',
    'Video id: 1',
    'Frame ordinal,Time (s),"velocity (vertical, m/s)","acceleration (vertical, m/s^2)","displacement (vertical, cm)","power (vertical, kW)","force (vertical, kN)"',
  ];
  let ordinal = 1;
  let time = 16.231;
  const push = (velocity: number, displacement: number): void => {
    lines.push(`${ordinal},${time.toFixed(3)},${velocity.toFixed(2)},0.00,${displacement.toFixed(2)},0.00,1.47`);
    ordinal += 1;
    time += 1 / frameRate;
  };
  for (let i = 0; i < 5; i += 1) push(0, 0);
  for (let i = 0; i < descentFrames; i += 1) push(-0.5, (depthCm * (i + 1)) / descentFrames);
  for (let i = 0; i < ascentFrames; i += 1) {
    const velocity = i === Math.floor(ascentFrames / 2) ? peakVelocity : ascentVelocity;
    push(velocity, depthCm + ((0 - depthCm) * i) / (ascentFrames - 1));
  }
  for (let i = 0; i < 5; i += 1) push(0, 0);
  return lines.join('\n');
}

async function completeCheckin(page: Page, athlete: E2EAthlete, date: string): Promise<void> {
  await page.getByRole('button', { name: /Feeling normal today\? Use typical values/ }).click();
  await page.getByRole('button', { name: "Save & see today's plan", exact: true }).click();
  await expect.poll(() => hasPersistedCheckin(athlete, date)).toBe(true);
  await dismissOnboardingIfVisible(page);
  await expect(page.getByLabel("Today's Morning Training Decision")).toBeVisible();
}

test('physical capital assessment: standing broad jump trial capture, checkpoint attempt, history comparability, and exports', async ({ page }) => {
  const athlete = await provisionAthlete();
  const date = await seedRecoverySnapshot(athlete);

  await signInThroughUi(page, athlete);
  await completeCheckin(page, athlete, date);

  // Navigate to Testing via desktop More menu
  const nav = page.locator('.navbar-desktop-menu');
  await nav.getByRole('button', { name: /More/ }).click();
  await page.locator('#desktop-more-panel').getByRole('button', { name: /Testing/ }).click();
  await expect(page).toHaveURL(/\?screen=testing$/);

  // Stage 0: History tab initially shows empty state
  await page.getByRole('tab', { name: 'History' }).click();
  await expect(page.getByRole('heading', { name: 'Assessment History', exact: true })).toBeVisible();
  await expect(page.getByText('No assessment history recorded yet')).toBeVisible();
  await page.getByRole('tab', { name: 'Protocols' }).click();

  // Stage 1: Lookup screen shows bundled assessments grouped by family
  await expect(page.getByRole('heading', { name: 'Bundled assessments' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Cycling' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Strength' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Field & power' })).toBeVisible();

  // Select Standing broad jump
  await page.getByRole('button', { name: 'Standing broad jump · rev 2' }).click();

  // Stage 2: Ready screen shows protocol lock, instructions & comparison context
  await expect(page.getByRole('heading', { name: 'Lock comparison context' })).toBeVisible();
  await expect(page.getByText('Protocol instructions & safety:')).toBeVisible();
  await page.getByLabel(/equipment_setup_id/).fill('gym-floor-a · tape-line-a · same shoes');

  // Start the baseline test
  await page.getByRole('button', { name: 'Confirm lock and start' }).click();

  // Stage 3: Running screen in SessionRunner
  await expect(page.getByText(/Locked assessment: Standing broad jump/)).toBeVisible();
  await page.getByRole('button', { name: /Finish Session \(/ }).click();
  await expect(page.getByRole('dialog', { name: 'Complete Session' })).toBeVisible();
  await page.getByRole('button', { name: 'Finish & Save Session', exact: true }).click();

  // Stage 4: Trial capture screen
  await expect(page.getByRole('heading', { name: 'Record assessment trials' })).toBeVisible();

  // Enter trial 1: 220 cm (valid)
  const distanceInputs = page.locator('input[placeholder="1–400"]');
  await expect(distanceInputs).toHaveCount(3);
  await distanceInputs.nth(0).fill('220');

  // Enter trial 2: 245 cm but mark invalid
  await distanceInputs.nth(1).fill('245');
  const invalidRadio2 = page.locator('input[name="validity-2"][value="invalid"]');
  await invalidRadio2.check();
  const invalidReasonInput = page.getByPlaceholder(/stepped off line/).first();
  await invalidReasonInput.fill('Foot stepped over take-off line');

  // Enter trial 3: 238 cm (valid)
  await distanceInputs.nth(2).fill('238');

  // Verify live preview shows 238 cm as best valid (from trial 3)
  const preview = page.locator('.canonical-preview-container');
  await expect(preview).toContainText('238 cm');
  await expect(preview).toContainText('attempt 3');

  // Save the assessment trials
  await page.getByRole('button', { name: 'Save assessment trials' }).click();

  // Stage 5: Completion screen shows canonical results and raw trial table
  await expect(page.getByRole('heading', { name: 'Assessment recorded' })).toBeVisible();
  await expect(page.locator('.testing-observations')).toContainText('238 cm');
  await expect(page.locator('.trial-history-table')).toBeVisible();

  // Stage 6: append-only trial correction re-derives the benchmark as revision 2
  await page.locator('.trial-history-table .trial-correct-btn').nth(2).click();
  const editor = page.locator('.trial-edit-modal');
  await editor.locator('input[type="number"]').fill('236');
  await editor.getByPlaceholder(/Corrected misread display/).fill('Tape misread on trial 3');
  await editor.getByRole('button', { name: 'Save correction' }).click();
  await expect(editor).toBeHidden();
  await expect(page.locator('.testing-observations')).toContainText('236 cm');
  await expect(page.locator('.testing-observations')).toContainText('rev 2');
  await expect(page.locator('.trial-history-table')).toContainText('Superseded');

  // Done closes or returns to home
  await page.getByRole('button', { name: 'Done' }).click();

  // Check History tab reflects the baseline attempt
  await nav.getByRole('button', { name: /More/ }).click();
  await page.locator('#desktop-more-panel').getByRole('button', { name: /Testing/ }).click();
  await expect(page).toHaveURL(/\?screen=testing$/);
  await page.getByRole('tab', { name: 'History' }).click();

  const broadJumpCard = page.locator('.assessment-series-card', { hasText: 'Standing broad jump' });
  await expect(broadJumpCard).toBeVisible();
  await expect(broadJumpCard.locator('.headline-stat', { hasText: 'Baseline' })).toContainText('236 cm');
  await expect(broadJumpCard.locator('.headline-stat', { hasText: 'Latest' })).toContainText('—');
  await expect(broadJumpCard.locator('.status-label-badge')).toContainText('no comparable repeat yet');
  await expect(broadJumpCard.locator('.history-attempt-row')).toHaveCount(1);

  // Switch back to Protocols tab to start second attempt (checkpoint attempt, SAME setup)
  await page.getByRole('tab', { name: 'Protocols' }).click();
  await page.getByRole('button', { name: 'Standing broad jump · rev 2' }).click();
  await expect(page.getByRole('heading', { name: 'Lock comparison context' })).toBeVisible();

  // Use the exact same series-defining setup, then change purpose to checkpoint.
  await page.getByLabel(/equipment_setup_id/).fill('gym-floor-a · tape-line-a · same shoes');
  await page.getByLabel('Attempt purpose').selectOption('checkpoint');
  await page.getByRole('button', { name: 'Confirm lock and start' }).click();

  // Finish running session
  await page.getByRole('button', { name: /Finish Session \(/ }).click();
  await expect(page.getByRole('dialog', { name: 'Complete Session' })).toBeVisible();
  await page.getByRole('button', { name: 'Finish & Save Session', exact: true }).click();

  // Capture checkpoint trial
  await expect(page.getByRole('heading', { name: 'Record assessment trials' })).toBeVisible();
  const checkpointDistanceInputs = page.locator('input[placeholder="1–400"]');
  await checkpointDistanceInputs.nth(0).fill('242');
  await checkpointDistanceInputs.nth(1).fill('240');
  await checkpointDistanceInputs.nth(2).fill('239');
  await page.getByRole('button', { name: 'Save assessment trials' }).click();

  // Verify completion screen for checkpoint attempt
  await expect(page.getByRole('heading', { name: 'Assessment recorded' })).toBeVisible();
  await expect(page.locator('.testing-observations')).toContainText('242 cm');
  await page.getByRole('button', { name: 'Done' }).click();

  // Check History tab reflects the checkpoint and progress delta
  await nav.getByRole('button', { name: /More/ }).click();
  await page.locator('#desktop-more-panel').getByRole('button', { name: /Testing/ }).click();
  await expect(page).toHaveURL(/\?screen=testing$/);
  await page.getByRole('tab', { name: 'History' }).click();

  const broadJumpCardAfterCheckpoint = page.locator('.assessment-series-card', { hasText: 'Standing broad jump' });
  await expect(broadJumpCardAfterCheckpoint.locator('.headline-stat', { hasText: 'Baseline' })).toContainText('236 cm');
  await expect(broadJumpCardAfterCheckpoint.locator('.headline-stat', { hasText: 'Latest' })).toContainText('242 cm');
  await expect(broadJumpCardAfterCheckpoint.locator('.delta-stat')).toContainText('+6 cm');
  await expect(broadJumpCardAfterCheckpoint.locator('.delta-stat')).toContainText('+2.5%');
  await expect(broadJumpCardAfterCheckpoint.locator('.status-label-badge')).toContainText('raw change, no reliability estimate');
  await expect(broadJumpCardAfterCheckpoint.locator('.history-attempt-row')).toHaveCount(2);

  // Switch back to Protocols tab to start third attempt (different setup -> comparability split)
  await page.getByRole('tab', { name: 'Protocols' }).click();
  await page.getByRole('button', { name: 'Standing broad jump · rev 2' }).click();
  await expect(page.getByRole('heading', { name: 'Lock comparison context' })).toBeVisible();

  // Different setup: grass field
  await page.getByLabel(/equipment_setup_id/).fill('grass-field-b · tape-line-b · trail shoes');
  await page.getByLabel('Attempt purpose').selectOption('checkpoint');
  await page.getByRole('button', { name: 'Confirm lock and start' }).click();

  // Finish running session
  await page.getByRole('button', { name: /Finish Session \(/ }).click();
  await expect(page.getByRole('dialog', { name: 'Complete Session' })).toBeVisible();
  await page.getByRole('button', { name: 'Finish & Save Session', exact: true }).click();

  // Capture third attempt trial
  await expect(page.getByRole('heading', { name: 'Record assessment trials' })).toBeVisible();
  const thirdDistanceInputs = page.locator('input[placeholder="1–400"]');
  await thirdDistanceInputs.nth(0).fill('215');
  await thirdDistanceInputs.nth(1).fill('212');
  await thirdDistanceInputs.nth(2).fill('210');
  await page.getByRole('button', { name: 'Save assessment trials' }).click();

  await expect(page.getByRole('heading', { name: 'Assessment recorded' })).toBeVisible();
  await expect(page.locator('.testing-observations')).toContainText('215 cm');
  await page.getByRole('button', { name: 'Done' }).click();

  // Inspect History tab with comparability split
  await nav.getByRole('button', { name: /More/ }).click();
  await page.locator('#desktop-more-panel').getByRole('button', { name: /Testing/ }).click();
  await expect(page).toHaveURL(/\?screen=testing$/);
  await page.getByRole('tab', { name: 'History' }).click();

  const broadJumpCardMulti = page.locator('.assessment-series-card', { hasText: 'Standing broad jump' });
  await expect(broadJumpCardMulti.locator('.active-series-section .headline-stat', { hasText: 'Baseline' })).toContainText('215 cm');
  await expect(broadJumpCardMulti.locator('.active-series-section .headline-stat', { hasText: 'Latest' })).toContainText('—');
  const otherSeries = broadJumpCardMulti.locator('.other-series-disclosure');
  await expect(otherSeries).toBeVisible();
  await otherSeries.locator('summary').click();
  await expect(otherSeries.locator('.not-comparable-marker').first()).toContainText('not comparable: setup/method changed');
  await expect(otherSeries.locator('.other-series-stats').first()).toContainText('Baseline: 236 cm');
  await expect(otherSeries.locator('.other-series-stats').first()).toContainText('Latest: 242 cm');

  // Test Attempt detail modal
  await broadJumpCardMulti.getByRole('button', { name: /View attempt .* details/ }).first().click();
  const detailModal = page.locator('[role="dialog"][aria-labelledby="attempt-detail-title"]');
  await expect(detailModal).toBeVisible();
  await expect(detailModal.locator('#attempt-detail-title')).toContainText('Standing broad jump · rev 2');
  await expect(detailModal.locator('.attempt-metadata-grid')).toContainText('Purpose:');
  await expect(detailModal.locator('.attempt-benchmarks-list')).toBeVisible();
  await expect(detailModal.locator('.attempt-trials-table')).toBeVisible();
  await detailModal.getByRole('button', { name: 'Close detail' }).click();
  await expect(detailModal).toBeHidden();

  // Test CSV export from History toolbar
  const csvDownloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export history (CSV)' }).click();
  const csvDownload = await csvDownloadPromise;
  const csvStream = await csvDownload.createReadStream();
  const csvChunks: Buffer[] = [];
  for await (const chunk of csvStream) {
    csvChunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  const csvContent = Buffer.concat(csvChunks).toString('utf-8');
  const csvLines = csvContent.trim().split('\n');
  expect(csvLines[0]).toBe(ASSESSMENT_CSV_HEADERS.join(','));
  expect(csvContent).toContain('field-standing-broad-jump');
  expect(csvContent).toContain('236');
  expect(csvContent).toContain('242');
  expect(csvContent).toContain('215');
  expect(csvContent).not.toContain(athlete.userId);

  // Test diagnostic JSON export from History toolbar
  const jsonDownloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export physical-capital evidence (JSON)' }).click();
  const jsonDownload = await jsonDownloadPromise;
  const jsonStream = await jsonDownload.createReadStream();
  const jsonChunks: Buffer[] = [];
  for await (const chunk of jsonStream) {
    jsonChunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  const fileContent = Buffer.concat(jsonChunks).toString('utf-8');
  const parsed = JSON.parse(fileContent);

  expect(parsed.schemaVersion).toBe('assessment_diagnostic_export_v2');
  expect(parsed.protocols.some((p: { id: string; revision: number }) => p.id === 'field-standing-broad-jump' && p.revision === 2)).toBe(true);
  expect(parsed.attempts.length).toBeGreaterThanOrEqual(3);
  expect(parsed.trials.length).toBeGreaterThanOrEqual(9);
  expect(parsed.canonicalObservations.length).toBeGreaterThanOrEqual(3);
  // Verify Firebase UID is omitted
  expect(JSON.stringify(parsed)).not.toContain(athlete.userId);
});

test('physical capital assessment: back-squat WL Analysis CSV import fills trial rows', async ({ page }) => {
  const athlete = await provisionAthlete();
  const date = await seedRecoverySnapshot(athlete);

  await signInThroughUi(page, athlete);
  await completeCheckin(page, athlete, date);

  const nav = page.locator('.navbar-desktop-menu');
  await nav.getByRole('button', { name: /More/ }).click();
  await page.locator('#desktop-more-panel').getByRole('button', { name: /Testing/ }).click();
  await expect(page).toHaveURL(/\?screen=testing$/);
  await page.getByRole('tab', { name: 'Protocols' }).click();

  await page.getByRole('button', { name: 'Back squat 1RM · rev 2' }).click();
  await expect(page.getByRole('heading', { name: 'Lock comparison context' })).toBeVisible();
  await page.getByLabel(/equipment_setup_id/).fill('rack-a · same shoes · same belt');
  await page.getByRole('button', { name: 'Confirm lock and start' }).click();

  await expect(page.getByText(/Locked assessment: Back squat 1RM/)).toBeVisible();
  await page.getByRole('button', { name: /Finish Session \(/ }).click();
  await expect(page.getByRole('dialog', { name: 'Complete Session' })).toBeVisible();
  await page.getByRole('button', { name: 'Finish & Save Session', exact: true }).click();

  // Capture screen offers the WL Analysis importer for this open squat attempt.
  await expect(page.getByRole('heading', { name: 'Record assessment trials' })).toBeVisible();
  await expect(page.getByText('Import WL Analysis CSV')).toBeVisible();

  await page.locator('.wl-file-input').setInputFiles([
    {
      name: 'squat-attempt-1.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(wlSingleRepCsv(100, 'back squat attempt 1', 0.6, 0.75)),
    },
    {
      name: 'squat-attempt-2.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(wlSingleRepCsv(120, 'back squat attempt 8', 0.55, 0.7)),
    },
  ]);

  // Preview before applying: ordinals from tags, confirmed loads, velocities, auto-detected success.
  const preview = page.locator('.wl-preview-list');
  await expect(preview).toContainText('Attempt 1');
  await expect(preview).toContainText('Attempt 8');
  await expect(preview).toContainText('0.615 m/s');
  await expect(preview).toContainText('0.565 m/s');
  await expect(preview).toContainText('auto-detected — confirm');
  await expect(preview).toContainText('does not match the session date');
  await expect(preview.locator('.wl-file-card input[type="number"]').nth(0)).toHaveValue('100');
  await expect(preview.locator('.wl-file-card input[type="number"]').nth(1)).toHaveValue('120');

  await page.getByRole('button', { name: 'Apply to draft rows (2)' }).click();

  // Sparse imported ordinals must not make a later manual row duplicate trial identity.
  await page.getByRole('button', { name: /\+ Add attempt/ }).click();
  await expect(page.locator('.trial-row-title', { hasText: 'Attempt 7' })).toHaveCount(1);
  await expect(page.locator('.trial-row-title', { hasText: 'Attempt 8' })).toHaveCount(1);

  // Drop the untouched planned/manual rows so only the two imported attempts save.
  for (let ordinal = 2; ordinal <= 7; ordinal += 1) {
    await page.getByRole('button', { name: `Remove Attempt ${ordinal}` }).click();
  }

  // Rows are filled; success is pre-selected from the completed ascents.
  const loadInputs = page.locator('input[placeholder="1–500"]');
  await expect(loadInputs.nth(0)).toHaveValue('100');
  await expect(loadInputs.nth(1)).toHaveValue('120');
  await expect(page.locator('select.trial-select').nth(0)).toHaveValue('true');
  await expect(page.locator('select.trial-select').nth(1)).toHaveValue('true');

  // Imported load unit, inferred success/miss and technical validity are suggestions only.
  // The normal save path must refuse to persist them until the athlete explicitly confirms.
  await page.getByRole('button', { name: 'Save assessment trials' }).click();
  await expect(page.locator('.testing-error')).toContainText('confirm imported load unit, success/miss, validity');

  for (const row of await page.locator('.trial-row-card').all()) {
    await row.getByRole('checkbox', { name: 'Load is kilograms' }).check();
    await row.getByRole('checkbox', { name: 'Success / miss matches the video' }).check();
    await row.getByRole('checkbox', { name: 'Technical validity is correct' }).check();
  }

  await page.getByRole('button', { name: 'Save assessment trials' }).click();

  // Canonical 1RM derives from the heaviest successful imported attempt.
  await expect(page.getByRole('heading', { name: 'Assessment recorded' })).toBeVisible();
  await expect(page.locator('.testing-observations')).toContainText('120 kg');
  await page.getByRole('button', { name: 'Done' }).click();

  // History detail retains the imported velocities on the trial rows.
  await nav.getByRole('button', { name: /More/ }).click();
  await page.locator('#desktop-more-panel').getByRole('button', { name: /Testing/ }).click();
  await page.getByRole('tab', { name: 'History' }).click();
  const squatCard = page.locator('.assessment-series-card', { hasText: 'Back squat 1RM' });
  await expect(squatCard.locator('.headline-stat', { hasText: 'Baseline' })).toContainText('120 kg');
  await squatCard.getByRole('button', { name: /View attempt .* details/ }).first().click();
  const detailModal = page.locator('[role="dialog"][aria-labelledby="attempt-detail-title"]');
  await expect(detailModal.locator('.attempt-trials-table')).toContainText('mean_concentric_velocity_mps: 0.615');
  await expect(detailModal.locator('.attempt-trials-table')).toContainText('peak_velocity_mps: 0.75');
  await detailModal.getByRole('button', { name: 'Close detail' }).click();
});

test('physical capital assessment: OpenBar JSON import validates, fills and saves raw evidence', async ({ page }) => {
  const athlete = await provisionAthlete();
  const date = await seedRecoverySnapshot(athlete);
  await signInThroughUi(page, athlete);
  await completeCheckin(page, athlete, date);
  const nav = page.locator('.navbar-desktop-menu');
  await nav.getByRole('button', { name: /More/ }).click();
  await page.locator('#desktop-more-panel').getByRole('button', { name: /Testing/ }).click();
  await page.getByRole('tab', { name: 'Protocols' }).click();
  await page.getByRole('button', { name: 'Back squat 1RM · rev 2' }).click();
  await page.getByLabel(/equipment_setup_id/).fill('rack-a · same shoes · same belt');
  await page.getByRole('button', { name: 'Confirm lock and start' }).click();
  await page.getByRole('button', { name: /Finish Session \(/ }).click();
  await page.getByRole('button', { name: 'Finish & Save Session', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Record assessment trials' })).toBeVisible();
  const input = page.getByLabel('Choose OpenBar analysis files');
  const wrong = buildOpenBarAnalysis();
  wrong.calibration.coordinate_convention = 'image_y_down';
  await input.setInputFiles({ name: 'wrong.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(wrong)) });
  await expect(page.locator('.openbar-preview-list')).toContainText('coordinate convention is not supported');
  await page.getByRole('button', { name: 'Clear OpenBar preview' }).click();

  const analysis = buildOpenBarAnalysis();
  await input.setInputFiles({ name: 'squat.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(analysis)) });
  const apply = page.getByRole('button', { name: 'Apply OpenBar to draft rows (1)' });
  await expect(apply).toBeDisabled();
  const load = page.getByLabel('Load in kilograms for squat.json');
  await load.fill('501');
  await expect(apply).toBeDisabled();
  await expect(page.locator('.openbar-preview-list')).toContainText('outside');
  await load.fill('100');
  await expect(apply).toBeEnabled();
  await apply.click();
  const importedRow = page.locator('.trial-row-card').first();
  await expect(importedRow.getByRole('checkbox', { name: 'Load is kilograms' })).toBeChecked();
  await importedRow.getByText('Trial device override (optional)', { exact: true }).click();
  await expect(importedRow.getByLabel('Provider', { exact: true })).toHaveValue('OpenBar');
  await expect(importedRow.locator('input[placeholder="1–500"]')).toHaveValue('100');

  // A different tracker analysis of this video must not become another trial in this attempt.
  analysis.provenance.tracker.implementation.implementation = 'sam2.1-bplus-circle';
  await input.setInputFiles({ name: 'squat-sam2.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(analysis)) });
  await expect(page.locator('.openbar-preview-list')).toContainText('already in the attempt');
  await page.getByRole('button', { name: 'Clear OpenBar preview' }).click();
  const removeButtons = page.getByRole('button', { name: /^Remove Attempt/ });
  while (await removeButtons.count() > 1) await removeButtons.last().click();
  // Leave the imported first row; remove the final untouched row when two rows remain.
  if (await page.locator('.trial-row-card').count() > 1) await removeButtons.last().click();
  await page.getByRole('button', { name: 'Save assessment trials' }).click();
  await expect(page.locator('.testing-error')).toContainText('success/miss, validity');
  await importedRow.getByRole('checkbox', { name: 'Success / miss matches the video' }).check();
  await importedRow.getByRole('checkbox', { name: 'Technical validity is correct' }).check();
  await page.getByRole('button', { name: 'Save assessment trials' }).click();
  await expect(page.getByRole('heading', { name: 'Assessment recorded' })).toBeVisible();
  await expect(page.locator('.testing-observations')).toContainText('100 kg');
});
