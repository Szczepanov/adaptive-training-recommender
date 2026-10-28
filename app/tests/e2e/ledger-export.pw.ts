import { readFile } from 'node:fs/promises';
import { collection, doc, getDoc, getDocs, setDoc } from 'firebase/firestore';
import { expect, test } from './support/test';
import { completeTypicalCheckin, provisionAthlete, seedRecoverySnapshot, signInThroughUi } from './support/athlete';
import { inspectAthlete, seedWithRulesDisabled } from './support/emulator';
import { addDaysToLocalDateString } from '../../src/utils/localDate';
import { planningBrief } from './support/roundTrip';
import type { LedgerExport } from '../../src/ledger/export/schema';

for (const width of [1440, 390]) {
  test(`structured ledger download preserves source states and legacy brief at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const athlete = await provisionAthlete();
    const date = await seedRecoverySnapshot(athlete);
    await signInThroughUi(page, athlete);
    await completeTypicalCheckin(page, athlete, date);
    const recordedCheckin = await inspectAthlete(athlete, async db =>
      (await getDoc(doc(db, 'users', athlete.userId, 'daily_subjective_checkins', date))).data()!);
    await seedWithRulesDisabled(async db => {
      await Promise.all(Array.from({ length: 14 }, async (_, index) => {
        const prior = addDaysToLocalDateString(date, -index - 1);
        await setDoc(doc(db, 'users', athlete.userId, 'daily_subjective_checkins', prior), { ...recordedCheckin, date: prior });
      }));
    });
    // Inspect as the owner through rules: the app, rather than a test seed, must write flags.
    await expect.poll(() => inspectAthlete(athlete, async db => {
      const rows = await getDocs(collection(db, 'users', athlete.userId, 'flag_evaluations'));
      return rows.docs.some(row => row.data().observedOn === date && row.data().id === 'illness_risk_symptom'
        && row.data().state === 'measured');
    }), { timeout: 20_000 }).toBe(true);
    const originalBrief = await planningBrief(page);
    const button = page.getByRole('button', { name: 'Export ledger (JSON)', exact: true });
    await expect(button).toBeVisible();
    const bounds = await button.boundingBox();
    expect(bounds?.height).toBeGreaterThanOrEqual(44);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    await page.screenshot({ path: testInfo.outputPath(`ledger-actions-${width}.png`), fullPage: true });
    const downloading = page.waitForEvent('download');
    await button.click();
    const download = await downloading;
    expect(download.suggestedFilename()).toMatch(/^ledger_planning_.*\.json$/);
    const path = await download.path();
    const ledger: LedgerExport = JSON.parse(await readFile(path!, 'utf8'));
    expect(ledger.schemaVersion).toBe('ledger-export-v1');
    expect(ledger.asOfDate).toBe(date);
    expect(ledger.window.days).toBe(14);
    expect(ledger.legacyEngine).toBeNull();
    expect(ledger.facts.recovery.items.some(row => row.observedOn === date)).toBe(true);
    expect(ledger.sources.filter(source => source.state === 'unavailable' || source.state === 'invalid')).toEqual([]);
    expect(ledger.userContext.trainingDislikes.state).toBe('not_yet_supported');
    expect(ledger.flags.some(flag => flag.observedOn === date && flag.id === 'illness_risk_symptom'
      && flag.active === false && flag.evaluatedAt !== null)).toBe(true);
    expect(ledger.flags.some(flag => flag.observedOn === date && flag.id === 'injury_constraint_touches_session'
      && flag.state === 'not_applicable' && flag.reasonCode === 'no_planned_session')).toBe(true);
    expect(ledger.flags.some(flag => flag.observedOn !== date && flag.state === 'not_recorded')).toBe(true);
    expect(ledger.flags.filter(flag => flag.observedOn === date && flag.id === 'illness_anomaly')
      .every(flag => flag.active === null && flag.state === 'not_yet_supported')).toBe(true);
    expect(ledger.derived.find(metric => metric.id === 'biometric_baselines')?.metrics?.sleepScore7dAvg)
      .toMatchObject({ value: 80, state: 'measured' });
    expect(ledger.derived.find(metric => metric.id === 'subjective_baselines')?.metrics?.longRecordedDays)
      .toMatchObject({ value: 14, state: 'measured' });
    expect(ledger.facts.checkins.items.every(row => row.observedOn! >= ledger.window.startDate)).toBe(true);
    expect(JSON.stringify(ledger)).not.toContain(athlete.userId);
    expect(await page.locator('textarea.brief-text').inputValue()).toBe(originalBrief);
    await expect(page.getByRole('button', { name: 'Download Markdown', exact: true })).toBeVisible();
  });
}
