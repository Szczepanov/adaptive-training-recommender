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

// Define-only stubs for Phase 3
export interface DailySubjectiveCheckin extends SubjectiveInput {
    userId: string;
    date: string; // YYYY-MM-DD
    createdAt: string;
}

export interface UserGoal {
    userId: string;
    shortTerm: string;
    midTerm: string;
    longTerm: string;
}

export interface UserConstraint {
    userId: string;
    hasCableMachine: boolean;
    hasFreeWeights: boolean;
    hasTreadmill: boolean;
    hasIndoorBike: boolean;
    injuries: string[];
    maxTimeMinutes: number;
}

export interface DailyRecommendation {
    userId: string;
    date: string;
    templateId: string;
    rationale: string;
    createdAt: string;
}
