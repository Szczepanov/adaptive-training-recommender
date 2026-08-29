import {
    getHrUseAuthority,
    HR_FIDELITY_AUTHORITY_POLICY_VERSION,
    type HrUseAuthority,
    type HrUseCase,
} from './activityHrFidelity';
import {
    getGarminTrainingEffectAuthority,
    getGarminTrainingLoadAuthority,
} from './activityHrFidelityAdapters';
import type {
    HrMeasurement,
    HrMeasurementConfidence,
    HrSourceForActivity,
    HrSummaryCompatibility,
    NormalizedGarminActivity,
} from './models';

/** HRF7's replay journal is an evidence view, not a recommendation input. */
export const HR_FIDELITY_SHADOW_REPLAY_VERSION = 'hrf7-shadow-v1' as const;

export type HrFidelityAssessmentState = 'NOT_ASSESSED' | 'ASSESSED';

export type HrFidelityAuthorityByUse = Record<HrUseCase, HrUseAuthority>;

export interface CurrentProductionHrUse {
    averageHrDisplay: boolean;
    hrZoneDisplay: boolean;
    /** Existing `completedTraining.ts` treats these Garmin vendor summaries as evidence. */
    garminTrainingLoadEvidence: boolean;
    garminTrainingEffectEvidence: boolean;
}

export interface ActivityHrFidelityShadowRow {
    activityId: string;
    date: string;
    activityType: string;
    assessmentState: HrFidelityAssessmentState;
    measurement: HrMeasurement | null;
    currentProductionUse: CurrentProductionHrUse;
    authorityByUse: HrFidelityAuthorityByUse;
}

export interface HrFidelityAuthorityCounts {
    candidateCount: number;
    allowed: number;
    bounded: number;
    observational: number;
    blocked: number;
}

export interface HrFidelityConfidenceByActivityType {
    activityType: string;
    total: number;
    notAssessed: number;
    assessed: number;
    confidence: Record<HrMeasurementConfidence, number>;
}

export interface ActivityHrFidelityShadowSummary {
    totalActivities: number;
    assessableCoverage: number;
    assessedActivities: number;
    notAssessedActivities: number;
    notAssessedReasons: Record<string, number>;
    unknownAssessmentCount: number;
    /** Fraction of assessed activities whose confidence remains `unknown`. */
    assessmentUnknownRate: number;
    assessmentUnknownReasons: Record<string, number>;
    sourceDistribution: Record<HrSourceForActivity | 'not_assessed', number>;
    confidenceByActivityType: HrFidelityConfidenceByActivityType[];
    artifactPrevalence: Record<string, number>;
    summaryCompatibility: Record<HrSummaryCompatibility | 'not_assessed', number>;
    /** Comparable excludes `unknown`, `not_comparable`, and not-assessed records. */
    summaryComparableCount: number;
    summaryReconciliationRate: number;
    summaryDiscordanceRate: number;
    authorityByUse: Record<HrUseCase, HrFidelityAuthorityCounts>;
    candidateBlocks: {
        hrZoneDistribution: HrFidelityAuthorityCounts;
        garminTrainingLoad: HrFidelityAuthorityCounts;
        garminTrainingEffect: HrFidelityAuthorityCounts;
        maxHrUpdate: HrFidelityAuthorityCounts;
        aerobicDecoupling: HrFidelityAuthorityCounts;
    };
    poorTraceDespiteChestStrapCount: number;
    usefulWristTraceCount: number;
    featureSpecificBlockWithDisplayAvailableCount: number;
}

export interface ActivityHrFidelityShadowReport {
    generatedFrom: 'activity-history';
    replayVersion: typeof HR_FIDELITY_SHADOW_REPLAY_VERSION;
    authorityPolicyVersion: typeof HR_FIDELITY_AUTHORITY_POLICY_VERSION;
    limitations: readonly string[];
    rows: readonly ActivityHrFidelityShadowRow[];
    summary: ActivityHrFidelityShadowSummary;
}

const ALL_USE_CASES: readonly HrUseCase[] = [
    'DISPLAY_AVERAGE',
    'DISPLAY_TRACE',
    'ZONE_DISTRIBUTION',
    'TRAINING_LOAD',
    'TRAINING_EFFECT',
    'AEROBIC_DECOUPLING',
    'INTERVAL_RESPONSE',
    'MAX_HR_UPDATE',
    'THRESHOLD_HR_UPDATE',
    'WORKOUT_COMPLIANCE',
    'HEALTH_ANOMALY',
];

