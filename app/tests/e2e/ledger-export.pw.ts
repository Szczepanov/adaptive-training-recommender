import { readFile } from 'node:fs/promises';
import { expect, test } from './support/test';
import { provisionAthlete, seedRecoverySnapshot, signInThroughUi } from './support/athlete';
import { planningBrief } from './support/roundTrip';
import type { LedgerExport } from '../../src/ledger/export/schema';

for (const width of [1440, 390]) {
  test(`structured ledger download preserves source states and legacy brief at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const athlete = await provisionAthlete();
    const date = await seedRecoverySnapshot(athlete);
    await signInThroughUi(page, athlete);
    await page.getByRole('button', { name: 'Skip to Dashboard', exact: true }).click();
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
    expect(ledger.flags.every(flag => flag.state === 'not_yet_supported')).toBe(true);
    expect(JSON.stringify(ledger)).not.toContain(athlete.userId);
    expect(await page.locator('textarea.brief-text').inputValue()).toBe(originalBrief);
    await expect(page.getByRole('button', { name: 'Download Markdown', exact: true })).toBeVisible();
  });
}
