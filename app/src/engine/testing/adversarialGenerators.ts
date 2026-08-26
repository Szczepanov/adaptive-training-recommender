import type {
    DailyReadiness,
    UserContext,
    InjuryConstraint,
    UserEvent,
    DailySubjectiveCheckin,
    TrainingSettings,
    UserPreferences,
    BodyRegion,
    SessionTemplate,
} from '../models';
import type { SessionDefinition } from '../../sessions/models';
import { resolveDemandProfile } from '../eventPresets';

export interface PseudoRandom {
    next(): number;
    int(min: number, max: number): number;
    float(min: number, max: number): number;
    choice<T>(array: readonly T[]): T;
    boolean(trueProbability?: number): boolean;
}

export function createPseudoRandom(seed: number = 1337): PseudoRandom {
    let s = seed >>> 0;
    const next = () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 4294967296;
    };
    return {
        next,
        int: (min, max) => Math.floor(next() * (max - min + 1)) + min,
        float: (min, max) => min + next() * (max - min),
        choice: <T>(array: readonly T[]): T => array[Math.floor(next() * array.length)],
        boolean: (prob = 0.5) => next() < prob,
    };
}

const BODY_REGIONS: readonly BodyRegion[] = [
    'knee', 'achilles', 'ankle', 'calf', 'hamstring', 'quadriceps',
    'adductor_groin', 'hip', 'lower_back', 'shoulder', 'elbow', 'wrist',
];

const MODALITIES: readonly SessionTemplate['modality'][] = [
    'Running', 'Cycling', 'Strength', 'Field', 'Mobility', 'None',
];

export function generateAdversarialReadiness(
    prng: PseudoRandom,
    overrides: {
        subjective?: Partial<DailyReadiness['subjective']>;
        objective?: Partial<DailyReadiness['objective']>;
    } = {},
): DailyReadiness {
    const isExtreme = prng.boolean(0.2);
    const hrvDelta = isExtreme ? prng.choice([-35, -25, 25, 40]) : prng.float(-15, 15);
    const rhrDelta = isExtreme ? prng.choice([-10, 8, 12, 18]) : prng.float(-4, 6);
    const hasBaseline = prng.boolean(0.8);

    const readiness: DailyReadiness = {
        subjective: {
            readiness: prng.int(1, 10),
            sleepQuality: prng.int(1, 10),
            fatigue: prng.int(1, 10),
            soreness: prng.int(1, 10),
            stress: prng.int(1, 10),
            motivation: prng.int(1, 10),
            timeAvailable: prng.choice([0, 15, 30, 45, 60, 90, 120, 180]),
            painFlag: prng.boolean(0.15),
            alreadyTrainedToday: prng.boolean(0.1),
            preferredModalityToday: prng.boolean(0.3) ? (prng.choice(MODALITIES) as string) : null,
            ...(overrides.subjective ?? {}),
        },
        objective: {
            total_steps: prng.int(1000, 30000),
            sleep_score: prng.boolean(0.1) ? null : prng.int(30, 99),
            sleep_duration_min: prng.int(180, 600),
            rhr: prng.int(38, 85),
            rhr_7d_avg: prng.int(40, 75),
            rhr_delta: Math.round(rhrDelta * 10) / 10,
            hrv_weekly_avg: prng.int(25, 110),
            hrv_last_night: prng.int(20, 120),
            hrv_delta: Math.round(hrvDelta * 10) / 10,
            hrv_delta_28d: hasBaseline ? Math.round(hrvDelta * 10) / 10 : null,
            hrv_stdev_28d: hasBaseline ? prng.float(2, 10) : null,
            rhr_delta_28d: hasBaseline ? Math.round(rhrDelta * 10) / 10 : null,
            rhr_stdev_28d: hasBaseline ? prng.float(1, 5) : null,
            sleep_score_delta_7d: prng.float(-20, 20),
            sleep_score_delta_28d: hasBaseline ? prng.float(-20, 20) : null,
            sleep_score_stdev_28d: hasBaseline ? prng.float(2, 12) : null,
            respiration: prng.float(11, 20),
            respiration_delta: prng.boolean(0.2) ? prng.float(-2, 4) : 0,
            respiration_delta_28d: hasBaseline ? prng.float(-2, 4) : null,
            respiration_mad_28d: hasBaseline ? prng.float(0.5, 2.5) : null,
            body_battery_wake: prng.boolean(0.1) ? null : prng.int(10, 100),
            last_3_days_hard_sessions_count: prng.int(0, 3),
            yesterday_training: prng.boolean(0.4) ? {
                type: prng.choice(['running', 'cycling', 'strength_training', 'field_sport']),
                duration_min: prng.int(30, 120),
                training_effect: prng.float(1.5, 4.5),
                intensity_tag: prng.choice(['easy', 'moderate', 'hard']),
            } : null,
            today_training: prng.boolean(0.1) ? {
                type: 'running',
                duration_min: 45,
                training_effect: 2.5,
                intensity_tag: 'moderate',
            } : null,
            ...(overrides.objective ?? {}),
        },
    };

    return readiness;
}

