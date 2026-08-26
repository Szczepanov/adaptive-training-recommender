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
  const projectName = test.info().project.name;
  const viewport = projectName === 'visual-mobile-narrow'
    ? 'mobile-narrow'
    : projectName === 'visual-mobile-wide'
    ? 'mobile-wide'
    : projectName === 'visual-mobile'
    ? 'mobile'
    : 'desktop';
  const id = `${scenario.id}${suffix ? `-${suffix}` : ''}`;
  const directory = resolve(artifactDir, viewport);
  const path = resolve(directory, `${id}.png`);
  const viewportPath = resolve(directory, `${id}-viewport.png`);
  mkdirSync(directory, { recursive: true });

  // Universal assertion: no unintended horizontal scroll overflow
  expect(await page.locator('body').evaluate(body => body.scrollWidth <= window.innerWidth)).toBe(true);

  // Capture full page
  await page.screenshot({ path, fullPage: true });

  // Also capture above-the-fold first-viewport snapshot
  await page.screenshot({ path: viewportPath, fullPage: false });

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

    if (scenario.id === 'plan-import-expanded') {
      const toggleBtn = page.getByRole('button', { name: /Import Plan|Revise Plan|Close Import/i });
      if (await toggleBtn.count()) {
        await toggleBtn.first().click();
        await expect(page.locator('.plan-import-section')).toBeVisible();
      }
    }

    await capture(page, scenario);

    if (scenario.id === 'home-normal-load') {
      const confidenceButton = page.getByRole('button', { name: /Data confidence: / });
      await confidenceButton.click();
      await expect(confidenceButton).toHaveAttribute('aria-expanded', 'true');
      const confidencePanel = page.getByRole('region', { name: 'Data confidence diagnostic breakdown' });
      await expect(confidencePanel).toBeVisible();
      const panelBounds = await confidencePanel.boundingBox();
      const viewport = page.viewportSize();
      expect(panelBounds).not.toBeNull();
      expect(viewport).not.toBeNull();
      expect(panelBounds!.x).toBeGreaterThanOrEqual(0);
      expect(panelBounds!.x + panelBounds!.width).toBeLessThanOrEqual(viewport!.width);
      expect(panelBounds!.y).toBeGreaterThanOrEqual(0);
      expect(panelBounds!.y + panelBounds!.height).toBeLessThanOrEqual(viewport!.height);
      await capture(page, scenario, 'confidence-expanded', [
        'The data-confidence badge exposes signal freshness, maturity, plausibility, and cautions without competing with today’s training decision.',
      ]);
      await page.getByRole('button', { name: 'Close data confidence details' }).click();
      await expect(confidenceButton).toHaveAttribute('aria-expanded', 'false');
    }

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

  if (test.info().project.name.includes('mobile')) {
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

test('captures grouped session runner rotation without horizontal overflow', async ({ page }) => {
  const scenario = VISUAL_SCENARIOS.find(candidate => candidate.id === 'session-runner-in-progress');
  if (!scenario) throw new Error('Missing session runner visual scenario');
  await visitScenario(page, scenario);

  await expect(page.locator('.session-runner-container')).toBeVisible();
  expect(await page.locator('body').evaluate(body => body.scrollWidth <= window.innerWidth)).toBe(true);

  const groupedFixture = page.locator('.fixture-card').filter({ hasText: 'Upper-Body Absorption & Field-Readiness Support' });
  await groupedFixture.getByRole('button', { name: 'Start Session →' }).click();
  await expect(page.locator('.group-progress')).toContainText('Circuit');

  await page.getByRole('button', { name: 'Log Set ⏎' }).click();
  await expect(page.getByRole('heading', { name: 'scapular_push_up' })).toBeVisible();

  await page.getByRole('button', { name: 'bench_press' }).click();
  await expect(page.getByRole('heading', { name: 'bench_press' })).toBeVisible();
  await page.getByRole('button', { name: 'Log Set ⏎' }).click();
  await expect(page.getByRole('heading', { name: 'chest_supported_dumbbell_row' })).toBeVisible();

  const nextBtn = page.locator('.group-next-button');
  if (await nextBtn.count()) {
    await nextBtn.first().click();
    await expect(page.getByRole('heading', { name: /bench_press|scapular_push_up|chest_supported_dumbbell_row/ })).toBeVisible();
  }

  await capture(page, scenario, 'grouped-runner-active', [
    'The grouped runner presents clear superset/circuit context and large hit targets for mobile use.',
  ]);
});

test('captures plan view mode switching without horizontal overflow', async ({ page }) => {
  const scenario = VISUAL_SCENARIOS.find(s => s.id === 'plan-imported-active');
  if (!scenario) throw new Error('Missing plan-imported-active visual scenario');
  await visitScenario(page, scenario);

  await expect(page.locator('.plan-view-container')).toBeVisible();
  expect(await page.locator('body').evaluate(body => body.scrollWidth <= window.innerWidth)).toBe(true);

  const aiTab = page.getByRole('tab', { name: /AI Adaptive Forecast/ });
  if (await aiTab.count()) {
    await aiTab.click();
    await expect(page.locator('.week-ahead-card')).toBeVisible();
    expect(await page.locator('body').evaluate(body => body.scrollWidth <= window.innerWidth)).toBe(true);
    await capture(page, scenario, 'ai-forecast-tab-active', [
      'The plan view seamlessly presents the AI-generated rolling 7-day forecast alongside the coach plan.',
    ]);
  }
});
