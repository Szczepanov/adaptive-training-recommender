import { expect, test, type Page } from '@playwright/test';
import {
  dismissOnboardingIfVisible,
  hasPersistedCheckin,
  openFixturePicker,
  provisionAthlete,
  readSessionExecutions,
  seedRecoverySnapshot,
  signInThroughUi,
  type E2EAthlete,
} from '../support/athlete';

async function completeCheckin(page: Page, athlete: E2EAthlete, date: string): Promise<void> {
  await page.getByRole('button', { name: /Feeling normal today\? Use typical values/ }).click();
  await page.getByRole('button', { name: "Save & see today's plan", exact: true }).click();
  await expect.poll(() => hasPersistedCheckin(athlete, date)).toBe(true);
  await dismissOnboardingIfVisible(page);
  await expect(page.getByLabel("Today's Morning Training Decision")).toBeVisible();
}

test('Back and Forward restore routed screens and active navigation', async ({ page }) => {
  const athlete = await provisionAthlete();
  const date = await seedRecoverySnapshot(athlete);
  await signInThroughUi(page, athlete);
  await completeCheckin(page, athlete, date);

  const nav = page.locator('.navbar-desktop-menu');
  await nav.getByRole('button', { name: 'Plan', exact: true }).click();
  await expect(page).toHaveURL(/\?screen=plan$/);
  await expect(nav.getByRole('button', { name: 'Plan', exact: true })).toHaveAttribute('aria-current', 'page');
  await nav.getByRole('button', { name: /More/ }).click();
  await page.locator('#desktop-more-panel').getByRole('button', { name: /Goals/ }).click();
  await expect(page.getByRole('heading', { name: 'Goals', exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\?screen=goals$/);
  await expect(nav.getByRole('button', { name: /More/ })).toHaveClass(/active/);

  await page.goBack();
  await expect(page).toHaveURL(/\?screen=plan$/);
  await expect(nav.getByRole('button', { name: 'Plan', exact: true })).toHaveAttribute('aria-current', 'page');
  await page.goBack();
  await expect(page).toHaveURL(/\?screen=home$/);
  await expect(nav.getByRole('button', { name: 'Home', exact: true })).toHaveAttribute('aria-current', 'page');
  await page.goForward();
  await expect(page).toHaveURL(/\?screen=plan$/);
  await page.goForward();
  await expect(page.getByRole('heading', { name: 'Goals', exact: true })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.bottom-nav').getByRole('button', { name: /More/ })).toHaveClass(/active/);
  await page.goBack();
  await expect(page.locator('.bottom-nav').getByRole('button', { name: /Plan/ })).toHaveAttribute('aria-current', 'page');
});

test('a safe deep link survives refresh and invalid routes resolve after authentication', async ({ page }) => {
  const athlete = await provisionAthlete();
  const date = await seedRecoverySnapshot(athlete);
  await signInThroughUi(page, athlete);
  await completeCheckin(page, athlete, date);

  await page.goto('/?screen=goals');
  await expect(page.getByRole('heading', { name: 'Goals', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Goals', exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\?screen=goals$/);

  await page.goto('/?screen=not-a-screen');
  await expect(page.getByLabel("Today's Morning Training Decision")).toBeVisible();
  await expect(page).toHaveURL(/\?screen=home$/);
  await page.goto('/invalid-path?screen=goals');
  await expect(page.getByLabel("Today's Morning Training Decision")).toBeVisible();
  await expect(page).toHaveURL(/\/\?screen=home$/);
});

test('pending check-in takes precedence over a deep link on initial authentication', async ({ page }) => {
  const athlete = await provisionAthlete();
  await seedRecoverySnapshot(athlete);
  await page.goto('/?screen=goals');
  await page.getByPlaceholder('Email address').fill(athlete.email);
  await page.getByPlaceholder('Password').fill(athlete.password);
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Check-in', exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\?screen=checkin$/);
  await dismissOnboardingIfVisible(page);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Check-in', exact: true })).toBeVisible();

  await page.getByRole('button', { name: /Skip to Dashboard/ }).click();
  await expect(page.getByLabel("Today's Morning Training Decision")).toBeVisible();
  const nav = page.locator('.navbar-desktop-menu');
  await nav.getByRole('button', { name: 'Plan', exact: true }).click();
  await nav.getByRole('button', { name: /More/ }).click();
  await page.locator('#desktop-more-panel').getByRole('button', { name: /Goals/ }).click();
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Plan', exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\?screen=plan$/);
  await page.goBack();
  await expect(page.getByLabel("Today's Morning Training Decision")).toBeVisible();
  await expect(page).toHaveURL(/\?screen=home$/);
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Check-in', exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\?screen=checkin$/);
  await page.goForward();
  await expect(page.getByLabel("Today's Morning Training Decision")).toBeVisible();
  await expect(page).toHaveURL(/\?screen=home$/);
});

test('Back minimizes a persisted structured session and Resume restores it', async ({ page }) => {
  const athlete = await provisionAthlete();
  const date = await seedRecoverySnapshot(athlete);
  await signInThroughUi(page, athlete);
  await completeCheckin(page, athlete, date);

  const nav = page.locator('.navbar-desktop-menu');
  await nav.getByRole('button', { name: /More/ }).click();
  await page.locator('#desktop-more-panel').getByRole('button', { name: /Testing/ }).click();
  await expect(page).toHaveURL(/\?screen=testing$/);

  await openFixturePicker(page);
  await page.getByRole('button', { name: 'Start Session →', exact: true }).first().click();
  await expect.poll(async () => (await readSessionExecutions(athlete)).filter(item => item.state === 'in_progress').length).toBe(1);
  await expect(page.locator('.global-navbar')).toHaveCount(0);
  const activeId = (await readSessionExecutions(athlete))[0]?.executionId;
  await expect(page).toHaveURL(/\?screen=sessions$/);

  await page.goBack();
  await expect(page).toHaveURL(/\?screen=home$/);
  await expect(page.getByRole('status').filter({ hasText: 'Structured session in progress' })).toBeVisible();
  expect((await readSessionExecutions(athlete))[0]?.executionId).toBe(activeId);

  await page.goForward();
  await expect(page).toHaveURL(/\?screen=sessions$/);
  await expect(page.getByRole('button', { name: /Finish Session \(/ })).toBeVisible();
  await expect(page.locator('.global-navbar')).toHaveCount(0);
  await page.goBack();
  await page.getByRole('button', { name: 'Resume session' }).click();
  await expect(page).toHaveURL(/\?screen=sessions$/);
  await expect.poll(async () => (await readSessionExecutions(athlete)).map(item => `${item.executionId}:${item.state}`))
    .toEqual([`${activeId}:in_progress`]);

  await page.goBack();
  await expect(page).toHaveURL(/\?screen=home$/);
  await nav.getByRole('button', { name: /More/ }).click();
  await page.locator('#desktop-more-panel').getByRole('button', { name: /Testing/ }).click();
  await nav.getByRole('button', { name: 'Plan', exact: true }).click();
  await page.goBack();
  await expect(page).toHaveURL(/\?screen=testing$/);
});
