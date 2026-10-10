import { expect, test } from './support/test';
import {
  completeTypicalCheckin,
  provisionAthlete,
  seedRecoverySnapshot,
  signInThroughUi,
} from './support/athlete';
import { readCollection } from './support/roundTrip';
import { assertNoBodyHorizontalOverflow } from './support/mobileAssertions';
import type { UserGoal } from '../../src/engine/models';
import { addDaysToLocalDateString } from '../../src/utils/localDate';

for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
  test.describe(`HYROX goals at ${viewport.width}px`, () => {
    test.use({ viewport });

    test('create, reload, and edit retain the HYROX Open Singles preset', async ({ page }) => {
      const athlete = await provisionAthlete();
      const today = await seedRecoverySnapshot(athlete);
      const targetDate = addDaysToLocalDateString(today, 60);
      const editedDate = addDaysToLocalDateString(today, 67);
      const title = 'HYROX Open Singles target';
      await signInThroughUi(page, athlete);
      await completeTypicalCheckin(page, athlete, today);

      if (viewport.width < 768) {
        await page.locator('.bottom-nav').getByRole('button', { name: /More/ }).click();
        await page.getByRole('dialog', { name: 'Navigation & Settings' }).getByRole('button', { name: /Goals/ }).click();
      } else {
        await page.locator('.navbar-desktop-menu').getByRole('button', { name: /More/ }).click();
        await page.locator('#desktop-more-panel').getByRole('button', { name: /Goals/ }).click();
      }

      await page.getByRole('button', { name: '+ Add Goal' }).click();
      const createDialog = page.getByRole('dialog', { name: 'Add New Goal' });
      await createDialog.locator('input[type="text"]').first().fill(title);
      await createDialog.getByLabel('Open-ended goal (no exact date)').uncheck();
      await createDialog.locator('input[type="date"]').first().fill(targetDate);
      await createDialog.getByLabel('This is a race / key event').check();
      await createDialog.getByLabel('Event type', { exact: true }).selectOption({ label: 'Fitness race (HYROX)' });
      await createDialog.getByLabel('Event style', { exact: true }).selectOption({ label: 'HYROX Open Singles' });
      await createDialog.locator('.priority-selector button').nth(4).click();
      await expect(createDialog).toContainText('Training and taper use generic event guidance');
      await expect(createDialog).toContainText('HYROX-specific workouts and plans are not available yet');
      await assertNoBodyHorizontalOverflow(page);
      await createDialog.getByRole('button', { name: 'Create Goal' }).click();
      await expect(createDialog).toBeHidden();

      const expectedGoal = {
        userId: athlete.userId,
        title,
        eventCategory: 'fitness_race',
        eventPreset: 'hyrox_open_singles',
        eventLifecycle: 'scheduled',
        targetDate,
        priority: 5,
      };
      const readGoal = async () => (await readCollection<UserGoal>(athlete, 'goals')).find(goal => goal.title === title);
      await expect.poll(readGoal).toMatchObject(expectedGoal);

      await page.reload();
      await expect(page.getByRole('heading', { name: 'Goals', exact: true })).toBeVisible();
      const card = page.locator('.goal-card').filter({ has: page.getByRole('heading', { name: title }) });
      await expect(card).toContainText('HYROX Open Singles');
      await expect(card).toContainText('Taper class A');
      await expect(card).toContainText('Training and taper use generic event guidance');
      await card.getByRole('button', { name: 'Edit', exact: true }).click();

      const editDialog = page.getByRole('dialog', { name: 'Edit Goal' });
      await expect(editDialog.getByLabel('Event type', { exact: true })).toHaveValue('fitness_race');
      await expect(editDialog.getByLabel('Event style', { exact: true })).toHaveValue('hyrox_open_singles');
      await expect(editDialog.locator('input[type="date"]').first()).toHaveValue(targetDate);
      await editDialog.locator('input[type="date"]').first().fill(editedDate);
      await editDialog.locator('.priority-selector button').nth(2).click();
      await editDialog.getByRole('button', { name: 'Update Goal' }).click();
      await expect(editDialog).toBeHidden();
      await expect.poll(readGoal).toMatchObject({ ...expectedGoal, targetDate: editedDate, priority: 3 });

      await page.reload();
      await expect(card).toContainText('HYROX Open Singles');
      await expect(card).toContainText('Taper class B');
      await assertNoBodyHorizontalOverflow(page);
      await card.getByRole('button', { name: 'Edit', exact: true }).click();
      await expect(editDialog.getByLabel('Event type', { exact: true })).toHaveValue('fitness_race');
      await expect(editDialog.getByLabel('Event style', { exact: true })).toHaveValue('hyrox_open_singles');
      await expect(editDialog.locator('input[type="date"]').first()).toHaveValue(editedDate);
      await expect(editDialog.locator('.priority-selector button.active')).toHaveCount(3);
    });
  });
}
