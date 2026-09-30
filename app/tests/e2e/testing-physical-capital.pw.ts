import { expect, test, type Page } from '@playwright/test';
import {
  dismissOnboardingIfVisible,
  hasPersistedCheckin,
  provisionAthlete,
  seedRecoverySnapshot,
  signInThroughUi,
  type E2EAthlete,
} from './support/athlete';

async function completeCheckin(page: Page, athlete: E2EAthlete, date: string): Promise<void> {
  await page.getByRole('button', { name: /Feeling normal today\? Use typical values/ }).click();
  await page.getByRole('button', { name: "Save & see today's plan", exact: true }).click();
  await expect.poll(() => hasPersistedCheckin(athlete, date)).toBe(true);
  await dismissOnboardingIfVisible(page);
  await expect(page.getByLabel("Today's Morning Training Decision")).toBeVisible();
}

test('physical capital assessment: standing broad jump trial capture, checkpoint attempt, and diagnostic JSON export', async ({ page }) => {
  const athlete = await provisionAthlete();
  const date = await seedRecoverySnapshot(athlete);

  await signInThroughUi(page, athlete);
  await completeCheckin(page, athlete, date);

  // Navigate to Testing via desktop More menu
  const nav = page.locator('.navbar-desktop-menu');
  await nav.getByRole('button', { name: /More/ }).click();
  await page.locator('#desktop-more-panel').getByRole('button', { name: /Testing/ }).click();
  await expect(page).toHaveURL(/\?screen=testing$/);

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

  // Now start a second attempt (checkpoint attempt) via More menu
  await nav.getByRole('button', { name: /More/ }).click();
  await page.locator('#desktop-more-panel').getByRole('button', { name: /Testing/ }).click();
  await expect(page).toHaveURL(/\?screen=testing$/);
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

  // Export diagnostic JSON and assert contents
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export assessment evidence (JSON)' }).click();
  const download = await downloadPromise;

  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  const fileContent = Buffer.concat(chunks).toString('utf-8');
  const parsed = JSON.parse(fileContent);

  expect(parsed.schemaVersion).toBe('assessment_diagnostic_export_v1');
  expect(parsed.protocols.some((p: { id: string; revision: number }) => p.id === 'field-standing-broad-jump' && p.revision === 2)).toBe(true);
  expect(parsed.attempts.length).toBeGreaterThanOrEqual(2);
  expect(parsed.trials.length).toBeGreaterThanOrEqual(7);
  expect(parsed.canonicalObservations.length).toBeGreaterThanOrEqual(2);
  // Verify Firebase UID is omitted
  expect(JSON.stringify(parsed)).not.toContain(athlete.userId);
});
