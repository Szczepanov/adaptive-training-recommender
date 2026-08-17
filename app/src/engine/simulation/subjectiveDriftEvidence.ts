import type { DailyReadiness, UserContext } from '../models';
import type { SubjectiveDriftAuditSource } from '../subjectiveDriftAudit';
import {
    REFERENCE_SUBJECTIVE_DRIFT_WEIGHTS,
    evaluateReadinessAndSafetyEnvelope,
    subjectiveDriftStrain,
    type SubjectiveDriftWeights,
} from '../rules';
import { SUBJECTIVE_BASELINE_METRICS, type SubjectiveBaselineMetric } from '../subjectiveBaseline';

export interface SubjectiveDriftDecisionEvidence extends SubjectiveDriftAuditSource {
    modeWithoutDrift: 'train' | 'modify' | 'recover';
    modeWithDrift: 'train' | 'modify' | 'recover';
    totalDecisionScoreWithDrift: number;
}

function zeroWeights(): SubjectiveDriftWeights {
    return { readiness: 0, sleepQuality: 0, fatigue: 0, soreness: 0, mentalStress: 0, motivation: 0 };
}

/** Simulation-only counterfactual measurement. Explicit drift execution belongs here,
 * not in production modules, until Phase 9.8 authorizes a live cutover. */
export function buildSubjectiveDriftDecisionEvidence(
    readiness: DailyReadiness,
    context: UserContext,
    date?: string,
    previousMode?: 'train' | 'modify' | 'recover',
    weights: SubjectiveDriftWeights = REFERENCE_SUBJECTIVE_DRIFT_WEIGHTS,
): SubjectiveDriftDecisionEvidence | null {
    const baseline = readiness.subjectiveBaseline;
    if (!baseline) return null;
    const off = evaluateReadinessAndSafetyEnvelope(readiness, context, date, previousMode, 'off', weights);
    const drift = evaluateReadinessAndSafetyEnvelope(readiness, context, date, previousMode, 'drift', weights);
    const contribution = subjectiveDriftStrain(baseline, 'drift', weights);
    const perMetricContributions = {} as Record<SubjectiveBaselineMetric, number>;
    for (const metric of SUBJECTIVE_BASELINE_METRICS) {
        const oneHot = zeroWeights();
        oneHot[metric] = weights[metric];
        perMetricContributions[metric] = subjectiveDriftStrain(baseline, 'drift', oneHot);
    }
    const summed = SUBJECTIVE_BASELINE_METRICS.reduce((total, metric) => total + perMetricContributions[metric], 0);
    if (Math.abs(summed - contribution) > 1e-9) {
        throw new Error(`Subjective drift evidence does not reconcile: components=${summed}, total=${contribution}`);
    }
    return {
        estimatorId: baseline.estimatorId,
        historyThroughDateExclusive: baseline.historyThroughDateExclusive,
        recentRecordedDays: baseline.recentRecordedDays,
        longRecordedDays: baseline.longRecordedDays,
        contribution,
        perMetricContributions,
        decisionRelevant: off.mode !== drift.mode,
        modeWithoutDrift: off.mode,
        modeWithDrift: drift.mode,
        totalDecisionScoreWithDrift: drift.telemetry.totalDecisionScore + contribution,
    };
}
