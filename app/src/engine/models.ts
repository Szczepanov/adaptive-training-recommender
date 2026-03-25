// --- Engine Input Models ---
export interface SubjectiveInput {
    readiness: number; // 1-10
    sleepQuality: number; // 1-10
    fatigue: number; // 1-10
    soreness: number; // 1-10
    stress: number; // 1-10
    motivation: number; // 1-10
    timeAvailable: number; // Minutes
    painFlag: boolean;     // Injury/Pain flag
}

export interface EngineObjectiveInput {
    total_steps: number | null;
    sleep_score: number | null;
    sleep_duration_min: number | null;
    rhr: number | null;
    rhr_7d_avg: number | null;
    rhr_delta: number | null;
    hrv_weekly_avg: number | null;
    hrv_last_night: number | null;
    hrv_delta: number | null;
    respiration: number | null;
    body_battery_wake: number | null;
    last_3_days_hard_sessions_count: number;
    yesterday_training: {
        type: string;
        duration_min: number;
        training_effect: number;
        intensity_tag: string;
    } | null;
}

export interface DailyReadiness {
    subjective: SubjectiveInput;
    objective: EngineObjectiveInput;
}

export interface UserContext {
    goals: {
        shortTerm: string;
        midTerm: string;
        longTerm: string;
    };
    constraints: {
        hasCableMachine: boolean;
        hasFreeWeights: boolean;
        hasTreadmill: boolean;
        hasIndoorBike: boolean;
        injuries: string[];
        maxTimeMinutes: number;
    }
}

export interface SessionTemplate {
    id: string;
    category: 'Hard Endurance' | 'Moderate Endurance' | 'Easy Endurance' | 'Upper-body Strength' | 'Lower-body Strength' | 'Full-body Strength' | 'Mobility/Recovery' | 'Rest';
    modality: 'Running' | 'Cycling' | 'Strength' | 'Mobility' | 'None';
    durationMin: number;
    durationMax: number;
    title: string;
    description: string;
    requiredEquipment: ('free_weights' | 'cable_machine' | 'treadmill' | 'indoor_bike')[];
}

export interface Recommendation {
    template: SessionTemplate;
    rationale: string;
}

// --- Firestore Canonical Models (Phase 3) ---

export interface DailyRecoverySnapshot {
    userId: string;
    date: string;
    source: {
        garminSyncedAt: string;
        sourceSchemaVersion: number;
    };
    raw: {
        sleepScore: number | null;
        sleepDurationSec: number | null;
        restingHr: number | null;
        hrvOvernightAvg: number | null;
        hrvStatus: string | null;
        respirationAvg: number | null;
        bodyBatteryWake: number | null;
        bodyBatteryChange: number | null;
        totalSteps: number | null;
        last3DaysHardSessionsCount: number;
        yesterdayTraining: {
            type: string;
            durationMin: number;
            trainingEffect: number;
            intensityTag: string;
        } | null;
    };
    derived: {
        baselineComputationVersion: number;
        sleepScore7dAvg: number | null;
        sleepScore28dAvg: number | null;
        restingHr7dAvg: number | null;
        restingHr28dAvg: number | null;
        hrv7dAvg: number | null;
        hrv28dAvg: number | null;
        respiration7dAvg: number | null;
        respiration28dAvg: number | null;
        deltas: {
            sleepScoreVs7d: number | null;
            sleepScoreVs28d: number | null;
            restingHrVs7d: number | null;
            restingHrVs28d: number | null;
            hrvVs7d: number | null;
            hrvVs28d: number | null;
            respirationVs7d: number | null;
            respirationVs28d: number | null;
        };
    };
    dataQuality: {
        sleepScoreAvailable: boolean;
        restingHrAvailable: boolean;
        hrvAvailable: boolean;
        baseline7dReady: boolean;
        baseline28dReady: boolean;
    };
    createdAt?: string;
    updatedAt?: string;
}

// --- Firestore Canonical Models (Phase 4) ---

export interface DailySubjectiveCheckin {
    userId: string;
    date: string; // YYYY-MM-DD
    // Readiness dimensions (1-10 scale)
    readiness: number | null;
    sleepQuality: number | null;
    fatigue: number | null;
    soreness: number | null;
    mentalStress: number | null;
    motivation: number | null;
    // Boolean flags
    painOrInjury: boolean;
    illnessSymptoms: boolean;
    unusuallyLimitedTime: boolean;
    // Availability block
    availability: {
        timeAvailableMin: number | null;
        preferredModalityToday: string | null; // e.g., 'Running', 'Cycling', 'Strength', 'Mobility', 'Any'
        indoorOnly: boolean;
    };
    // Optional free text
    notes: string | null;
    submittedAt: string;
    // Data quality metadata
    dataQuality: {
        isComplete: boolean;
        missingFields: string[];
    };
    schemaVersion: number;
    createdAt: string;
    updatedAt: string;
}

