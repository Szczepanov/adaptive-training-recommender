import {
  EXTERNAL_PLAN_SCHEMA,
  type DailyDecisionInput,
  type DailyRecoverySnapshot,
  type DailySubjectiveCheckin,
  type ExternalTrainingPlan,
  type NormalizedGarminActivity,
  type TrainingIntentProfile,
  type TrainingSettings,
  type UserGoal,
  type UserPreferences,
} from '../engine/models';

import type { StrengthSession } from '../engine/models';

export const VISUAL_USER_ID = 'visual-athlete';
export const VISUAL_DATE = '2026-09-12';
const TIMESTAMP = '2026-09-12T08:00:00.000+02:00';

export type VisualScreen = 'home' | 'checkin' | 'goals' | 'data' | 'constraints' | 'preferences' | 'session';

export interface VisualScenario {
  id: string;
  title: string;
  screen: VisualScreen;
  expectedFocus: string[];
  fixture: VisualFixture;
  initialDataTab?: 'recovery' | 'activities';
}

export interface VisualFixture {
  input: DailyDecisionInput;
  goals: Array<UserGoal & { id: string }>;
  settings: TrainingSettings;
  preferences: UserPreferences;
  checkin: DailySubjectiveCheckin | null;
  recovery: DailyRecoverySnapshot | null;
  activities: NormalizedGarminActivity[];
  /** An imported plan governing this date (ADR-0019). Absent for every other scenario, so
   * the ordinary screens keep exercising the ranked path. */
  externalPlan?: ExternalTrainingPlan;
  strengthSession?: StrengthSession | null;
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

function buildFixture(
  overrides: Partial<Pick<VisualFixture, 'settings' | 'preferences' | 'checkin' | 'recovery' | 'goals' | 'activities' | 'externalPlan' | 'strengthSession'>> = {},
  trainingIntentProfile: TrainingIntentProfile | null = null,
): VisualFixture {
  const fixtureSettings = overrides.settings ?? settings;
  const fixturePreferences = overrides.preferences ?? preferences;
  const fixtureCheckin = overrides.checkin === undefined ? checkin : overrides.checkin;
  const fixtureRecovery = overrides.recovery === undefined ? recovery : overrides.recovery;
  const fixtureGoals = overrides.goals ?? [eventGoal];
  const fixtureActivities = overrides.activities ?? [];

  return {
    settings: fixtureSettings,
    preferences: fixturePreferences,
    checkin: fixtureCheckin,
    recovery: fixtureRecovery,
    goals: fixtureGoals,
    activities: fixtureActivities,
    ...(overrides.externalPlan ? { externalPlan: overrides.externalPlan } : {}),
    ...(overrides.strengthSession ? { strengthSession: overrides.strengthSession } : {}),
    input: {
      userId: VISUAL_USER_ID,
      date: VISUAL_DATE,
      recoverySnapshot: fixtureRecovery,
      subjectiveCheckin: fixtureCheckin,
      activeGoals: fixtureGoals,
      trainingSettings: fixtureSettings,
      preferences: fixturePreferences,
      trainingIntentProfile,
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

const neutralCheckin: DailySubjectiveCheckin = {
  ...checkin,
  readiness: 5,
  sleepQuality: 5,
  fatigue: 5,
  soreness: 5,
  mentalStress: 5,
  motivation: 5,
  painOrInjury: false,
  illnessSymptoms: false,
  unusuallyLimitedTime: false,
  alreadyTrainedToday: false,
  notes: null,
};

const painExpandedCheckin: DailySubjectiveCheckin = {
  ...checkin,
  readiness: 4,
  painOrInjury: true,
  tissueResponses: {
    knee: { region: 'knee', morningState: 'moderate', painDuringTraining: 'mild' },
    achilles: { region: 'achilles', morningState: 'mild' },
  },
  notes: 'Knee discomfort during stairs and early morning stiffness.',
};

const restrictedSettings: TrainingSettings = {
  ...settings,
  guardrails: { ...settings.guardrails, avoid_high_impact: true, avoid_heavy_lower_body: true },
};

const standardFixture = buildFixture();

const fullTelemetryActivity: NormalizedGarminActivity = {
  activityId: 'visual-ride-full', date: VISUAL_DATE, type: 'cycling', durationMin: 72,
  trainingEffectAerobic: 3.6, trainingEffectAnaerobic: 1.2, averageHr: 148,
  activityTrainingLoad: 138, intensityTag: 'hard', normalizedPower: 238,
  intensityFactor: 0.86, variabilityIndex: 1.08,
  powerInZones: [
    { zoneNumber: 1, secondsInZone: 600, lowBoundary: 0 },
    { zoneNumber: 2, secondsInZone: 1800, lowBoundary: 150 },
    { zoneNumber: 4, secondsInZone: 900, lowBoundary: 240 },
  ],
  hrInZones: [
    { zoneNumber: 2, secondsInZone: 1500, lowBoundary: 117 },
    { zoneNumber: 4, secondsInZone: 780, lowBoundary: 156 },
  ],
  laps: [
    { lapIndex: 1, durationSeconds: 900, averagePowerWatts: 252, averageHrBpm: 149 },
    { lapIndex: 2, durationSeconds: 360, averagePowerWatts: 142, averageHrBpm: 132 },
    { lapIndex: 3, durationSeconds: 900, averagePowerWatts: 248, averageHrBpm: 152 },
  ],
};

const partialTelemetryActivity: NormalizedGarminActivity = {
  ...fullTelemetryActivity,
  activityId: 'visual-run-partial',
  type: 'running',
  normalizedPower: undefined,
  intensityFactor: undefined,
  variabilityIndex: undefined,
  powerInZones: undefined,
  laps: undefined,
};

const historicalActivity: NormalizedGarminActivity = {
  activityId: 'visual-historical', date: VISUAL_DATE, type: 'walking', durationMin: 45,
  trainingEffectAerobic: 1.2, trainingEffectAnaerobic: 0, averageHr: 108,
  activityTrainingLoad: 24, intensityTag: 'easy',
};

/** Monday of the week containing VISUAL_DATE (2026-09-12, a Saturday), so the imported
 * plan's week 1 is the week on screen. */
const EXTERNAL_PLAN_START = '2026-09-07';

const externallyPlannedProfile: TrainingIntentProfile = {
  userId: VISUAL_USER_ID,
  planningMode: 'externally_planned',
  priorities: ['endurance'],
  weeklyCommitment: { minSessions: 4, targetSessions: 5, maxSessions: 6 },
  organizationPreference: 'auto',
  schemaVersion: 1,
  createdAt: TIMESTAMP,
  updatedAt: TIMESTAMP,
};

/** A short block in the shape a real generated plan takes: a key session on the review
 * date, supporting work around it, and one session the author declared irreducible. */
const importedPlan: ExternalTrainingPlan = {
  schema: EXTERNAL_PLAN_SCHEMA,
  planId: 'autumn-peak',
  revision: 3,
  title: 'Autumn peak block',
  startDate: EXTERNAL_PLAN_START,
  weekCount: 4,
  sessions: [
    {
      id: 'w1-threshold',
      title: 'Threshold 3x12',
      priority: 'key',
      placement: { week: 1, preferredDay: 'tuesday', flexibility: 'preferred', ifMissed: 'carry_forward' },
      gating: { modality: 'cycling', intensity: 'hard', durationMin: 75, durationMax: 90, environment: 'either', equipment: [] },
      objectives: ['threshold_quality'],
      prescription: {
        summary: '3x12 min at threshold, 6 min easy between.',
        steps: [
          { name: 'Warm-up', durationMin: 20, target: 'Zone 2, building' },
          { name: 'Threshold block', durationMin: 12, sets: 3, setRecoveryMin: 6, target: '95-100% FTP' },
          { name: 'Cool-down', durationMin: 10, target: 'Zone 1' },
        ],
      },
      scaling: { reducible: true, reducedSummary: '2x12 instead of 3x12.', reducedDurationMin: 60, minimumUsefulDurationMin: 40, fallback: 'If the trainer is unavailable, a steady 60 min outdoors keeps the week honest.' },
    },
    {
      id: 'w1-lift',
      title: 'Heavy lower body',
      priority: 'supporting',
      placement: { week: 1, preferredDay: 'thursday', flexibility: 'preferred', ifMissed: 'drop' },
      gating: { modality: 'strength', intensity: 'hard', durationMin: 50, durationMax: 60, environment: 'indoor', equipment: ['free_weights'] },
      objectives: ['strength_maintenance'],
      prescription: { summary: 'Squat 4x5, RDL 3x8, split squat 3x8.' },
      scaling: { reducible: false },
    },
    {
      id: 'w1-long',
      title: 'Long endurance ride',
      priority: 'key',
      placement: { week: 1, preferredDay: 'saturday', flexibility: 'preferred', ifMissed: 'reschedule_within_week' },
      gating: { modality: 'cycling', intensity: 'moderate', durationMin: 150, durationMax: 210, environment: 'outdoor', equipment: [] },
      objectives: ['zone2_aerobic'],
      prescription: { summary: '3 hours steady with 3x10 min tempo in the last hour.' },
      scaling: { reducible: true, reducedSummary: 'Cut to 2 hours, keep one tempo block.', reducedDurationMin: 120, minimumUsefulDurationMin: 75 },
    },
    {
      id: 'w1-spin',
      title: 'Recovery spin',
      priority: 'optional',
      placement: { week: 1, preferredDay: 'sunday', flexibility: 'any_day', ifMissed: 'drop' },
      gating: { modality: 'cycling', intensity: 'recovery', durationMin: 40, durationMax: 50, environment: 'either', equipment: [] },
      prescription: { summary: 'Easy spin, nothing over 60% FTP.' },
    },
  ],
};

const externallyPlannedFixture = buildFixture({ externalPlan: importedPlan }, externallyPlannedProfile);

export const VISUAL_SCENARIOS: VisualScenario[] = [
  {
    id: 'home-externally-planned',
    title: 'Home — imported plan governs today',
    screen: 'home',
    expectedFocus: [
      'The verdict leads, not the session: what to do today is unmistakable before the prescription.',
      'The imported plan\'s own week replaces the generated forecast rather than sitting beside it.',
      'Advisory critique reads as observation, never as an instruction or a blocked session.',
    ],
    fixture: externallyPlannedFixture,
  },
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
    id: 'home-checkin-missing-with-garmin',
    title: 'Home — check-in missing with synced Garmin',
    screen: 'home',
    expectedFocus: ['The morning check-in action gate leads and Garmin recovery strip is visible.'],
    fixture: buildFixture({ checkin: null }),
  },
  {
    id: 'home-incomplete-checkin',
    title: 'Home — partially completed check-in',
    screen: 'home',
    expectedFocus: ['The incomplete check-in state guides athlete to finish check-in.'],
    fixture: buildFixture({ checkin: incompleteCheckin }),
  },
  {
    id: 'checkin-complete',
    title: 'Daily check-in',
    screen: 'checkin',
    expectedFocus: ['Question framing and current recovery context are legible on first view.'],
    fixture: standardFixture,
  },
  {
    id: 'checkin-pain-expanded',
    title: 'Daily check-in — pain and affected tissue expanded',
    screen: 'checkin',
    expectedFocus: ['Affected body areas and tissue response levels are clearly displayed.'],
    fixture: buildFixture({ checkin: painExpandedCheckin }),
  },
  {
    id: 'checkin-new',
    title: 'Daily check-in — neutral defaults and quick preset',
    screen: 'checkin',
    expectedFocus: ['Neutral values and quick preset CTA are accessible without visual bias.'],
    fixture: buildFixture({ checkin: neutralCheckin }),
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
    id: 'data-activities-full',
    title: 'Detailed data — full activity telemetry',
    screen: 'data',
    initialDataTab: 'activities',
    expectedFocus: ['Power and heart-rate distributions are comparable at a glance.', 'Lap summaries remain readable on narrow screens.'],
    fixture: buildFixture({ activities: [fullTelemetryActivity] }),
  },
  {
    id: 'data-activities-partial',
    title: 'Detailed data — partial activity telemetry',
    screen: 'data',
    initialDataTab: 'activities',
    expectedFocus: ['An HR-only activity remains useful without blank power sections.'],
    fixture: buildFixture({ activities: [partialTelemetryActivity] }),
  },
  {
    id: 'data-activities-none',
    title: 'Detailed data — historical activity without telemetry',
    screen: 'data',
    initialDataTab: 'activities',
    expectedFocus: ['Historical activities have an explicit empty-detail state rather than a broken layout.'],
    fixture: buildFixture({ activities: [historicalActivity] }),
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
  {
    id: 'session-runner-in-progress',
    title: 'Session Runner — grouped execution',
    screen: 'session',
    expectedFocus: ['The runner shows the current round and advances through a grouped rotation without horizontal overflow.'],
    fixture: standardFixture,
  },
];

export function getVisualScenario(id: string | null): VisualScenario {
  return VISUAL_SCENARIOS.find((scenario) => scenario.id === id) ?? VISUAL_SCENARIOS[0];
}