const SPORT_MODALITIES: readonly SessionTemplate['modality'][] = [
    'Running', 'Cycling', 'Strength', 'Field', 'Mobility',
];

export function generateAdversarialInjury(
    prng: PseudoRandom,
    overrides: Partial<InjuryConstraint> = {},
): InjuryConstraint {
    return {
        region: prng.choice(BODY_REGIONS),
        severity: prng.choice(['monitor', 'limit', 'exclude']),
        reviewBy: overrides.reviewBy ?? '2099-12-31',
        note: 'Adversarial generated injury constraint',
        restrictedModalities: prng.boolean(0.3) ? [prng.choice(SPORT_MODALITIES)] : undefined,
        ...overrides,
    };
}

export function generateAdversarialUserContext(
    prng: PseudoRandom,
    overrides: Partial<UserContext> = {},
): UserContext {
    const freeWeights = prng.boolean(0.8);
    const indoorBike = prng.boolean(0.5);
    const treadmill = prng.boolean(0.4);
    const cableMachine = prng.boolean(0.3);

    const injuries: InjuryConstraint[] = prng.boolean(0.4)
        ? [generateAdversarialInjury(prng)]
        : [];

    const trainingSettings: TrainingSettings = {
        userId: 'adversarial-user',
        schemaVersion: 2,
        equipment: {
            free_weights: freeWeights,
            indoor_bike: indoorBike,
            treadmill: treadmill,
            cable_machine: cableMachine,
            pullup_bar: prng.boolean(0.5),
        },
        guardrails: {
            avoid_high_impact: prng.boolean(0.2),
            avoid_heavy_lower_body: prng.boolean(0.2),
            avoid_overhead_pressing: prng.boolean(0.2),
            avoid_heavy_spinal_loading: prng.boolean(0.2),
        },
        defaults: {
            weekdayMaxMinutes: prng.choice([20, 30, 45, 60, 90]),
            weekendMaxMinutes: prng.choice([30, 60, 90, 120, 180]),
            environment: prng.choice(['indoor', 'outdoor', 'either']),
        },
        preferences: {
            preferActiveRecovery: prng.boolean(0.5),
        },
        injuries,
        migration: { legacyReviewed: true, migratedAt: null },
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
    };

    const userPreferences: UserPreferences = {
        userId: 'adversarial-user',
        preferredRecoveryStyle: prng.choice(['passive', 'active', 'mixed']),
        defaultWeekdayTimeMin: 60,
        defaultWeekendTimeMin: 90,
        preferredTimeOfDay: 'morning',
        preferredModalities: prng.boolean(0.5) ? [prng.choice(MODALITIES) as string] : [],
        deprioritizedModalities: prng.boolean(0.2) ? [prng.choice(MODALITIES) as string] : [],
        avoidedModalities: prng.boolean(0.2) ? [prng.choice(MODALITIES) as string] : [],
        explanationVerbosity: 'detailed',
        conservativeBias: prng.boolean(0.3),
        preferredUnits: { distance: 'km', weight: 'kg', temperature: 'celsius' },
        schemaVersion: 1,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
    };

    return {
        goals: {
            shortTerm: 'Build resilience',
            midTerm: 'Peak performance',
            longTerm: 'Athletic longevity',
        },
        constraints: {
            hasCableMachine: cableMachine,
            hasFreeWeights: freeWeights,
            hasTreadmill: treadmill,
            hasIndoorBike: indoorBike,
            maxTimeMinutes: prng.choice([0, 15, 30, 45, 60, 90, 120]),
            restrictedModalities: injuries.flatMap(i => i.restrictedModalities ?? []),
        },
        preferences: {
            avoidedModalities: userPreferences.avoidedModalities,
            deprioritizedModalities: userPreferences.deprioritizedModalities,
            preferredModalities: userPreferences.preferredModalities,
            conservativeBias: userPreferences.conservativeBias,
            preferredRecoveryStyle: userPreferences.preferredRecoveryStyle,
        },
        trainingSettings,
        ...overrides,
    };
}

