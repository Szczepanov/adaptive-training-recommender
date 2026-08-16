import type { DailyReadiness, UserContext } from './models';
import {
    REFERENCE_SUBJECTIVE_DRIFT_WEIGHTS,
    evaluateReadinessAndSafetyEnvelope,
    subjectiveDriftStrain,
    type SubjectiveDriftWeights,
} from './rules';
import { SUBJECTIVE_BASELINE_METRICS, type SubjectiveBaselineMetric } from './subjectiveBaseline';

export interface SubjectiveDriftDecisionEvidence {
    estimatorId: string;
    historyThroughDateExclusive: string;
    recentRecordedDays: number;
    longRecordedDays: number;
    contribution: number;
    perMetricContributions: Record<SubjectiveBaselineMetric, number>;
    modeWithoutDrift: 'train' | 'modify' | 'recover';
    modeWithDrift: 'train' | 'modify' | 'recover';
    decisionRelevant: boolean;
    /** Reconciled threshold score for the experimental drift path. The legacy evaluator's
     * `telemetry.totalDecisionScore` is objective-only until a live-cutover telemetry change
     * is approved; this field makes the measurement path explicit rather than silently
     * pretending that legacy field already contains drift. */
    totalDecisionScoreWithDrift: number;
}

export type SubjectiveDriftAudit = Omit<
    SubjectiveDriftDecisionEvidence,
    'modeWithoutDrift' | 'modeWithDrift' | 'totalDecisionScoreWithDrift'
>;

function zeroWeights(): SubjectiveDriftWeights {
    return {
        readiness: 0,
        sleepQuality: 0,
        fatigue: 0,
        soreness: 0,
        mentalStress: 0,
        motivation: 0,
    };
}

/**
 * Phase 9.7 measurement evidence for a single readiness decision.
 *
 * This helper intentionally delegates every contribution calculation to the canonical
 * `subjectiveDriftStrain` implementation from Phase 9.3. Per-metric values are obtained by
 * re-running that function with one-hot weights, so the evidence path cannot drift into a
 * second copy of the estimator formula. Counterfactual relevance is likewise measured by
 * running the real pure readiness evaluator under `'off'` and `'drift'` with the same
 * readiness/context inputs.
 *
 * Missing baseline means there is no relative-signal provenance to record, so `null` is
 * returned rather than a fabricated all-zero audit record (D-SUBJCOV/D-SUBJAUDIT).
 */
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
        modeWithoutDrift: off.mode,
        modeWithDrift: drift.mode,
        decisionRelevant: off.mode !== drift.mode,
        totalDecisionScoreWithDrift: drift.telemetry.totalDecisionScore + contribution,
    };
}

export function compactSubjectiveDriftAudit(
    evidence: SubjectiveDriftDecisionEvidence | null,
): SubjectiveDriftAudit | null {
    if (!evidence) return null;
    return {
        estimatorId: evidence.estimatorId,
        historyThroughDateExclusive: evidence.historyThroughDateExclusive,
        recentRecordedDays: evidence.recentRecordedDays,
        longRecordedDays: evidence.longRecordedDays,
        contribution: evidence.contribution,
        perMetricContributions: evidence.perMetricContributions,
        decisionRelevant: evidence.decisionRelevant,
    };
}

/**
 * Replay-side structural verification for normalized drift provenance. This deliberately
 * does not try to reconstruct the estimator from raw scores (those are intentionally not
 * part of the audit). It verifies the invariants that *are* reproducible from compact
 * evidence: correct exclusive decision date, complete canonical metric set, finite
 * non-negative contributions, component/total reconciliation, and sensible coverage.
 */
export function subjectiveDriftAuditReplayErrors(
    audit: unknown,
    decisionDate: string,
): string[] {
    if (audit === undefined || audit === null) return [];
    const errors: string[] = [];
    if (typeof audit !== 'object' || Array.isArray(audit)) {
        return ['Subjective drift audit is not an object.'];
    }
    const record = audit as Record<string, unknown>;
    if (typeof record.estimatorId !== 'string' || record.estimatorId.trim() === '') {
        errors.push('Subjective drift audit estimatorId is invalid.');
    }
    if (record.historyThroughDateExclusive !== decisionDate) {
        errors.push(`Subjective drift audit history boundary ${String(record.historyThroughDateExclusive)} does not equal decision date ${decisionDate}.`);
    }
    const recent = record.recentRecordedDays;
    const long = record.longRecordedDays;
    if (!Number.isInteger(recent) || (recent as number) < 0) errors.push('Subjective drift recent coverage is invalid.');
    if (!Number.isInteger(long) || (long as number) < 0) errors.push('Subjective drift long coverage is invalid.');
    if (Number.isInteger(recent) && Number.isInteger(long) && (recent as number) > (long as number)) {
        errors.push('Subjective drift recent coverage exceeds long coverage.');
    }
    if (typeof record.decisionRelevant !== 'boolean') errors.push('Subjective drift decisionRelevant is invalid.');
    if (typeof record.contribution !== 'number' || !Number.isFinite(record.contribution) || record.contribution < 0) {
        errors.push('Subjective drift total contribution is invalid.');
    }

    const perMetric = record.perMetricContributions;
    if (!perMetric || typeof perMetric !== 'object' || Array.isArray(perMetric)) {
        errors.push('Subjective drift per-metric contributions are invalid.');
        return errors;
    }
    const metricRecord = perMetric as Record<string, unknown>;
    const actualKeys = Object.keys(metricRecord).sort();
    const expectedKeys = [...SUBJECTIVE_BASELINE_METRICS].sort();
    if (actualKeys.length !== expectedKeys.length || actualKeys.some((key, index) => key !== expectedKeys[index])) {
        errors.push('Subjective drift per-metric contributions do not contain exactly the canonical metric set.');
        return errors;
    }

    let sum = 0;
    for (const metric of SUBJECTIVE_BASELINE_METRICS) {
        const value = metricRecord[metric];
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
            errors.push(`Subjective drift contribution for ${metric} is invalid.`);
        } else {
            sum += value;
        }
    }
    if (typeof record.contribution === 'number' && Number.isFinite(record.contribution)
        && Math.abs(sum - record.contribution) > 1e-6) {
        errors.push(`Subjective drift component sum ${sum} does not reconcile to total ${record.contribution}.`);
    }
    return errors;
}
