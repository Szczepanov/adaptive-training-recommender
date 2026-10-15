import { appendFileSync, mkdirSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { VISUAL_SCENARIOS, type VisualScenario } from '../../src/visual/fixtures';
import { buildOpenBarAnalysis, openBarSingleRepProfile } from '../../src/observations/fixtures/openBarAnalysisFixtures';

const artifactDir = resolve('artifacts/visual-review/latest');
const entriesPath = resolve(artifactDir, 'entries.ndjson');

async function visitScenario(page: Page, scenario: VisualScenario): Promise<void> {
  if (scenario.id === 'plan-recovery-authority-exit') {
    await page.clock.setFixedTime('2026-09-12T08:00:00+02:00');
  }
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
    if (scenario.id === 'session-runner-degraded-resume') {
      await expect(page.getByRole('heading', { name: 'Session recovery needs attention' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Retry recovery' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Start Session →', exact: true })).toHaveCount(0);
    }
    if (scenario.id.startsWith('assessment-openbar-')) {
      const state = scenario.id.slice('assessment-openbar-'.length);
      if (state !== 'empty') {
        const profile = state === 'gap' ? [...openBarSingleRepProfile(), ...openBarSingleRepProfile()] : openBarSingleRepProfile();
        const analysis = buildOpenBarAnalysis(profile, state === 'gap' ? { dropSamples: [32, 33] } : {});
        if (state === 'rejected') analysis.calibration.coordinate_convention = 'image_y_down';
        await page.getByLabel('Choose OpenBar analysis files').setInputFiles({
          name: 'synthetic-back-squat-analysis.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(analysis)),
        });
        if (state === 'rejected') await expect(page.locator('.openbar-preview-list')).toContainText('Not imported:');
        else {
          await page.getByLabel('Load in kilograms for synthetic-back-squat-analysis.json').fill('100');
          if (state === 'gap') await expect(page.locator('.openbar-preview-list')).toContainText('tracking gap');
          if (state === 'applied') await page.getByRole('button', { name: 'Apply OpenBar to draft rows (1)' }).click();
        }
      }
      if (test.info().project.name.includes('mobile')) {
        for (const control of await page.locator('.openbar-import-panel :is(button, input):visible').all()) {
          const box = await control.boundingBox();
          expect(box?.height).toBeGreaterThanOrEqual(44);
          expect(box?.width).toBeGreaterThanOrEqual(44);
        }
      }
    }
    if (scenario.id === 'assessment-fixed-load-velocity') {
      await expect(page.getByLabel(/test_load_kg/)).toHaveValue('60');
      await expect(page.getByLabel(/measurement_method_id/)).toHaveValue('manual');
      const rows = page.locator('.trial-row-card');
      for (let index = 0; index < 2; index += 1) {
        await rows.nth(index).getByLabel(/^Load/).fill('60');
        await rows.nth(index).getByLabel(/Lift successful/).selectOption('true');
        await rows.nth(index).getByLabel(/Mean concentric velocity/).fill(index === 0 ? '0.7' : '0.8');
      }
      await rows.nth(2).getByRole('radio', { name: 'practice', exact: true }).check();
      await expect(page.locator('.canonical-preview-container')).toContainText('0.8 m/s');
      if (test.info().project.name.includes('mobile')) {
        for (const control of await page.locator('.trial-capture-section :is(button, input[type="number"], select):visible').all()) {
          const box = await control.boundingBox();
          expect(box?.height).toBeGreaterThanOrEqual(44);
        }
      }
    }
    if (scenario.id === 'plan-recovery-authority-exit') {
      await expect(page.getByRole('region', { name: 'Roles planned beyond this forecast' })).toBeVisible();
    }

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

    if (scenario.id === 'manual-builder-validation') {
      await page.getByRole('button', { name: 'Review session' }).click();
      await expect(page.getByRole('alert')).toContainText(/intent/i);
    }

    if (scenario.id.startsWith('manual-builder-') && test.info().project.name.includes('mobile')) {
      const controls = page.locator('.manual-session-builder :is(button, input:not([type="checkbox"]), select, textarea, summary):visible');
      for (const control of await controls.all()) {
        const box = await control.boundingBox();
        const description = await control.evaluate((element) => `${element.outerHTML}`);
        expect(box?.height, `${description} rendered height`).toBeGreaterThanOrEqual(44);
        expect(box?.width, `${description} rendered width`).toBeGreaterThanOrEqual(44);
      }
    }

    if (scenario.id === 'morning-card-authored-adjustment-withheld') {
      const note = page.getByRole('note', { name: 'Start is unavailable while this adjustment is applied' });
      await expect(note).toBeVisible();
      await expect(page.getByRole('button', { name: 'Start My Tempo Run' })).toHaveCount(0);
      const reset = page.getByRole('button', { name: 'Reset to Original Session' });
      await expect(reset).toBeVisible();
      if (test.info().project.name.includes('mobile')) {
        const box = await reset.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.height).toBeGreaterThanOrEqual(44);
        expect(box!.width).toBeGreaterThanOrEqual(44);
      }
    }

    await capture(page, scenario);

    if (scenario.id === 'morning-card-authored-adjustment-withheld') {
      const reset = page.getByRole('button', { name: 'Reset to Original Session' });
      await reset.focus();
      await expect(reset).toBeFocused();
      await reset.click();
      const start = page.getByRole('button', { name: 'Start My Tempo Run' });
      await expect(start).toBeVisible();
      await expect(start).toBeFocused();
      await expect(page.getByRole('note', { name: 'Start is unavailable while this adjustment is applied' })).toHaveCount(0);
      await capture(page, scenario, 'reset', [
        'Reset restores the executable original session and keyboard focus lands on Start.',
      ]);
    }

    if (scenario.id === 'manual-builder-empty') {
      await page.getByRole('button', { name: 'Add movement' }).click();
      await page.getByRole('textbox', { name: 'Movement 2 name' }).fill('Dumbbell row');
      await page.getByRole('button', { name: 'Move movement 2 up' }).click();
      await expect(page.locator('.builder-step-card').first().getByRole('textbox', { name: 'Movement 1 name' })).toHaveValue('Dumbbell row');
      await capture(page, scenario, 'multi-step', ['Movement cards can be added, named, and reordered on a narrow screen.']);

      await page.locator('.builder-step-card').first().locator('.builder-advanced-fields > summary').click();
      await capture(page, scenario, 'advanced-expanded', ['Advanced prescription fields expand into a single readable column.']);
      await page.locator('.builder-step-card').first().getByRole('button', { name: 'Add alternative' }).click();
      await page.locator('.builder-choices > summary').click();
      await page.getByRole('button', { name: 'Add choice' }).click();
      await capture(page, scenario, 'alternatives-options', ['Alternatives and authored options are editable with touch sized controls.']);
      if (test.info().project.name.includes('mobile')) {
        const width = page.viewportSize()?.width ?? 390;
        await page.setViewportSize({ width, height: 460 });
        const trigger = page.getByRole('textbox', { name: 'Trigger — what the athlete observes' });
        await trigger.focus();
        await expect.poll(async () => trigger.evaluate(element => {
          const bottom = element.getBoundingClientRect().bottom;
          const viewport = window.visualViewport;
          return bottom <= (viewport?.offsetTop ?? 0) + (viewport?.height ?? window.innerHeight) - 16;
        })).toBe(true);
      }
      await page.getByRole('button', { name: 'Remove movement 1' }).click();
      await expect(page.locator('.builder-step-card')).toHaveCount(1);
    }

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

  const painFlag = page.getByRole('checkbox', { name: /Active pain or injury/ });
  await expect(painFlag).not.toBeChecked();

  // Graded local tissue context must remain independently reportable without promoting
  // the hard pain/injury gate.
  await page.locator('.tissue-response-disclosure > summary').press('Enter');
  await expect(page.locator('.tissue-response-disclosure[open]')).toHaveCount(1);
  await expect(painFlag).not.toBeChecked();

  await page.locator('label').filter({ hasText: 'Active pain or injury' }).click();
  await expect(painFlag).toBeChecked();

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
  await newSessionBtn.click();
  await page.getByRole('button', { name: 'From fixture' }).click();

  const groupedFixture = page.locator('.fixture-card').filter({ hasText: 'Upper-Body Absorption & Field-Readiness Support' });
  await groupedFixture.getByRole('button', { name: 'Start Session →' }).click();
  await expect(page.locator('.group-progress')).toContainText('Circuit');

  await page.getByRole('checkbox', { name: 'Warm-up', exact: true }).uncheck();
  await page.locator('.log-set-btn').click();
  await expect(page.getByRole('heading', { name: /scapular.push.up/i })).toBeVisible();

  await page.getByRole('button', { name: /bench.press/i }).click();
  await expect(page.getByRole('heading', { name: /bench.press/i })).toBeVisible();
  await page.locator('.log-set-btn').click();
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

test('captures per-side hold controls without horizontal overflow', async ({ page }) => {
  const scenario = VISUAL_SCENARIOS.find(candidate => candidate.id === 'session-runner-in-progress');
  if (!scenario) throw new Error('Missing session runner visual scenario');
  await visitScenario(page, scenario);

  const newSessionBtn = page.getByRole('button', { name: '＋ New session' });
  await newSessionBtn.click();
  await page.getByRole('button', { name: 'From fixture' }).click();

  const timedFixture = page.locator('.fixture-card').filter({ hasText: 'Timed Trunk & Tissue Preparation' });
  await timedFixture.getByRole('button', { name: 'Start Session →' }).click();
  await expect(page.getByRole('heading', { name: /soleus iso/i })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Log left hold' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Right side' })).toBeVisible();
  expect(await page.locator('body').evaluate(body => body.scrollWidth <= window.innerWidth)).toBe(true);
  await capture(page, scenario, 'per-side-hold-controls', [
    'Both side controls and the current hold action remain visible without horizontal page overflow.',
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

  await page.locator('.log-set-btn').click();
  await page.getByRole('button', { name: /^Dead bug \d+\/\d+ /i }).click();
  await expect(page.getByRole('heading', { name: /Dead Bug/i })).toBeVisible();
  await page.locator('.log-set-btn').click();
  await page.getByRole('button', { name: /^Hang power clean rehearsal \d+\/\d+ /i }).click();
  await expect(page.getByRole('heading', { name: /Hang Power Clean Rehearsal/i })).toBeVisible();
  await expect(page.getByText('Load: Empty bar, then light rehearsal load')).toBeVisible();
  await capture(page, scenario, 'warmup-ramp', [
    'The structured ramp-load copy is visible before the activation block.',
  ]);

  await page.getByRole('button', { name: /^Hang power clean \d+\/\d+ /i }).click();
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

  await page.getByRole('button', { name: 'Abandon Session...' }).click();
  await expect(page.getByRole('heading', { name: 'Abandon Session?' })).toBeVisible();
  await expect(page.getByText(/permanently retained in your history/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Yes, Abandon Session' })).toBeVisible();
  await capture(page, scenario, 'abandon-confirmation', [
    'Abandonment is a separate confirmation that states logged sets are retained, with a clear way back.',
  ]);
});

test('captures just-logged set undo and in-place set correction', async ({ page }) => {
  const scenario = VISUAL_SCENARIOS.find(candidate => candidate.id === 'session-runner-in-progress');
  if (!scenario) throw new Error('Missing session runner visual scenario');
  // The undo offer expires on a real timer; control the clock so capture timing cannot race it.
  await page.clock.install();
  await visitScenario(page, scenario);

  await page.getByRole('button', { name: '＋ New session' }).click();
  await page.getByRole('button', { name: 'From fixture' }).click();
  const fixture = page.locator('.fixture-card').filter({ hasText: 'Full-Body Strength/Power Maintenance' });
  await fixture.getByRole('button', { name: 'Start Session →' }).click();
  await expect(page.getByRole('button', { name: 'Log repetition set' })).toBeVisible();
  await page.clock.pauseAt(new Date(Date.now() + 1_000));

  await page.getByRole('button', { name: 'Log repetition set' }).click();
  await expect(page.getByText(/Set 1 logged/)).toBeVisible();
  const undoSet1 = page.getByRole('button', { name: 'Undo set 1' });
  await expect(undoSet1).toBeVisible();
  expect((await undoSet1.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  await capture(page, scenario, 'logged-set-undo', [
    'A short-lived Undo for the just-logged set is offered without blocking the next Log action.',
  ]);

  await page.getByRole('button', { name: 'Edit set 1' }).click();
  await page.getByRole('spinbutton', { name: 'Repetitions for set 1' }).fill('0');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'whole number of repetitions' })).toBeVisible();
  await capture(page, scenario, 'set-correction-invalid', [
    'An invalid correction stays open with an explanation and is never silently coerced.',
  ]);

  await page.getByRole('spinbutton', { name: 'Repetitions for set 1' }).fill('9');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText(/9 reps/)).toBeVisible();
  await page.getByRole('button', { name: 'Undo set 1' }).click();
  await expect(page.getByText('Set removed')).toBeVisible();
  await capture(page, scenario, 'logged-set-undone', [
    'Undoing the set removes that entry and offers a restore, without adding a compensating set.',
  ]);

  // log -> undo -> log: the new set must offer its own Undo, not the stale removed-set restore.
  await expect(page.getByRole('button', { name: 'Log repetition set' })).toBeFocused();
  await page.getByRole('button', { name: 'Log repetition set' }).click();
  await expect(page.getByRole('button', { name: 'Undo set 1' })).toBeVisible();
  await expect(page.getByText('Set removed')).toHaveCount(0);

  // Once the window passes, the offer disappears on its own.
  await page.clock.fastForward(11_000);
  await expect(page.getByRole('button', { name: 'Undo set 1' })).toHaveCount(0);
});

test('captures prescribed progress, optional status and free-text reachability in the runner navigator', async ({ page }) => {
  const scenario = VISUAL_SCENARIOS.find(candidate => candidate.id === 'session-runner-prescribed-navigator');
  if (!scenario) throw new Error('Missing prescribed navigator visual scenario');
  await visitScenario(page, scenario);

  const nav = page.getByRole('navigation', { name: 'Workout steps' });
  await expect(page.locator('.session-summary-text')).toContainText('Squat first');
  await expect(page.locator('.step-stop-conditions')).toContainText('Stop the set if depth or bar path degrades.');
  await expect(nav.getByRole('button', { name: /Back squat/ })).toContainText('0/3 sets · Required');
  await expect(nav.getByRole('button', { name: /Landmine anti-rotation press/ })).toContainText('0/2 sets · Required');
  await expect(nav.getByRole('button', { name: /Curl finisher/ })).toContainText('0/2 sets · Optional');
  await capture(page, scenario, 'prescribed-unstarted', [
    'Unstarted prescribed work shows 0/target and required/optional status.',
  ]);

  await page.getByRole('checkbox', { name: 'Warm-up', exact: true }).uncheck();
  await page.locator('.log-set-btn').click();
  await expect(nav.getByRole('button', { name: /Back squat/ })).toContainText('1/3 sets · Required');

  await nav.getByRole('button', { name: /Landmine anti-rotation press/ }).click();
  await expect(page.getByRole('heading', { name: 'Landmine anti-rotation press' })).toBeVisible();
  await nav.getByRole('button', { name: /Back squat/ }).click();
  await expect(page.getByRole('heading', { name: /Back squat/i })).toBeVisible();
  await nav.getByRole('button', { name: /Landmine anti-rotation press/ }).click();
  await expect(page.getByRole('heading', { name: 'Landmine anti-rotation press' })).toBeVisible();
  await capture(page, scenario, 'free-text-reachable', [
    'The free-text exercise reopens from the navigator without retyping it.',
  ]);

  if (test.info().project.name.includes('mobile')) {
    for (const pill of await nav.getByRole('button').all()) {
      const box = await pill.boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(44);
    }
  }
});

test('keeps the repetition logger keyboard-efficient and reachable after many logged sets (#725)', async ({ page }) => {
  const scenario = VISUAL_SCENARIOS.find(candidate => candidate.id === 'session-runner-logger-long-set-list');
  if (!scenario) throw new Error('Missing long set list visual scenario');
  await visitScenario(page, scenario);

  const weight = page.getByRole('spinbutton', { name: 'Weight in kilograms' });
  const logButton = page.getByRole('button', { name: 'Log repetition set' });
  const performed = page.locator('.entries-heading');
  const noBodyOverflow = () => page.locator('body').evaluate(body => body.scrollWidth <= window.innerWidth);

  await page.getByRole('checkbox', { name: 'Warm-up', exact: true }).uncheck();
  await expect(weight).toBeFocused();
  await expect(performed).toContainText('(0)');

  // The prescribed load seeds the weight field so there is a value to select.
  await expect(weight).toHaveValue('80');

  // Clicking Log moves focus to the button; the logger must then return focus to the weight
  // field with its content selected, so typing replaces the load instead of appending to it.
  await logButton.click();
  await expect(performed).toContainText('(1)');
  await expect(weight).toBeFocused();
  await page.keyboard.type('77');
  await expect(weight).toHaveValue('77');

  // A single Enter in the weight field logs exactly one more set, not zero or two.
  await weight.press('Enter');
  await expect(performed).toContainText('(2)');
  await expect(page.locator('.entries-list .entry-row')).toHaveCount(2);
  await page.waitForTimeout(300);
  await expect(page.locator('.entries-list .entry-row')).toHaveCount(2);

  // Log a long list of sets from the keyboard alone.
  for (let count = 3; count <= 15; count += 1) {
    await weight.press('Enter');
    await expect(performed).toContainText(`(${count})`);
  }
  await expect(page.locator('.entries-list .entry-row')).toHaveCount(15);
  expect(await noBodyOverflow()).toBe(true);

  // The primary Log control is still on screen, not covered, and a full-size target.
  await logButton.scrollIntoViewIfNeeded();
  const box = await logButton.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width);
  expect(await logButton.evaluate(button => {
    const rect = button.getBoundingClientRect();
    return button.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
  })).toBe(true);

  // Range text on the RIR and velocity-loss gauge inputs.
  const gaugeScale = page.getByRole('combobox', { name: 'Intensity gauge scale' });
  await gaugeScale.selectOption('rir');
  await expect(page.getByRole('spinbutton', { name: 'Reps in reserve from 0 to 10' })).toBeVisible();
  await gaugeScale.selectOption('velocity_loss');
  await expect(page.getByRole('spinbutton', { name: 'Velocity loss percentage from 0 to 100' })).toBeVisible();
  expect(await noBodyOverflow()).toBe(true);

  await capture(page, scenario, 'logger-many-sets', [
    'After many logged sets the Log control stays reachable and the page does not scroll sideways.',
  ]);
});

test('captures saved custom-template preview and archived-library states', async ({ page }) => {
  const scenario = VISUAL_SCENARIOS.find(candidate => candidate.id === 'session-runner-custom-template-library');
  if (!scenario) throw new Error('Missing saved custom-template library visual scenario');
  await visitScenario(page, scenario);

  const newSessionBtn = page.getByRole('button', { name: '＋ New session' });
  await newSessionBtn.click();
  await page.getByRole('button', { name: 'From template' }).click();

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
