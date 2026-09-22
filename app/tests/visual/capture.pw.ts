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

    if (scenario.id === 'checkin-new' || scenario.id === 'checkin-complete') {
      for (const selector of [
        '.red-flag-disclosure',
        '.tissue-response-disclosure',
        '.health-context',
        '.physical-work-card',
        '.hunger-section',
        '.nutrition-adherence-section',
        '.availability-disclosure',
      ]) {
        await expect(page.locator(`${selector}[open]`)).toHaveCount(0);
      }
      await expect(page.getByText('No warning selected', { exact: true })).toBeVisible();
      await expect(page.getByText('I feel unwell', { exact: true })).toBeVisible();
      await expect(page.getByText(/Yesterday's extra physical load/)).toBeVisible();
    }

    if (scenario.id === 'checkin-pain-expanded') {
      await expect(page.locator('.tissue-response-disclosure[open]')).toHaveCount(1);
    }

    if (scenario.id === 'checkin-red-flag-expanded') {
      await expect(page.locator('.red-flag-disclosure[open]')).toHaveCount(1);
      await expect(page.getByText('1 reported', { exact: true })).toBeVisible();
      await expect(page.getByText('Systemic / cardiopulmonary warning')).toBeVisible();
      await expect(page.locator('.hunger-section[open]')).toHaveCount(0);
      await expect(page.locator('.nutrition-adherence-section[open]')).toHaveCount(0);
    }

    if (scenario.id === 'checkin-red-flag-uncategorized') {
      await expect(page.locator('.red-flag-disclosure[open]')).toHaveCount(1);
      await expect(page.getByText('Reported', { exact: true })).toBeVisible();
      await expect(page.getByText(/Neurologic, major-trauma, systemic\/cardiopulmonary/)).toBeVisible();
      await expect(page.getByText('No warning selected', { exact: true })).toHaveCount(0);
    }

    if (scenario.id === 'checkin-optional-context-saved') {
      await expect(page.locator('.hunger-section[open]')).toHaveCount(1);
      await expect(page.locator('.nutrition-adherence-section[open]')).toHaveCount(1);
      await expect(page.locator('.red-flag-disclosure[open]')).toHaveCount(0);
      await expect(page.locator('.tissue-response-disclosure[open]')).toHaveCount(0);
      await expect(page.locator('.availability-disclosure[open]')).toHaveCount(0);
      await expect(page.locator('.hunger-section > summary .checkin-disclosure-status')).toHaveText('7/10');
      await expect(page.locator('.nutrition-adherence-section > summary .checkin-disclosure-status')).toHaveText('Mostly Tracked');
      await expect(page.locator('.availability-disclosure > summary .checkin-disclosure-status')).toHaveText('60 min · No preference');
      await expect(page.getByRole('button', { name: 'Clear hunger score' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Clear calorie tracking score' })).toBeVisible();
    }

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
    const moreButton = page.getByRole('button', { name: 'More' });
    await moreButton.click();
    await expect(moreButton).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#desktop-more-panel')).toBeVisible();
    await capture(page, scenario, 'more-panel-open', ['Desktop More opens an anchored disclosure without activating the mobile drawer.']);
  }
});

test('check-in optional disclosures are keyboard-operable', async ({ page }) => {
  const scenario = VISUAL_SCENARIOS.find(candidate => candidate.id === 'checkin-new');
  if (!scenario) throw new Error('Missing checkin-new visual scenario');
  await visitScenario(page, scenario);

  const disclosures = [
    '.red-flag-disclosure',
    '.tissue-response-disclosure',
    '.health-context',
    '.physical-work-card',
    '.hunger-section',
    '.nutrition-adherence-section',
    '.availability-disclosure',
  ];

  for (const selector of disclosures) {
    const details = page.locator(selector);
    const summary = details.locator('> summary');
    await expect(details).not.toHaveAttribute('open', '');
    await summary.focus();
    await summary.press('Enter');
    await expect(details).toHaveAttribute('open', '');
    await summary.press('Space');
    await expect(details).not.toHaveAttribute('open', '');
  }
});

test('check-in safety topics can coexist and disclose independently', async ({ page }) => {
  const scenario = VISUAL_SCENARIOS.find(candidate => candidate.id === 'checkin-new');
  if (!scenario) throw new Error('Missing checkin-new visual scenario');
  await visitScenario(page, scenario);

  await page.locator('label').filter({ hasText: 'Pain, injury, or movement change' }).click();
  await expect(page.locator('.tissue-response-disclosure[open]')).toHaveCount(1);

  await page.locator('label.health-context__topic').click();
  await expect(page.locator('.health-context[open]')).toHaveCount(1);
  await expect(page.locator('[aria-label="Illness symptom details"]')).toBeVisible();

  await page.locator('.red-flag-disclosure > summary').press('Enter');
  await page.getByRole('checkbox', { name: /Systemic \/ cardiopulmonary warning/ }).check();
  await expect(page.locator('.red-flag-disclosure[open]')).toHaveCount(1);
  await expect(page.locator('.tissue-response-disclosure[open]')).toHaveCount(1);
  await expect(page.locator('.health-context[open]')).toHaveCount(1);
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

  const newSessionBtn = page.getByRole('button', { name: '＋ New session' });
  if (await newSessionBtn.count()) {
    await newSessionBtn.click();
    await page.getByRole('button', { name: 'From fixture' }).click();
  }

  const groupedFixture = page.locator('.fixture-card').filter({ hasText: 'Upper-Body Absorption & Field-Readiness Support' });
  await groupedFixture.getByRole('button', { name: 'Start Session →' }).click();
  await expect(page.locator('.group-progress')).toContainText('Circuit');

  await page.getByRole('button', { name: 'Log Set ⏎' }).click();
  await expect(page.getByRole('heading', { name: /scapular.push.up/i })).toBeVisible();

  await page.getByRole('button', { name: /bench.press/i }).click();
  await expect(page.getByRole('heading', { name: /bench.press/i })).toBeVisible();
  await page.getByRole('button', { name: 'Log Set ⏎' }).click();
  await expect(page.getByRole('heading', { name: /chest.supported.dumbbell.row/i })).toBeVisible();

  const nextBtn = page.locator('.group-next-button');
  if (await nextBtn.count()) {
    await nextBtn.first().click();
    await expect(page.getByRole('heading', { name: /bench.press|scapular.push.up|chest.supported.dumbbell.row/i })).toBeVisible();
  }

  await capture(page, scenario, 'grouped-runner-active', [
    'The grouped runner presents clear superset/circuit context and large hit targets for mobile use.',
  ]);
});

test('captures the primary catalog strength warm-up journey', async ({ page }) => {
  const scenario = VISUAL_SCENARIOS.find(candidate => candidate.id === 'session-runner-primary-strength-warmup');
  if (!scenario) throw new Error('Missing primary strength warm-up visual scenario');
  await visitScenario(page, scenario);

  await expect(page.locator('.session-title-text')).toHaveText('Primary Full-body Strength Maintenance');
  await expect(page.locator('.block-role-label').first()).toHaveText('Warm-up and clean rehearsal');
  await expect(page.getByRole('heading', { name: 'Bodyweight hip hinge' })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Warm-up' })).toBeChecked();
  await expect(page.getByText('Load: Empty bar, then light rehearsal load')).toHaveCount(0);
  await capture(page, scenario, 'warmup-start', [
    'The primary catalog strength session opens on its structured warm-up.',
    'Warm-up repetition logging is enabled by default.',
  ]);

  await page.getByRole('button', { name: /Log Set/ }).click();
  await page.getByRole('button', { name: 'Dead bug', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Dead Bug/i })).toBeVisible();
  await page.getByRole('button', { name: /Log Set/ }).click();
  await page.getByRole('button', { name: 'Hang power clean rehearsal', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Hang Power Clean Rehearsal/i })).toBeVisible();
  await expect(page.getByText('Load: Empty bar, then light rehearsal load')).toBeVisible();
  await capture(page, scenario, 'warmup-ramp', [
    'The structured ramp-load copy is visible before the activation block.',
  ]);

  await page.getByRole('button', { name: 'Hang power clean', exact: true }).click();
  await expect(page.locator('.block-role-label').filter({ hasText: 'Power activation' })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Hang Power Clean/i, exact: true })).toBeVisible();
  await capture(page, scenario, 'activation-transition', [
    'Activation remains a distinct block after warm-up work.',
  ]);

  await page.getByRole('button', { name: /Finish Session/ }).click();
  await expect(page.getByRole('dialog', { name: 'Complete Session' })).toBeVisible();
  await expect(page.getByText('Total Sets')).toBeVisible();
  await expect(page.getByText('Exercises')).toBeVisible();
  await capture(page, scenario, 'completion-summary', [
    'The completion summary remains available after partial warm-up execution.',
  ]);
});

