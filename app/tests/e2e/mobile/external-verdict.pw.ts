import { expect, test } from '../support/test';
import {
  completeTypicalCheckin,
  provisionAthlete,
  seedRecoverySnapshot,
  signInThroughUi,
} from '../support/athlete';
import { seedExternalPlanForToday } from '../support/externalPlan';

// The one browser journey per imported-plan verdict. It runs at phone width, the primary
// product context; the verdict copy itself is covered by ExternalVerdictBanner.test.tsx.
interface VerdictCase {
  kind: 'proceed' | 'scale' | 'defer' | 'skip';
  title: string;
  depleted: boolean;
  label: string;
  detail: string;
  session: string;
}

const CASES: readonly VerdictCase[] = [
  {
    kind: 'proceed',
    title: 'an imported proceed session shows its verdict, source and Start path',
    depleted: false,
    label: 'Do it as written',
    detail: 'Easy spin, nothing over 60% FTP.',
    session: 'E2E easy spin',
  },
  {
    kind: 'scale',
    title: 'a scaled imported session shows the reduced version without launching the full structured dose',
    depleted: true,
    label: 'Do the reduced version',
    detail: 'Cut it in half.',
    session: 'E2E hard intervals',
  },
  {
    kind: 'defer',
    title: 'a deferred imported session names its verdict and offers no Start path',
    depleted: true,
    label: 'Move it to another day',
    detail: 'Nothing from this session is prescribed today',
    session: 'E2E hard intervals',
  },
  {
    kind: 'skip',
    title: 'an excluded imported session names its verdict and offers no Start path as written',
    depleted: false,
    label: 'Not today',
    detail: 'Nothing from this session is prescribed today',
    session: 'E2E overlong ride',
  },
];

for (const verdictCase of CASES) {
  test(`${verdictCase.title} on a phone viewport`, async ({ page }) => {
    const athlete = await provisionAthlete();
    const date = await seedRecoverySnapshot(athlete, verdictCase.depleted ? { bodyBatteryWake: 25 } : {});
    const seed = await seedExternalPlanForToday(athlete, verdictCase.kind);
    await signInThroughUi(page, athlete);
    await completeTypicalCheckin(page, athlete, date);

    const verdict = page.getByRole('region', { name: 'Imported plan session' });
    await expect(verdict).toBeVisible();
    await expect(verdict).toContainText(verdictCase.label);
    await expect(verdict).toContainText(`${seed.planId} (revision 1)`);
    await expect(verdict).toContainText(verdictCase.detail);

    const start = page.getByRole('button', { name: new RegExp(`Start ${verdictCase.session}`) });
    if (verdictCase.kind === 'proceed') {
      await expect(start).toBeVisible();
      return;
    }
    if (verdictCase.kind === 'scale') {
      await expect(verdict).toContainText('Start is unavailable for this reduced form');
      await expect(page.getByText(/min · reduced/, { exact: false })).toBeVisible();
    }
    // The imported prescription must not be launchable as written.
    await expect(start).toHaveCount(0);
    await expect(page.getByRole('button', { name: new RegExp(`Resume ${verdictCase.session}`) })).toHaveCount(0);
  });
}
