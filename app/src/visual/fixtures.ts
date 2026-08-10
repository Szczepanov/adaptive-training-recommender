import type {
  DailyDecisionInput,
  DailyRecoverySnapshot,
  DailySubjectiveCheckin,
  TrainingSettings,
  UserGoal,
  UserPreferences,
} from '../engine/models';

export const VISUAL_USER_ID = 'visual-athlete';
export const VISUAL_DATE = '2026-09-12';
const TIMESTAMP = '2026-09-12T08:00:00.000+02:00';

export type VisualScreen = 'home' | 'checkin' | 'goals' | 'data' | 'constraints' | 'preferences';

export interface VisualScenario {
  id: string;
  title: string;
  screen: VisualScreen;
  expectedFocus: string[];
  fixture: VisualFixture;
}

export interface VisualFixture {
  input: DailyDecisionInput;
  goals: Array<UserGoal & { id: string }>;
  settings: TrainingSettings;
  preferences: UserPreferences;
  checkin: DailySubjectiveCheckin | null;
  recovery: DailyRecoverySnapshot | null;
}

const settings: TrainingSettings = {
  userId: VISUAL_USER_ID,
  schemaVersion: 2,
  equipment: { free_weights: true, cable_machine: false, treadmill: true, indoor_bike: true, pullup_bar: true },
  guardrails: { avoid_high_impact: false, avoid_heavy_lower_body: false, avoid_overhead_pressing: false, avoid_heavy_spinal_loading: false },
  defaults: { weekdayMaxMinutes: 60, weekendMaxMinutes: 90, environment: 'either' },
  preferences: { preferActiveRecovery: true },
  migration: { legacyReviewed: true, migratedAt: null },
  createdAt: TIMESTAMP,
  updatedAt: TIMESTAMP,
};

const preferences: UserPreferences = {
  userId: VISUAL_USER_ID,
  preferredRecoveryStyle: 'active',
  defaultWeekdayTimeMin: 60,
  defaultWeekendTimeMin: 90,
  preferredTimeOfDay: 'morning',
  preferredModalities: ['Running', 'Cycling', 'Strength'],
  deprioritizedModalities: [],
  avoidedModalities: [],
  explanationVerbosity: 'brief',
  conservativeBias: false,
  preferredUnits: { distance: 'km', weight: 'kg', temperature: 'celsius' },
  schemaVersion: 1,
  createdAt: TIMESTAMP,
  updatedAt: TIMESTAMP,
};

const recovery: DailyRecoverySnapshot = {
  userId: VISUAL_USER_ID,
  date: VISUAL_DATE,
  source: { garminSyncedAt: TIMESTAMP, sourceSchemaVersion: 3, timezone: 'Europe/Warsaw' },
  raw: {
    sleepScore: 82,
    sleepDurationSec: 27_600,
    restingHr: 51,
    hrvOvernightAvg: 62,
    hrvStatus: 'Balanced',
    respirationAvg: 14,
    bodyBatteryWake: 76,
    bodyBatteryChange: 54,
    totalSteps: 9_240,
    last3DaysHardSessionsCount: 1,
    yesterdayTraining: {
      activityCount: 1,
      totalDurationMin: 65,
      hardActivityCount: 1,
      primaryActivity: { activityId: 'ride-1', type: 'Cycling', durationMin: 65, trainingEffect: 3.4, intensityTag: 'moderate' },
    },
    todayTraining: null,
  },
  derived: {
    baselineComputationVersion: 2,
    sleepScore7dAvg: 79,
    sleepScore28dAvg: 78,
    restingHr7dAvg: 50,
    restingHr28dAvg: 50,
    hrv7dAvg: 60,
    hrv28dAvg: 59,
    respiration7dAvg: 14,
    respiration28dAvg: 14,
    hrv28dStdev: 6,
    restingHr28dStdev: 3,
    sleepScore28dStdev: 7,
    deltas: {
      sleepScoreVs7d: 3,
      sleepScoreVs28d: 4,
      restingHrVs7d: 1,
      restingHrVs28d: 1,
      hrvVs7d: 2,
      hrvVs28d: 3,
      respirationVs7d: 0,
      respirationVs28d: 0,
    },
  },
  dataQuality: {
    sleepScoreAvailable: true,
    restingHrAvailable: true,
    hrvAvailable: true,
    baseline7dReady: true,
    baseline28dReady: true,
  },
  createdAt: TIMESTAMP,
  updatedAt: TIMESTAMP,
};

const checkin: DailySubjectiveCheckin = {
  userId: VISUAL_USER_ID,
  date: VISUAL_DATE,
  readiness: 8,
  sleepQuality: 8,
  fatigue: 3,
  soreness: 2,
  mentalStress: 3,
  motivation: 8,
  painOrInjury: false,
  illnessSymptoms: false,
  unusuallyLimitedTime: false,
  alreadyTrainedToday: false,
  availability: { timeAvailableMin: 60, preferredModalityToday: 'Running', indoorOnly: false },
  notes: 'Legs feel fresh after yesterday’s ride.',
  submittedAt: TIMESTAMP,
  dataQuality: { isComplete: true, missingFields: [] },
  schemaVersion: 1,
  createdAt: TIMESTAMP,
  updatedAt: TIMESTAMP,
};