test('captures saved custom-template preview and archived-library states', async ({ page }) => {
  const scenario = VISUAL_SCENARIOS.find(candidate => candidate.id === 'session-runner-custom-template-library');
  if (!scenario) throw new Error('Missing saved custom-template library visual scenario');
  await visitScenario(page, scenario);

  const newSessionBtn = page.getByRole('button', { name: '＋ New session' });
  if (await newSessionBtn.count()) {
    await newSessionBtn.click();
    await page.getByRole('button', { name: 'From template' }).click();
  }

  await expect(page.getByRole('heading', { name: 'Your custom templates' })).toBeVisible();
  const customTemplate = page.locator('.fixture-card').filter({ hasText: 'Upper-Body Strength Maintenance' });
  await customTemplate.getByRole('button', { name: 'Preview' }).click();
  await expect(page.getByRole('heading', { name: 'Upper-Body Strength Maintenance' })).toBeVisible();
  expect(await page.locator('body').evaluate(body => body.scrollWidth <= window.innerWidth)).toBe(true);
  await capture(page, scenario, 'preview-open', [
    'A saved custom template opens in the same structured preview used by catalog sessions.',
  ]);

  await page.getByRole('button', { name: /All Sessions/i }).click();
  await page.getByRole('button', { name: /Show archived templates \(1\)/ }).click();
  await expect(page.getByText('Shoulder Care Circuit')).toBeVisible();
  expect(await page.locator('body').evaluate(body => body.scrollWidth <= window.innerWidth)).toBe(true);
  await capture(page, scenario, 'archived-open', [
    'Archived custom templates are separate from active templates and can be restored deliberately.',
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