const CONFIDENCES: readonly HrMeasurementConfidence[] = ['high', 'moderate', 'low', 'unreliable', 'unknown'];

function emptyAuthorityCounts(): HrFidelityAuthorityCounts {
    return { candidateCount: 0, allowed: 0, bounded: 0, observational: 0, blocked: 0 };
}

function countAuthority(counts: HrFidelityAuthorityCounts, authority: HrUseAuthority): void {
    counts.candidateCount += 1;
    switch (authority.status) {
        case 'ALLOWED': counts.allowed += 1; break;
        case 'BOUNDED': counts.bounded += 1; break;
        case 'OBSERVATIONAL': counts.observational += 1; break;
        case 'BLOCKED': counts.blocked += 1; break;
    }
}

function hasPositiveMetric(value: number | null): boolean {
    return value !== null && value > 0;
}

function currentProductionUse(activity: NormalizedGarminActivity): CurrentProductionHrUse {
    return {
        averageHrDisplay: activity.averageHr !== null,
        hrZoneDisplay: (activity.hrInZones?.length ?? 0) > 0,
        garminTrainingLoadEvidence: hasPositiveMetric(activity.activityTrainingLoad),
        garminTrainingEffectEvidence: hasPositiveMetric(activity.trainingEffectAerobic)
            || hasPositiveMetric(activity.trainingEffectAnaerobic),
    };
}

/**
 * Builds the complete HRF5 authority view. Vendor summaries use HRF6's explicit
 * fail-closed adapters; no caller can accidentally make a Garmin-derived load appear
 * independent from the assessed HR trace.
 */
export function deriveActivityHrFidelityShadowRow(activity: NormalizedGarminActivity): ActivityHrFidelityShadowRow {
    const authorityByUse = Object.fromEntries(
        ALL_USE_CASES.map(useCase => [useCase, getHrUseAuthority(activity, useCase)]),
    ) as HrFidelityAuthorityByUse;
    authorityByUse.TRAINING_LOAD = getGarminTrainingLoadAuthority(activity).authority;
    authorityByUse.TRAINING_EFFECT = getGarminTrainingEffectAuthority(activity, 'trainingEffectAerobic').authority;

    return {
        activityId: activity.activityId,
        date: activity.date,
        activityType: activity.type,
        assessmentState: activity.hrMeasurement ? 'ASSESSED' : 'NOT_ASSESSED',
        measurement: activity.hrMeasurement ?? null,
        currentProductionUse: currentProductionUse(activity),
        authorityByUse,
    };
}

function statusCountsForRows(
    rows: readonly ActivityHrFidelityShadowRow[],
    useCase: HrUseCase,
    predicate: (row: ActivityHrFidelityShadowRow) => boolean,
): HrFidelityAuthorityCounts {
    const counts = emptyAuthorityCounts();
    for (const row of rows) {
        if (predicate(row)) countAuthority(counts, row.authorityByUse[useCase]);
    }
    return counts;
}

function confidenceCounts(): Record<HrMeasurementConfidence, number> {
    return Object.fromEntries(CONFIDENCES.map(confidence => [confidence, 0])) as Record<HrMeasurementConfidence, number>;
}

function sourceDistribution(): Record<HrSourceForActivity | 'not_assessed', number> {
    return { external: 0, wrist: 0, mixed_possible: 0, unknown: 0, not_assessed: 0 };
}

function compatibilityDistribution(): Record<HrSummaryCompatibility | 'not_assessed', number> {
    return {
        verified_same_effective_trace: 0,
        consistent_unproven: 0,
        discordant: 0,
        not_comparable: 0,
        unknown: 0,
        not_assessed: 0,
    };
}

/**
 * Produces a deterministic HRF7 replay journal and aggregate observability. It reads
 * only compact persisted activity evidence: no raw FIT, HR samples, or location data are
 * retained here. Calling it cannot change a recommendation or completed-training result.
 */