export function generateAdversarialEvent(
    prng: PseudoRandom,
    date: string,
    priority: 'A' | 'B' | 'C' = 'A',
): UserEvent {
    const category = prng.choice(['cycling_event', 'running_race', 'triathlon'] as const);
    const subType = category === 'cycling_event'
        ? prng.choice(['road_race', 'criterium', 'gran_fondo', 'time_trial'] as const)
        : category === 'running_race'
            ? prng.choice(['5k', '10k', 'half_marathon', 'marathon'] as const)
            : prng.choice(['sprint', 'olympic', 'half_iron'] as const);

    return {
        id: `adversarial-event-${prng.int(100, 999)}`,
        title: `Championship ${category} (${subType})`,
        date,
        priority,
        lifecycle: 'scheduled',
        category,
        demandProfile: resolveDemandProfile(category, subType),
    };
}

export function generateAdversarialSessionDefinition(
    prng: PseudoRandom,
    overrides: Partial<SessionDefinition> = {},
): SessionDefinition {
    return {
        schemaVersion: 1,
        id: `session-adv-${prng.int(1000, 9999)}`,
        revision: 1,
        title: 'Adversarial Authored Workout',
        summary: 'High-intensity authored stress workout',
        dominantModality: prng.choice(['Strength', 'Running', 'Cycling', 'Field', 'Mobility']),
        intent: prng.choice(['training', 'testing', 'competition', 'rehab_return', 'recovery', 'skill_technical'] as const),
        duration: {
            min: prng.int(20, 60),
            max: prng.int(60, 120),
        },
        blocks: [
            {
                id: 'block-1',
                title: 'Main Set',
                role: 'main',
                executionMode: 'sequential',
                steps: [
                    {
                        id: 'step-1',
                        kind: 'exercise',
                        title: 'Main effort',
                        dose: {
                            kind: 'repetition',
                            sets: prng.int(3, 8),
                            reps: prng.int(5, 15),
                        },
                    },
                ],
            },
        ],
        ...overrides,
    };
}

export function generateAdversarialCheckin(
    prng: PseudoRandom,
    date: string,
    overrides: Partial<DailySubjectiveCheckin> = {},
): DailySubjectiveCheckin {
    const isComplete = prng.boolean(0.85);
    return {
        userId: 'adversarial-user',
        date,
        readiness: prng.int(1, 10),
        sleepQuality: prng.int(1, 10),
        fatigue: prng.int(1, 10),
        soreness: prng.int(1, 10),
        mentalStress: prng.int(1, 10),
        motivation: prng.int(1, 10),
        painOrInjury: isComplete ? prng.boolean(0.2) : false,
        illnessSymptoms: isComplete ? prng.boolean(0.15) : false,
        unusuallyLimitedTime: prng.boolean(0.1),
        alreadyTrainedToday: isComplete ? prng.boolean(0.1) : false,
        availability: {
            timeAvailableMin: prng.choice([30, 45, 60, 90]),
            preferredModalityToday: null,
            indoorOnly: false,
        },
        notes: null,
        submittedAt: `${date}T07:00:00Z`,
        dataQuality: {
            isComplete,
            missingFields: isComplete ? [] : ['painOrInjury'],
        },
        healthContext: {
            symptoms: {
                present: prng.boolean(0.1),
                severity: 'mild',
            },
            closeSickContact: prng.boolean(0.1),
            alcoholDrinksLast24h: prng.choice([0, 1, 2, 3] as const),
            travelDisruption: prng.choice(['none', 'local_or_no_timezone', 'timezone_shift']),
            unusualHeatOrSauna: prng.boolean(0.1),
            dehydrationOrFluidLoss: prng.boolean(0.1),
            recentVaccination: prng.boolean(0.05),
            medicationChange: prng.boolean(0.05),
        },
        schemaVersion: 1,
        createdAt: `${date}T07:00:00Z`,
        updatedAt: `${date}T07:00:00Z`,
        ...overrides,
    };
}
