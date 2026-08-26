import type {
    AthleteDeclaredRegret,
    CounterfactualRegret,
    RecoveryTrajectory,
} from './feedbackModels';

export interface RegretEvaluationInput {
    date: string;
    action: string;
    prescribedMode: string;
    athleteDeclaredRegret: AthleteDeclaredRegret | null;
    recoveryTrajectory: RecoveryTrajectory | null;
    sorenessBaseline?: number | null;
    initialSoreness?: number | null;
}

export function evaluateCounterfactualRegret(input: RegretEvaluationInput): CounterfactualRegret {
    const {
        date,
        action,
        prescribedMode,
        athleteDeclaredRegret,
        recoveryTrajectory,
        initialSoreness,
    } = input;

    if (!recoveryTrajectory) {
        return {
            date,
            regretClass: 'inconclusive',
            athleteDeclaredRegret,
            confidence: 'low',
            rationales: ['Missing post-session recovery trajectory telemetry.'],
            counterfactualAlternative: null,
        };
    }

    const { hours24, hours48, autonomicReboundState } = recoveryTrajectory;
    const rationales: string[] = [];

    // Check for Injury Exacerbation
    const severeSoreness = (hours24.sorenessScore ?? 0) >= 4 || (hours48.sorenessScore ?? 0) >= 4;
    const initialPainReported = (initialSoreness ?? 0) >= 3;
    if (action !== 'rejected_rest' && initialPainReported && severeSoreness) {
        rationales.push('Training through elevated initial soreness exacerbated tissue irritation at 24-48h.');
        return {
            date,
            regretClass: 'injury_exacerbation',
            athleteDeclaredRegret,
            confidence: 'high',
            rationales,
            counterfactualAlternative: 'Substituting non-impact active recovery or complete rest would have avoided tissue irritation.',
        };
    }

    // Check for Overreaching Crash
    const suppressedRecovery = autonomicReboundState === 'suppressed'
        || ((hours48.hrvDeltaPct ?? 0) < -15 && (hours48.rhrDeltaBpm ?? 0) > 3);
    const trainedHard = action === 'accepted' || action === 'scaled_up' || action === 'rejected_train_harder';

    if (trainedHard && suppressedRecovery) {
        rationales.push('Heavy stimulus was followed by persistent 48h+ autonomic suppression.');
        if (prescribedMode === 'scale' || prescribedMode === 'rest') {
            rationales.push(`Engine prescribed ${prescribedMode}, but high load was executed.`);
        }
        return {
            date,
            regretClass: 'overreaching_crash',
            athleteDeclaredRegret,
            confidence: 'high',
            rationales,
            counterfactualAlternative: 'Scaling intensity or volume would have preserved 72h adaptive capacity.',
        };
    }

    // Check for Unnecessary Forfeiture
    const freshState = (hours24.hrvDeltaPct ?? 0) >= 0 && (hours24.rhrDeltaBpm ?? 0) <= 0 && (hours24.sorenessScore ?? 1) <= 2;

    if (action === 'rejected_rest' && freshState) {
        rationales.push('Unscheduled rest taken despite fresh autonomic and musculoskeletal state.');
        return {
            date,
            regretClass: 'unnecessary_forfeiture',
            athleteDeclaredRegret,
            confidence: 'medium',
            rationales,
            counterfactualAlternative: 'Executing the planned workout would have fulfilled weekly role coverage without recovery penalty.',
        };
    }

    // Optimal Choice
    rationales.push('Session decision aligned with subsequent recovery trajectory.');
    return {
        date,
        regretClass: 'optimal_choice',
        athleteDeclaredRegret,
        confidence: 'high',
        rationales,
        counterfactualAlternative: null,
    };
}
