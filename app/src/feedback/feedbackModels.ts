export type AthleteDecisionAction =
    | 'accepted'
    | 'scaled_down'
    | 'scaled_up'
    | 'substituted'
    | 'rejected_rest'
    | 'rejected_train_harder';

export type ModificationReason =
    | 'time_constraint'
    | 'feeling_fatigued'
    | 'feeling_strong'
    | 'muscle_joint_pain'
    | 'illness_symptoms'
    | 'weather_equipment'
    | 'social_group_ride'
    | 'other';

export interface AthleteDecisionLog {
    date: string;
    recommendationRef: {
        recommendationId: string;
        revision: number;
    };
    action: AthleteDecisionAction;
    reasons: readonly ModificationReason[];
    note: string | null;
    decidedAt: string;
}

export interface ZoneDistributionSeconds {
    z1Seconds: number;
    z2Seconds: number;
    z3Seconds: number;
    z4Seconds: number;
    z5Seconds: number;
}

export interface DoseReconciliation {
    date: string;
    plannedDurationMin: number;
    actualDurationMin: number;
    plannedWorkKj: number | null;
    actualWorkKj: number | null;
    /** Rounded percent change from planned duration; 0 for 0-to-0 and null for 0-to-positive. */
    durationDeltaPct: number | null;
    /** Rounded percent change from planned work; null when unavailable or zero planned work becomes positive. */
    workDeltaPct: number | null;
    completedZoneDistribution: ZoneDistributionSeconds | null;
    holdCompliancePct: number | null;
    stepOmissionsCount: number;
}

export interface RecoveryTrajectoryPoint {
    hrvDeltaPct: number | null;
    rhrDeltaBpm: number | null;
    sorenessScore: number | null;
    readinessScore: number | null;
}

export type AutonomicReboundState =
    | 'accelerated'
    | 'expected'
    | 'suppressed'
    | 'insufficient_data';

export interface RecoveryTrajectory {
    date: string;
    hours24: RecoveryTrajectoryPoint;
    hours48: RecoveryTrajectoryPoint;
    hours72: RecoveryTrajectoryPoint;
    autonomicReboundState: AutonomicReboundState;
}

export type CounterfactualRegretClass =
    | 'optimal_choice'
    | 'overreaching_crash'
    | 'unnecessary_forfeiture'
    | 'injury_exacerbation'
    | 'inconclusive';

export type AthleteDeclaredRegret =
    | 'none'
    | 'should_have_rested'
    | 'should_have_trained_harder';

export interface CounterfactualRegret {
    date: string;
    regretClass: CounterfactualRegretClass;
    athleteDeclaredRegret: AthleteDeclaredRegret | null;
    confidence: 'low' | 'medium' | 'high';
    rationales: readonly string[];
    counterfactualAlternative: string | null;
}

export type CoachingHelpfulness =
    | 'very_helpful'
    | 'helpful'
    | 'neutral'
    | 'unhelpful'
    | 'counterproductive';

export interface SubjectiveUtility {
    utilityScore: number;
    clarityScore: number;
    coachingHelpfulness: CoachingHelpfulness;
    feedbackNote: string | null;
}

export interface ClosedLoopFeedbackRecord {
    date: string;
    recommendationRef: {
        recommendationId: string;
        revision: number;
    };
    decision: AthleteDecisionLog;
    doseReconciliation: DoseReconciliation;
    recoveryTrajectory: RecoveryTrajectory | null;
    regret: CounterfactualRegret | null;
    utility: SubjectiveUtility | null;
    createdAt: string;
    updatedAt: string;
}
