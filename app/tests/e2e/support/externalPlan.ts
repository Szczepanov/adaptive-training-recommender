import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, type Firestore } from 'firebase/firestore';
import { addDaysToLocalDateString, getLocalDateString } from '../../../src/utils/localDate';
import { EXTERNAL_PLAN_SCHEMA } from '../../../src/engine/models';
import { computeContentHash } from '../../../src/engine/externalPlanHash';
import { EXTERNAL_PLAN_SCHEMA_V4 } from '../../../src/sessions/externalPlanV4';
import { E2E_PROJECT_ID, E2E_EMULATOR_HOST, E2E_FIRESTORE_PORT, type E2EAthlete } from './athlete';

const EMULATOR_HOST = E2E_EMULATOR_HOST;
const FIRESTORE_EMULATOR_PORT = E2E_FIRESTORE_PORT;

type ExternalWeekday = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';

const WEEKDAYS: ExternalWeekday[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

/** Warsaw-calendar weekday of a YYYY-MM-DD string, using the same UTC-day arithmetic as the plan validator. */
export function weekdayOf(dateStr: string): ExternalWeekday {
  const [year, month, day] = dateStr.split('-').map(Number);
  const utcDay = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  // getUTCDay: 0 = Sunday .. 6 = Saturday; plan vocabulary starts Monday.
  return WEEKDAYS[(utcDay + 6) % 7];
}

/** Monday (Warsaw) of the week containing `dateStr`. */
export function mondayOfWeek(dateStr: string): string {
  const offset = WEEKDAYS.indexOf(weekdayOf(dateStr));
  return addDaysToLocalDateString(dateStr, -offset);
}

export interface E2EExternalVerdictSeed {
  date: string;
  planId: string;
}

/**
 * Seeds one imported plan (header + immutable revision) plus an externally_planned
 * training-intent profile, with a single `fixed` session placed on today. Reads bypass
 * security rules exactly like `seedRecoverySnapshot` does; the app itself then reads
 * through the real services, validators, adjudicator and Home wiring untouched.
 */
export async function seedExternalPlanForToday(
  athlete: E2EAthlete,
  kind: 'proceed' | 'scale' | 'defer' | 'skip',
): Promise<E2EExternalVerdictSeed> {
  const date = getLocalDateString();
  const today = weekdayOf(date);
  const startDate = mondayOfWeek(date);
  const planId = `e2e-verdict-${kind}`;
  const timestamp = `${date}T06:00:00.000Z`;

  // A 360-minute session can never fit the default availability ceiling, so the `skip`
  // case deterministically fails the `time_limit` hard gate under typical check-in values.
  // The `scale` case pairs a flat overnight battery (Easy plan tier) with a short hard
  // session that fits the day's availability but sits above that tier's systemic
  // ceiling, which the adjudicator reduces instead of excluding.
  const durationMin = kind === 'skip' ? 360 : 45;
  const durationMax = kind === 'proceed' ? 60 : kind === 'scale' || kind === 'defer' ? 45 : 360;
  const intensity = kind === 'scale' || kind === 'defer' ? 'hard' : 'easy';
  const title = kind === 'proceed' ? 'E2E easy spin' : kind === 'skip' ? 'E2E overlong ride' : 'E2E hard intervals';
  const summary = kind === 'proceed'
    ? 'Easy spin, nothing over 60% FTP.'
    : kind === 'scale' || kind === 'defer'
      ? '5x3 min hard with 3 min easy between.'
      : 'A full-day epic that cannot fit any real day.';

  // The `proceed` and `scale` cases seed an `external-plan@4` revision so the test
  // exercises the real Home launch path: only v4 sessions carry the `definition` the
  // executable binding is built from. The `skip` case needs no binding and stays on v1.
  // The `defer` case keeps a high useful-dose floor so the same ceiling that scales the
  // `scale` case instead defers it below a useful fragment.
  const v4 = kind !== 'skip';
  const session = {
    id: 'today-session',
    title,
    priority: 'supporting',
    placement: { week: 1, preferredDay: today, flexibility: 'fixed', ifMissed: 'drop' },
    gating: {
      modality: 'cycling',
      intensity,
      durationMin,
      durationMax,
      environment: 'either',
      equipment: [],
    },
    ...(v4
      ? {
        definition: {
          schemaVersion: 1,
          id: 'e2e-today-session',
          revision: 1,
          title,
          summary,
          intent: 'training',
          dominantModality: 'cycling',
          duration: { min: durationMin, max: durationMax },
          blocks: [{
            id: 'main',
            role: 'main',
            executionMode: 'sequential',
            steps: [
              { id: 'work', kind: 'exercise', title, exerciseRef: { kind: 'catalog', exerciseId: 'cycling-work' }, dose: { kind: 'duration', seconds: durationMin * 60 } },
            ],
          }],
        },
      }
      : {
        prescription: { summary },
      }),
    scaling: { reducible: true, reducedSummary: 'Cut it in half.', reducedDurationMin: 30, minimumUsefulDurationMin: kind === 'scale' ? 10 : 20 },
  };

  const plan = {
    schema: v4 ? EXTERNAL_PLAN_SCHEMA_V4 : EXTERNAL_PLAN_SCHEMA,
    planId,
    revision: 1,
    title: `E2E ${kind} block`,
    startDate,
    weekCount: 2,
    ...(v4 ? { restDays: [] } : {}),
    sessions: [session],
  };
  const contentHash = await computeContentHash(plan as never);

  const environment = await initializeTestEnvironment({
    projectId: E2E_PROJECT_ID,
    firestore: { host: EMULATOR_HOST, port: FIRESTORE_EMULATOR_PORT },
  });
  try {
    await environment.withSecurityRulesDisabled(async context => {
      const db = context.firestore() as unknown as Firestore;
      await setDoc(doc(db, 'users', athlete.userId, 'external_plans', planId), {
        userId: athlete.userId,
        planId,
        revision: 1,
        title: plan.title,
        startDate,
        weekCount: 2,
        contentHash,
        importedAt: timestamp,
        supersededFrom: null,
        updatedAt: timestamp,
      });
      await setDoc(doc(db, 'users', athlete.userId, 'external_plans', planId, 'revisions', '1'), plan);
      await setDoc(doc(db, 'users', athlete.userId, 'external_plans', planId, 'activations', '1'), {
        userId: athlete.userId,
        planId,
        revision: 1,
        contentHash,
        effectiveFrom: startDate,
        activatedAt: timestamp,
      });
      await setDoc(doc(db, 'users', athlete.userId, 'training_intent', 'profile'), {
        userId: athlete.userId,
        planningMode: 'externally_planned',
        priorities: ['endurance'],
        weeklyCommitment: { minSessions: 4, targetSessions: 5, maxSessions: 6 },
        organizationPreference: 'auto',
        schemaVersion: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    });
  } finally {
    await environment.cleanup();
  }
  return { date, planId };
}
