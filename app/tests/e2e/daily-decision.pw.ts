import { expect, test } from './support/test';
import {
  completeTypicalCheckin,
  provisionAthlete,
  readPersistedRecommendation,
  seedRecoverySnapshot,
  signInThroughUi,
} from './support/athlete';
import { parseDailyRecommendation } from '../../src/persistence/parsers/trainingHistory';

test('a complete check-in produces a visible daily recommendation without shadow-mode opt-in', async ({ page }) => {
  const athlete = await provisionAthlete();
  const date = await seedRecoverySnapshot(athlete);

  await signInThroughUi(page, athlete);
  await completeTypicalCheckin(page, athlete, date);

  // Decision Journal / shadow mode is opt-in. A fresh athlete has no preference document yet,
  // so Home must fail closed: the recommendation is immediately visible (asserted by the
  // check-in helper) and there is no reveal gate.
  await expect(page.getByRole('button', { name: /Reveal today's recommendation/ })).toHaveCount(0);

  // WP5 (issue #953): verify recommendation persistence and shape under security rules
  await expect.poll(async () => {
    const raw = await readPersistedRecommendation(athlete, date);
    if (!raw) return null;
    const parsed = parseDailyRecommendation(raw, `users/${athlete.userId}/daily_recommendations/${date}`);
    return parsed.status === 'AVAILABLE' ? { status: parsed.status, revision: parsed.data.revision } : null;
  }).toEqual({ status: 'AVAILABLE', revision: 1 });
});