export function runActivityHrFidelityShadowReplay(
    activities: readonly NormalizedGarminActivity[],
): ActivityHrFidelityShadowReport {
    const rows = [...activities]
        .sort((left, right) => left.date.localeCompare(right.date) || left.activityId.localeCompare(right.activityId))
        .map(deriveActivityHrFidelityShadowRow);
    const source = sourceDistribution();
    const compatibility = compatibilityDistribution();
    const notAssessedReasons: Record<string, number> = {};
    const unknownReasons: Record<string, number> = {};
    const artifactPrevalence: Record<string, number> = {};
    const byType = new Map<string, HrFidelityConfidenceByActivityType>();

    let assessedActivities = 0;
    let unknownAssessmentCount = 0;
    let poorTraceDespiteChestStrapCount = 0;
    let usefulWristTraceCount = 0;
    let featureSpecificBlockWithDisplayAvailableCount = 0;

    for (const row of rows) {
        let type = byType.get(row.activityType);
        if (!type) {
            type = { activityType: row.activityType, total: 0, notAssessed: 0, assessed: 0, confidence: confidenceCounts() };
            byType.set(row.activityType, type);
        }
        type.total += 1;

        const measurement = row.measurement;
        if (!measurement) {
            source.not_assessed += 1;
            compatibility.not_assessed += 1;
            type.notAssessed += 1;
            notAssessedReasons.MEASUREMENT_UNAVAILABLE = (notAssessedReasons.MEASUREMENT_UNAVAILABLE ?? 0) + 1;
            continue;
        }

        assessedActivities += 1;
        type.assessed += 1;
        type.confidence[measurement.measurementConfidence] += 1;
        source[measurement.sourceForActivity] += 1;
        compatibility[measurement.summaryCompatibility] += 1;
        for (const flag of measurement.artifactFlags) artifactPrevalence[flag] = (artifactPrevalence[flag] ?? 0) + 1;

        if (measurement.measurementConfidence === 'unknown') {
            unknownAssessmentCount += 1;
            const reasons = measurement.reasons.length > 0
                ? measurement.reasons
                : ['ASSESSMENT_REASON_UNSPECIFIED'];
            for (const reason of reasons) unknownReasons[reason] = (unknownReasons[reason] ?? 0) + 1;
        }
        if (
            measurement.externalHrSensorPresent === true
            && measurement.sensorTechnology === 'electrode_chest_strap'
            && measurement.signalQuality === 'poor'
        ) {
            poorTraceDespiteChestStrapCount += 1;
        }
        if (
            measurement.sourceForActivity === 'wrist'
            && row.currentProductionUse.averageHrDisplay
            && row.authorityByUse.DISPLAY_AVERAGE.status === 'ALLOWED'
        ) {
            usefulWristTraceCount += 1;
        }

        const displayAvailable = row.currentProductionUse.averageHrDisplay
            && (
                row.authorityByUse.DISPLAY_AVERAGE.status === 'ALLOWED'
                || row.authorityByUse.DISPLAY_AVERAGE.status === 'OBSERVATIONAL'
            );
        const sensitiveUseBlocked = [
            row.authorityByUse.ZONE_DISTRIBUTION,
            row.authorityByUse.TRAINING_LOAD,
            row.authorityByUse.TRAINING_EFFECT,
            row.authorityByUse.AEROBIC_DECOUPLING,
            row.authorityByUse.MAX_HR_UPDATE,
        ].some(authority => authority.status === 'BLOCKED');
        if (displayAvailable && sensitiveUseBlocked) featureSpecificBlockWithDisplayAvailableCount += 1;
    }

    const authorityByUse = Object.fromEntries(
        ALL_USE_CASES.map(useCase => [useCase, statusCountsForRows(rows, useCase, () => true)]),
    ) as Record<HrUseCase, HrFidelityAuthorityCounts>;
    const assessmentUnknownRate = assessedActivities === 0 ? 0 : unknownAssessmentCount / assessedActivities;
    const summaryComparableCount = compatibility.verified_same_effective_trace
        + compatibility.consistent_unproven
        + compatibility.discordant;
    const summaryReconciliationRate = summaryComparableCount === 0
        ? 0
        : compatibility.verified_same_effective_trace / summaryComparableCount;
    const summaryDiscordanceRate = summaryComparableCount === 0
        ? 0
        : compatibility.discordant / summaryComparableCount;

    const summary: ActivityHrFidelityShadowSummary = {
        totalActivities: rows.length,
        assessableCoverage: rows.length === 0 ? 0 : assessedActivities / rows.length,
        assessedActivities,
        notAssessedActivities: rows.length - assessedActivities,
        notAssessedReasons,
        unknownAssessmentCount,
        assessmentUnknownRate,
        assessmentUnknownReasons: unknownReasons,
        sourceDistribution: source,
        confidenceByActivityType: [...byType.values()].sort((left, right) => left.activityType.localeCompare(right.activityType)),
        artifactPrevalence,
        summaryCompatibility: compatibility,
        summaryComparableCount,
        summaryReconciliationRate,
        summaryDiscordanceRate,
        authorityByUse,
        candidateBlocks: {
            hrZoneDistribution: statusCountsForRows(rows, 'ZONE_DISTRIBUTION', row => row.currentProductionUse.hrZoneDisplay),
            garminTrainingLoad: statusCountsForRows(rows, 'TRAINING_LOAD', row => row.currentProductionUse.garminTrainingLoadEvidence),
            garminTrainingEffect: statusCountsForRows(rows, 'TRAINING_EFFECT', row => row.currentProductionUse.garminTrainingEffectEvidence),
            // There is no persisted max-HR candidate yet. This classifies every assessed
            // trace as a potential future candidate, keeping that absence visible.
            maxHrUpdate: statusCountsForRows(rows, 'MAX_HR_UPDATE', row => row.assessmentState === 'ASSESSED'),
            aerobicDecoupling: statusCountsForRows(rows, 'AEROBIC_DECOUPLING', row => row.assessmentState === 'ASSESSED'),
        },
        poorTraceDespiteChestStrapCount,
        usefulWristTraceCount,
        featureSpecificBlockWithDisplayAvailableCount,
    };

    return {
        generatedFrom: 'activity-history',
        replayVersion: HR_FIDELITY_SHADOW_REPLAY_VERSION,
        authorityPolicyVersion: HR_FIDELITY_AUTHORITY_POLICY_VERSION,
        limitations: [
            'This is shadow evidence only; it does not alter recommendation, readiness, or completed-training behaviour.',
            'Absent compact evidence means not assessed, not unreliable, and its reasons are reported separately from assessed unknown confidence.',
            'Assessed-unknown rate uses assessed activities as its denominator; missing assessments remain separate.',
            'Summary reconciliation/discordance rates use comparable assessed summaries only; unknown and not-comparable records are excluded.',
            'Garmin Training Load and Training Effect remain vendor HR-dependent summaries with unverified exact input lineage.',
            'No maximum-HR candidate is persisted today; the max-HR count classifies assessed traces for a future candidate only.',
        ],
        rows,
        summary,
    };
}

