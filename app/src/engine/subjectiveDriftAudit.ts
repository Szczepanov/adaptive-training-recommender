import { SUBJECTIVE_BASELINE_METRICS, type SubjectiveBaselineMetric } from './subjectiveBaseline';

export interface SubjectiveDriftAudit {
    estimatorId: string;
    /** Phase 9.7/D-SUBJAUDIT: identifies the drift-scoring policy (weights + cap-source
     *  convention), independent of `estimatorId` (the baseline estimator's own
     *  windows/floor/coverage). See `rules.ts`'s `SUBJECTIVE_DRIFT_ESTIMATOR_POLICY_VERSION`. */
    estimatorPolicyVersion: string;
    historyThroughDateExclusive: string;
    recentRecordedDays: number;
    longRecordedDays: number;
    contribution: number;
    perMetricContributions: Record<SubjectiveBaselineMetric, number>;
    decisionRelevant: boolean;
}

export type SubjectiveDriftAuditSource = SubjectiveDriftAudit & Record<string, unknown>;

export function compactSubjectiveDriftAudit(evidence: SubjectiveDriftAuditSource | null): SubjectiveDriftAudit | null {
    if (!evidence) return null;
    return {
        estimatorId: evidence.estimatorId,
        estimatorPolicyVersion: evidence.estimatorPolicyVersion,
        historyThroughDateExclusive: evidence.historyThroughDateExclusive,
        recentRecordedDays: evidence.recentRecordedDays,
        longRecordedDays: evidence.longRecordedDays,
        contribution: evidence.contribution,
        perMetricContributions: evidence.perMetricContributions,
        decisionRelevant: evidence.decisionRelevant,
    };
}

export function subjectiveDriftAuditReplayErrors(audit: unknown, decisionDate: string): string[] {
    if (audit === undefined || audit === null) return [];
    if (typeof audit !== 'object' || Array.isArray(audit)) return ['Subjective drift audit is not an object.'];

    const errors: string[] = [];
    const record = audit as Record<string, unknown>;
    if (typeof record.estimatorId !== 'string' || record.estimatorId.trim() === '') {
        errors.push('Subjective drift audit estimatorId is invalid.');
    }
    if (typeof record.estimatorPolicyVersion !== 'string' || record.estimatorPolicyVersion.trim() === '') {
        errors.push('Subjective drift audit estimatorPolicyVersion is invalid.');
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