export interface UserGoal {
    userId: string;
    category: 'short-term' | 'mid-term' | 'long-term';
    domain: 'endurance' | 'strength' | 'mobility' | 'weight_loss' | 'general_fitness' | 'other';
    title: string;
    description?: string | null;
    priority: number; // 1-5, 5 = highest
    status: 'active' | 'paused' | 'completed' | 'archived';
    // Optional target tracking
    targetMetric?: string | null; // e.g., '5k_time', 'bench_press_weight', 'weekly_sessions'
    targetValue?: number | null;
    targetUnit?: string | null; // e.g., 'minutes', 'kg', 'sessions'
    // Optional dates
    targetDate?: string | null; // YYYY-MM-DD
    schemaVersion: number;
    createdAt: string;
    updatedAt: string;
}

export interface UserConstraint {
    userId: string;
    key: string; // Stable identifier for predefined constraints, generated for custom
    label: string;
    valueType: 'boolean' | 'number' | 'string' | 'string_array';
    type: 'boolean' | 'number' | 'string' | 'string_array';
    value: boolean | number | string | string[];
    severity: 'hard' | 'soft'; // Hard = must not violate, Soft = try to avoid
    isActive: boolean;
    category: 'equipment' | 'physical_caution' | 'schedule' | 'environment' | 'custom';
    displayName: string; // Human-readable name
    description?: string | null; // Optional explanation
    schemaVersion: number;
    createdAt: string;
    updatedAt: string;
}

export interface UserPreferences {
    userId: string;
    // Recovery preferences
    preferredRecoveryStyle: 'passive' | 'active' | 'mixed';
    // Time preferences
    defaultWeekdayTimeMin: number; // Default session duration on weekdays
    defaultWeekendTimeMin: number; // Default session duration on weekends
    preferredTimeOfDay: 'morning' | 'midday' | 'evening' | 'flexible';
    // Modality preferences
    preferredModalities: string[]; // e.g., ['Running', 'Cycling', 'Strength']
    deprioritizedModalities: string[]; // Canonical Phase 4 name
    avoidedModalities: string[]; // e.g., ['Running']
    // UI/Explanation preferences
    explanationStyle: 'brief' | 'detailed' | 'technical';
    explanationVerbosity: 'brief' | 'detailed' | 'technical';
    conservativeBias: boolean;
    // Metric preferences
    preferredUnits: {
        distance: 'km' | 'miles';
        weight: 'kg' | 'lbs';
        temperature: 'celsius' | 'fahrenheit';
    };
    schemaVersion: number;
    createdAt: string;
    updatedAt: string;
}

// --- Engine Layer Models (Not stored in Firestore) ---

export interface DailyDecisionInput {
    userId: string;
    date: string;
    // Data sources
    recoverySnapshot: DailyRecoverySnapshot | null;
    subjectiveCheckin: DailySubjectiveCheckin | null;
    activeGoals: UserGoal[]; // Only goals with status === 'active'
    activeConstraints: UserConstraint[]; // Only constraints where isActive === true
    preferences: UserPreferences | null;
    // Data quality flags
    dataQuality: {
        hasRecoverySnapshot: boolean;
        hasSubjectiveCheckin: boolean;
        profileReady: boolean; // True if preferences exist
    };
}

export interface DailyRecommendation {
    userId: string;
    date: string;
    templateId: string;
    rationale: string;
    createdAt: string;
}

// --- Type Utilities ---

export type GoalCategory = UserGoal['category'];
export type GoalDomain = UserGoal['domain'];
export type GoalStatus = UserGoal['status'];
export type ConstraintType = UserConstraint['type'];
export type ConstraintSeverity = UserConstraint['severity'];
export type ConstraintCategory = UserConstraint['category'];
export type RecoveryStyle = UserPreferences['preferredRecoveryStyle'];
export type TimeOfDay = UserPreferences['preferredTimeOfDay'];
export type ExplanationVerbosity = UserPreferences['explanationVerbosity'];