/** Compact Markdown for review artifacts; detailed replay rows remain structured for audit tooling. */
export function renderActivityHrFidelityShadowReplayMarkdown(report: ActivityHrFidelityShadowReport): string {
    const { summary } = report;
    const lines = [
        '# Activity HR fidelity shadow replay',
        '',
        `- Activities: ${summary.totalActivities}`,
        `- Assessed: ${summary.assessedActivities}/${summary.totalActivities} (${(summary.assessableCoverage * 100).toFixed(1)}%)`,
        `- Not assessed: ${summary.notAssessedActivities}`,
        `- Assessed with unknown confidence: ${summary.unknownAssessmentCount}/${summary.assessedActivities} (${(summary.assessmentUnknownRate * 100).toFixed(1)}%)`,
        `- Comparable summary assessments: ${summary.summaryComparableCount}`,
        `- Summary reconciled: ${(summary.summaryReconciliationRate * 100).toFixed(1)}% of comparable assessments`,
        `- Summary discordant: ${(summary.summaryDiscordanceRate * 100).toFixed(1)}% of comparable assessments`,
        `- Feature-specific block while display remains available: ${summary.featureSpecificBlockWithDisplayAvailableCount}`,
        `- Poor trace despite electrode chest strap: ${summary.poorTraceDespiteChestStrapCount}`,
        `- Useful wrist traces preserved for display: ${summary.usefulWristTraceCount}`,
        '',
        '## Candidate authority blocks',
        '',
        '| Candidate | Candidates | Blocked | Bounded | Allowed | Observational |',
        '| --- | ---: | ---: | ---: | ---: | ---: |',
        ...Object.entries(summary.candidateBlocks).map(([name, counts]) => (
            `| ${name} | ${counts.candidateCount} | ${counts.blocked} | ${counts.bounded} | ${counts.allowed} | ${counts.observational} |`
        )),
        '',
        '## Limitations',
        '',
        ...report.limitations.map(limitation => `- ${limitation}`),
        '',
    ];
    return lines.join('\n');
}
