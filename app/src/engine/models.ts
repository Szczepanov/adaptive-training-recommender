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

export interface ObjectiveInput {
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

export interface DailyReadiness {
    subjective: SubjectiveInput;
    objective: ObjectiveInput;
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
