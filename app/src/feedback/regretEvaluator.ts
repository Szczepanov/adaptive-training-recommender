import type {
    AthleteDecisionAction,
    AthleteDeclaredRegret,
    CounterfactualRegret,
    RecoveryTrajectory,
} from './feedbackModels';

export type PrescribedMode = 'proceed' | 'scale' | 'defer' | 'rest';

export interface RegretEvaluationInput {
    date: string;
    action: AthleteDecisionAction;
    prescribedMode: PrescribedMode;
    /** Confirmed from completed-training evidence; never inferred from the decision action. */
    completedTraining: boolean;
    athleteDeclaredRegret: AthleteDeclaredRegret | null;
    recoveryTrajectory: RecoveryTrajectory | null;
    initialSoreness?: number | null;
}

function hasCompleteFreshnessEvidence(point: RecoveryTrajectory['hours24']): boolean {
    return point.hrvDeltaPct !== null
        && point.rhrDeltaBpm !== null
        && point.sorenessScore !== null
        && point.readinessScore !== null
        && point.hrvDeltaPct >= 0
        && point.rhrDeltaBpm <= 0
        && point.sorenessScore <= 2
        && point.readinessScore >= 70;
}

function hasCompleteOutcomeEvidence(point: RecoveryTrajectory['hours24']): boolean {
    return point.hrvDeltaPct !== null
        && point.rhrDeltaBpm !== null
        && point.sorenessScore !== null
        && point.readinessScore !== null;
}

/** Classifies observational regret conservatively without asserting a causal counterfactual. */
export function evaluateCounterfactualRegret(input: RegretEvaluationInput): CounterfactualRegret {
    const {
        date,
        action,
        prescribedMode,
        completedTraining,
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

    if (autonomicReboundState === 'insufficient_data') {
        return {
            date,
            regretClass: 'inconclusive',
            athleteDeclaredRegret,
            confidence: 'low',
            rationales: ['Recovery trajectory is explicitly marked insufficient for outcome classification.'],
            counterfactualAlternative: null,
        };
    }

    // Safety signal: require worsening relative to the pre-session state rather than
    // inferring "injury exacerbation" from a high absolute soreness score alone.
    const peakPostSoreness = Math.max(hours24.sorenessScore ?? 0, hours48.sorenessScore ?? 0);
    const tissueSymptomsWorsened = initialSoreness !== null
        && initialSoreness !== undefined
        && initialSoreness >= 2
        && peakPostSoreness >= 4
        && peakPostSoreness >= initialSoreness + 2;

    if (completedTraining && tissueSymptomsWorsened) {
        return {
            date,
            regretClass: 'injury_exacerbation',
            athleteDeclaredRegret,
            confidence: athleteDeclaredRegret === 'should_have_rested' ? 'high' : 'medium',
            rationales: [
                'Marked tissue-symptom worsening followed training from an already symptomatic baseline.',
                'This is an observational safety flag; it does not establish a clinical injury diagnosis or causal effect.',
            ],
            counterfactualAlternative: 'A lower-load or non-impact alternative is the candidate counterfactual for prospective comparison; its outcome cannot be inferred from this observation alone.',
        };
    }

    if (!completedTraining && tissueSymptomsWorsened) {
        return {
            date,
            regretClass: 'inconclusive',
            athleteDeclaredRegret,
            confidence: 'low',
            rationales: [
                'Tissue symptoms worsened, but no completed training was confirmed for this decision.',
                'Natural symptom progression cannot be attributed to the recommendation or an executed dose.',
            ],
            counterfactualAlternative: null,
        };
    }

    const corroboratedSuppression = autonomicReboundState === 'suppressed'
        && (
            ((hours48.hrvDeltaPct ?? 0) < -15 && (hours48.rhrDeltaBpm ?? 0) > 3)
            || (hours48.readinessScore ?? 100) <= 50
        );
    const exceededRecommendation = action === 'scaled_up' || action === 'rejected_train_harder';
    const conservativePrescription = prescribedMode === 'scale' || prescribedMode === 'rest';

    if (completedTraining && exceededRecommendation && corroboratedSuppression) {
        return {
            date,
            regretClass: 'overreaching_crash',
            athleteDeclaredRegret,
            confidence: conservativePrescription && athleteDeclaredRegret === 'should_have_rested' ? 'high' : 'medium',
            rationales: [
                'A higher-than-recommended training decision was followed by corroborated 48h recovery suppression.',
                'The temporal association supports a regret flag but does not prove that a lower dose would have prevented suppression.',
            ],
            counterfactualAlternative: 'A lower-dose or rest alternative is the candidate comparison for future prospective calibration; the unobserved outcome is not asserted as fact.',
        };
    }

    if (corroboratedSuppression) {
        return {
            date,
            regretClass: 'inconclusive',
            athleteDeclaredRegret,
            confidence: 'low',
            rationales: [
                'Corroborated 48h recovery suppression followed the session, but the athlete did not exceed the recommendation.',
                'The observation cannot distinguish normal training stress from a recommendation-quality error.',
            ],
            counterfactualAlternative: null,
        };
    }

    // Rest creates the fresh state observed afterward, so freshness alone cannot prove
    // that the skipped workout was unnecessary. Require the athlete's own regret plus
    // sustained freshness before labeling a possible forfeiture.
    const sustainedFreshness = hasCompleteFreshnessEvidence(hours24)
        && hasCompleteFreshnessEvidence(hours48);
    if (action === 'rejected_rest'
        && prescribedMode === 'proceed'
        && athleteDeclaredRegret === 'should_have_trained_harder'
        && sustainedFreshness) {
        return {
            date,
            regretClass: 'unnecessary_forfeiture',
            athleteDeclaredRegret,
            confidence: 'medium',
            rationales: [
                'The athlete skipped a proceed recommendation, remained fresh through 48h, and later reported that training harder would have been preferable.',
                'This supports a possible forfeiture but does not prove the skipped workout would have had zero recovery cost.',
            ],
            counterfactualAlternative: 'Executing the planned workout is the candidate comparison for future matched/prospective evaluation.',
        };
    }

    if (action === 'rejected_rest') {
        return {
            date,
            regretClass: 'inconclusive',
            athleteDeclaredRegret,
            confidence: 'low',
            rationales: ['Post-rest freshness cannot establish that the skipped workout was unnecessary without corroborating regret and prospective comparison.'],
            counterfactualAlternative: null,
        };
    }

    if (!hasCompleteOutcomeEvidence(hours24) && !hasCompleteOutcomeEvidence(hours48)) {
        return {
            date,
            regretClass: 'inconclusive',
            athleteDeclaredRegret,
            confidence: 'low',
            rationales: ['Recovery trajectory lacks a complete 24h or 48h outcome observation.'],
            counterfactualAlternative: null,
        };
    }

    if (athleteDeclaredRegret === 'should_have_rested' || athleteDeclaredRegret === 'should_have_trained_harder') {
        return {
            date,
            regretClass: 'inconclusive',
            athleteDeclaredRegret,
            confidence: 'low',
            rationales: ['Athlete-declared regret is present, but the prespecified recovery evidence is insufficient to support a stronger algorithmic class.'],
            counterfactualAlternative: null,
        };
    }

    return {
        date,
        regretClass: 'optimal_choice',
        athleteDeclaredRegret,
        confidence: athleteDeclaredRegret === 'none' ? 'medium' : 'low',
        rationales: [
            'No prespecified adverse recovery pattern or athlete-declared regret was observed.',
            'This supports decision adequacy but does not prove counterfactual optimality.',
        ],
        counterfactualAlternative: null,
    };
}