const eventGoal: UserGoal & { id: string } = {
  id: 'visual-event-goal',
  userId: VISUAL_USER_ID,
  category: 'short-term',
  domain: 'endurance',
  title: 'Autumn Road Race',
  description: 'Build sustainable cycling endurance for a rolling road race.',
  priority: 5,
  status: 'active',
  targetDate: '2026-10-10',
  targetOutcome: 'Finish strongly with the lead group.',
  eventCategory: 'cycling_event',
  eventPreset: 'road_race',
  eventLifecycle: 'scheduled',
  schemaVersion: 1,
  createdAt: TIMESTAMP,
  updatedAt: TIMESTAMP,
};

function buildFixture(overrides: Partial<Pick<VisualFixture, 'settings' | 'preferences' | 'checkin' | 'recovery' | 'goals'>> = {}): VisualFixture {
  const fixtureSettings = overrides.settings ?? settings;
  const fixturePreferences = overrides.preferences ?? preferences;
  const fixtureCheckin = overrides.checkin === undefined ? checkin : overrides.checkin;
  const fixtureRecovery = overrides.recovery === undefined ? recovery : overrides.recovery;
  const fixtureGoals = overrides.goals ?? [eventGoal];

  return {
    settings: fixtureSettings,
    preferences: fixturePreferences,
    checkin: fixtureCheckin,
    recovery: fixtureRecovery,
    goals: fixtureGoals,
    input: {
      userId: VISUAL_USER_ID,
      date: VISUAL_DATE,
      recoverySnapshot: fixtureRecovery,
      subjectiveCheckin: fixtureCheckin,
      activeGoals: fixtureGoals,
      trainingSettings: fixtureSettings,
      preferences: fixturePreferences,
      trainingIntentProfile: null,
      dataQuality: {
        hasRecoverySnapshot: fixtureRecovery !== null,
        hasSubjectiveCheckin: fixtureCheckin !== null,
        subjectiveCheckinComplete: fixtureCheckin?.dataQuality.isComplete ?? false,
        profileReady: fixturePreferences !== null,
      },
    },
  };
}

const reducedCheckin: DailySubjectiveCheckin = {
  ...checkin,
  readiness: 5,
  sleepQuality: 5,
  fatigue: 6,
  soreness: 7,
  mentalStress: 6,
  motivation: 5,
  notes: 'Sore calves after yesterday’s ride; keep impact conservative.',
};

const recoveryCheckin: DailySubjectiveCheckin = {
  ...reducedCheckin,
  readiness: 2,
  fatigue: 8,
  soreness: 8,
  painOrInjury: true,
  notes: 'New lower-leg pain during stairs.',
};

const incompleteCheckin: DailySubjectiveCheckin = {
  ...checkin,
  readiness: 6,
  sleepQuality: null,
  fatigue: null,
  soreness: 4,
  mentalStress: null,
  motivation: null,
  dataQuality: { isComplete: false, missingFields: ['sleepQuality', 'fatigue', 'mentalStress', 'motivation'] },
};

const restrictedSettings: TrainingSettings = {
  ...settings,
  guardrails: { ...settings.guardrails, avoid_high_impact: true, avoid_heavy_lower_body: true },
};

const standardFixture = buildFixture();

export const VISUAL_SCENARIOS: VisualScenario[] = [
  {
    id: 'home-normal-load',
    title: 'Home — normal load with target event',
    screen: 'home',
    expectedFocus: ['Today is the primary action.', 'Target-event context is visible without competing with the plan.', 'Tomorrow is selected in the seven-day view.'],
    fixture: standardFixture,
  },
  {
    id: 'home-reduced-load',
    title: 'Home — reduced load',
    screen: 'home',
    expectedFocus: ['The decision badge communicates reduced load.', 'The rationale makes the trade-off understandable.', 'Workout details remain secondary until requested.'],
    fixture: buildFixture({ checkin: reducedCheckin }),
  },
  {
    id: 'home-recovery-day',
    title: 'Home — recovery day with safety flag',
    screen: 'home',
    expectedFocus: ['Recovery status is unmistakable.', 'Safety restrictions are visible and the harder control is unavailable.'],
    fixture: buildFixture({ checkin: recoveryCheckin, settings: restrictedSettings }),
  },
  {
    id: 'home-missing-data',
    title: 'Home — missing recovery data',
    screen: 'home',
    expectedFocus: ['The missing-data state provides a clear next step.', 'Profile completeness appears only when actionable.'],
    fixture: buildFixture({ recovery: null, checkin: incompleteCheckin }),
  },
  {
    id: 'checkin-complete',
    title: 'Daily check-in',
    screen: 'checkin',
    expectedFocus: ['Question framing and current recovery context are legible on first view.'],
    fixture: standardFixture,
  },
  {
    id: 'goals-event',
    title: 'Goals — event target',
    screen: 'goals',
    expectedFocus: ['The target date, lifecycle, and event context are scannable.'],
    fixture: standardFixture,
  },
  {
    id: 'data-recovery',
    title: 'Detailed data — recovery tab',
    screen: 'data',
    expectedFocus: ['Dense telemetry remains grouped and readable.'],
    fixture: standardFixture,
  },
  {
    id: 'training-setup-restricted',
    title: 'Training setup — active restrictions',
    screen: 'constraints',
    expectedFocus: ['Safety restrictions are clearly distinguished from available equipment.'],
    fixture: buildFixture({ settings: restrictedSettings }),
  },
  {
    id: 'coach-preferences',
    title: 'Coach preferences',
    screen: 'preferences',
    expectedFocus: ['Preference groups and save affordances are clear.'],
    fixture: standardFixture,
  },
];

export function getVisualScenario(id: string | null): VisualScenario {
  return VISUAL_SCENARIOS.find((scenario) => scenario.id === id) ?? VISUAL_SCENARIOS[0];
}
