import { appendFileSync, mkdirSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { VISUAL_SCENARIOS, type VisualScenario } from '../../src/visual/fixtures';

const artifactDir = resolve('artifacts/visual-review/latest');
const entriesPath = resolve(artifactDir, 'entries.ndjson');

async function visitScenario(page: Page, scenario: VisualScenario): Promise<void> {
  await page.goto(`/visual.html?scenario=${scenario.id}`);
  await expect(page.locator(`[data-visual-scenario="${scenario.id}"]`)).toBeVisible();
  // The scenario container mounts before the dashboard has resolved its decision. A fixed
  // wait was enough while every screen took the same path; the externally-planned screen
  // resolves the plan, adjudicates and critiques the week, and photographed as a "Loading
  // dashboard..." placeholder. Wait for the placeholder to actually go.
  await expect(page.locator('.loading-state')).toHaveCount(0, { timeout: 15_000 });
  if (scenario.id.startsWith('data-activities-')) {
    await expect(page.getByText('Loading recent activities…')).toHaveCount(0, { timeout: 15_000 });
  }
  await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}' });
  await page.waitForTimeout(300);
}

async function capture(page: Page, scenario: VisualScenario, suffix = '', expectedFocus = scenario.expectedFocus): Promise<void> {
  const viewport = test.info().project.name === 'visual-mobile' ? 'mobile' : 'desktop';
  const id = `${scenario.id}${suffix ? `-${suffix}` : ''}`;
  const directory = resolve(artifactDir, viewport);
  const path = resolve(directory, `${id}.png`);
  mkdirSync(directory, { recursive: true });
  await page.screenshot({ path, fullPage: true });
  appendFileSync(entriesPath, `${JSON.stringify({
    id: `${viewport}-${id}`,
    scenario: scenario.id,
    scenarioTitle: scenario.title,
    viewport,
    path: relative(artifactDir, path).replaceAll('\\', '/'),
    expectedFocus,
  })}\n`);
}

test.describe.configure({ mode: 'serial' });

for (const scenario of VISUAL_SCENARIOS) {
  test(`captures ${scenario.id}`, async ({ page }) => {
    await visitScenario(page, scenario);
    await capture(page, scenario);

    if (scenario.id.startsWith('home-') && scenario.id !== 'home-missing-data') {
      // Home can also contain imported-plan session buttons with the same label. This
      // interaction captures the recommendation card's own disclosure specifically.
      const viewWorkout = page.locator('.view-workout-btn');
      if (await viewWorkout.count()) {
        await expect(viewWorkout.first()).toHaveAccessibleName('View workout');
        await viewWorkout.first().click();
        await expect(viewWorkout.first()).toHaveAttribute('aria-expanded', 'true');
        await expect(viewWorkout.first()).toHaveAccessibleName('Hide workout');
        await expect(page.getByLabel(/Workout details for /)).toBeVisible();
        await capture(page, scenario, 'workout-expanded', ['Workout steps are available on demand without overwhelming the recommendation.']);
      }
    }
  });
}

test('captures navigation interaction states', async ({ page }) => {
  const scenario = VISUAL_SCENARIOS[0];
  await visitScenario(page, scenario);

  if (test.info().project.name === 'visual-mobile') {
    await page.getByRole('button', { name: 'More' }).click();
    await expect(page.getByRole('dialog', { name: 'Navigation & Settings' })).toBeVisible();
    await capture(page, scenario, 'more-drawer-open', ['The mobile drawer is distinct from the page beneath it and presents secondary destinations clearly.']);
  } else {
    await page.getByRole('button', { name: 'Settings' }).click();
    await expect(page.getByRole('menu', { name: 'Settings' })).toBeVisible();
    await capture(page, scenario, 'settings-menu-open', ['Desktop Settings opens an anchored menu without activating the mobile drawer.']);
  }
});

test('captures goal modal state', async ({ page }) => {
  const scenario = VISUAL_SCENARIOS.find(s => s.id === 'goals-event') ?? VISUAL_SCENARIOS[0];
  await visitScenario(page, scenario);

  await page.getByRole('button', { name: '+ Add Goal' }).click();
  await expect(page.getByRole('dialog', { name: 'Add New Goal' })).toBeVisible();
  await capture(page, scenario, 'add-modal-open', ['Goal creation form inputs are spaced clearly without visual overlap.']);
});
