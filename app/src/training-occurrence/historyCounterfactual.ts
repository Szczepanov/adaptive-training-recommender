/** Pure comparisons used by TO4's diagnostic-only broad-history evidence replay. */
import type { CompletedExposure } from '../engine/trainingHistory';

const COST_DIMENSIONS = ['systemic', 'cardiovascular', 'lowerBody', 'upperBody', 'impactTissue', 'neuromuscular'] as const;
const STIMULUS_DIMENSIONS = ['aerobicEndurance', 'thresholdPower', 'vo2MaxPower', 'repeatedSurges', 'sprintPower', 'fatigueResistance', 'maxStrength', 'hypertrophy'] as const;

export interface ExposureComparison {
    liveCount: number;
    canonicalCount: number;
    countDelta: number;
    costTotals: Record<(typeof COST_DIMENSIONS)[number], { liveKnown: number; canonicalKnown: number; live: number; canonical: number; delta: number | null }>;
    deliveredDose: {
        liveKnown: number; canonicalKnown: number;
        livePlannedMinutesKnown: number; canonicalPlannedMinutesKnown: number;
        livePlannedMinutes: number; canonicalPlannedMinutes: number; deltaPlannedMinutes: number | null;
        liveCompletedMinutesKnown: number; canonicalCompletedMinutesKnown: number;
        liveCompletedMinutes: number; canonicalCompletedMinutes: number; deltaCompletedMinutes: number | null;
        liveCompletionRatioKnown: number; canonicalCompletionRatioKnown: number;
        liveMeanCompletionRatio: number | null; canonicalMeanCompletionRatio: number | null; deltaMeanCompletionRatio: number | null;
    };
    durationMinutes: { live: number; canonical: number; delta: number };
    recoveryHours: { liveKnown: number; canonicalKnown: number; live: number; canonical: number; delta: number | null };
    stimulusTotals: Record<(typeof STIMULUS_DIMENSIONS)[number], { liveKnown: number; canonicalKnown: number; live: number; canonical: number; delta: number | null }>;
    stimulusConfidence: { live: Record<string, number>; canonical: Record<string, number> };
    unknownCanonicalOccurrenceCount: number;
    identityEvidence: { live: { exactWorkout: number; exactTemplate: number; modalityOnly: number; unknown: number }; canonical: { exactWorkout: number; exactTemplate: number; modalityOnly: number; unknown: number } };
    duplicateOccurrenceKeys: { live: number; canonical: number };
    perOccurrence: Array<{
        /** Stable row ordinal only; source and occurrence IDs are never rendered. */
        pairIndex: number;
        status: 'matched' | 'live_only' | 'canonical_only' | 'ambiguous_key';
        dateChanged?: boolean;
        modalityChanged?: boolean;
        categoryChanged?: boolean;
        identityChanged?: boolean;
        durationDeltaMinutes?: number;
        trainingRecordTypeChanged?: boolean;
        trainingEffectDelta?: number;
        intensityTagChanged?: boolean;
        recoveryHoursDelta?: number | null;
        deliveredDosePlannedMinutesDelta?: number | null;
        deliveredDoseCompletedMinutesDelta?: number | null;
        deliveredDoseCompletionRatioDelta?: number | null;
        stimulusConfidenceChanged?: boolean;
        costDelta?: Partial<Record<(typeof COST_DIMENSIONS)[number], number>>;
        stimulusDelta?: Partial<Record<(typeof STIMULUS_DIMENSIONS)[number], number>>;
    }>;
}

export interface RecommendationDelta {
    verdict: boolean;
    mode: boolean;
    selectedTemplate: boolean;
    prescription: boolean;
    dose: boolean;
    variant: boolean;
    coverage: boolean;
    sequence: boolean;
    fatigue: boolean;
    guardrails: boolean;
    changedFields: string[];
    fieldClassifications: Record<string, 'expected' | 'explainable' | 'unresolved'>;
    classification: 'unchanged' | 'expected' | 'explainable' | 'unresolved';
}

function tally(values: readonly (string | undefined)[]): Record<string, number> {
    const result: Record<string, number> = {};
    for (const value of values) if (value) result[value] = (result[value] ?? 0) + 1;
    return result;
}

function identityEvidence(rows: readonly CompletedExposure[]): ExposureComparison['identityEvidence']['live'] {
    return rows.reduce((counts, row) => {
        if (row.workoutId) counts.exactWorkout += 1;
        else if (row.templateId) counts.exactTemplate += 1;
        else if (row.modality) counts.modalityOnly += 1;
        else counts.unknown += 1;
        return counts;
    }, { exactWorkout: 0, exactTemplate: 0, modalityOnly: 0, unknown: 0 });
}

function aggregate<K extends string>(
    live: readonly CompletedExposure[],
    canonical: readonly CompletedExposure[],
    dimensions: readonly K[],
    read: (exposure: CompletedExposure, key: K) => number | undefined,
): Record<K, { liveKnown: number; canonicalKnown: number; live: number; canonical: number; delta: number | null }> {
    return Object.fromEntries(dimensions.map(key => {
        const liveValues = live.flatMap(exposure => read(exposure, key) === undefined ? [] : [read(exposure, key) as number]);
        const canonicalValues = canonical.flatMap(exposure => read(exposure, key) === undefined ? [] : [read(exposure, key) as number]);
        const liveTotal = liveValues.reduce((sum, value) => sum + value, 0);
        const canonicalTotal = canonicalValues.reduce((sum, value) => sum + value, 0);
        return [key, {
            liveKnown: liveValues.length,
            canonicalKnown: canonicalValues.length,
            live: liveTotal,
            canonical: canonicalTotal,
            delta: liveValues.length === live.length && canonicalValues.length === canonical.length
                ? canonicalTotal - liveTotal : null,
        }];
    })) as Record<K, { liveKnown: number; canonicalKnown: number; live: number; canonical: number; delta: number | null }>;
}

function occurrenceGroups(rows: readonly CompletedExposure[]): Map<string, CompletedExposure[]> {
    const groups = new Map<string, CompletedExposure[]>();
    for (const row of rows) {
        if (!row.occurrenceKey) continue;
        const group = groups.get(row.occurrenceKey) ?? [];
        group.push(row);
        groups.set(row.occurrenceKey, group);
    }
    return groups;
}

function perOccurrenceDeltas(live: readonly CompletedExposure[], canonical: readonly CompletedExposure[]) {
    const liveGroups = occurrenceGroups(live);
    const canonicalGroups = occurrenceGroups(canonical);
    const keys = [...new Set([...liveGroups.keys(), ...canonicalGroups.keys()])].sort();
    const result: ExposureComparison['perOccurrence'] = [];
    for (const key of keys) {
        const liveRows = liveGroups.get(key) ?? [];
        const canonicalRows = canonicalGroups.get(key) ?? [];
        if (liveRows.length > 1 || canonicalRows.length > 1) {
            result.push({ pairIndex: result.length, status: 'ambiguous_key' });
            continue;
        }
        if (liveRows.length === 0) {
            result.push({ pairIndex: result.length, status: 'canonical_only' });
            continue;
        }
        if (canonicalRows.length === 0) {
            result.push({ pairIndex: result.length, status: 'live_only' });
            continue;
        }
        const liveRow = liveRows[0];
        const canonicalRow = canonicalRows[0];
        const costDelta = Object.fromEntries(COST_DIMENSIONS.flatMap(dimension => {
            const a = liveRow.costProfile[dimension];
            const b = canonicalRow.costProfile[dimension];
            return a === undefined || b === undefined ? [] : [[dimension, b - a]];
        })) as Partial<Record<(typeof COST_DIMENSIONS)[number], number>>;
        const stimulusDelta = Object.fromEntries(STIMULUS_DIMENSIONS.flatMap(dimension => {
            const a = liveRow.stimulusProfile?.[dimension];
            const b = canonicalRow.stimulusProfile?.[dimension];
            return a === undefined || b === undefined ? [] : [[dimension, b - a]];
        })) as Partial<Record<(typeof STIMULUS_DIMENSIONS)[number], number>>;
        const liveIdentity = liveRow.workoutId ? `workout:${liveRow.workoutId}`
            : liveRow.templateId ? `template:${liveRow.templateId}` : undefined;
        const canonicalIdentity = canonicalRow.workoutId ? `workout:${canonicalRow.workoutId}`
            : canonicalRow.templateId ? `template:${canonicalRow.templateId}` : undefined;
        result.push({
            pairIndex: result.length,
            status: 'matched',
            dateChanged: liveRow.date !== canonicalRow.date,
            modalityChanged: liveRow.modality !== canonicalRow.modality,
            categoryChanged: liveRow.category !== canonicalRow.category,
            identityChanged: liveIdentity !== canonicalIdentity,
            durationDeltaMinutes: canonicalRow.trainingRecordLike.duration_min - liveRow.trainingRecordLike.duration_min,
            trainingRecordTypeChanged: liveRow.trainingRecordLike.type !== canonicalRow.trainingRecordLike.type,
            trainingEffectDelta: canonicalRow.trainingRecordLike.training_effect - liveRow.trainingRecordLike.training_effect,
            intensityTagChanged: liveRow.trainingRecordLike.intensity_tag !== canonicalRow.trainingRecordLike.intensity_tag,
            recoveryHoursDelta: liveRow.recoveryHours === undefined || canonicalRow.recoveryHours === undefined
                ? null : canonicalRow.recoveryHours - liveRow.recoveryHours,
            deliveredDosePlannedMinutesDelta: liveRow.deliveredDose?.plannedDurationMin === undefined || canonicalRow.deliveredDose?.plannedDurationMin === undefined
                ? null : canonicalRow.deliveredDose.plannedDurationMin - liveRow.deliveredDose.plannedDurationMin,
            deliveredDoseCompletedMinutesDelta: liveRow.deliveredDose?.completedDurationMin === undefined || canonicalRow.deliveredDose?.completedDurationMin === undefined
                ? null : canonicalRow.deliveredDose.completedDurationMin - liveRow.deliveredDose.completedDurationMin,
            deliveredDoseCompletionRatioDelta: liveRow.deliveredDose?.completionRatio === undefined || canonicalRow.deliveredDose?.completionRatio === undefined
                ? null : canonicalRow.deliveredDose.completionRatio - liveRow.deliveredDose.completionRatio,
            stimulusConfidenceChanged: liveRow.stimulusConfidence !== canonicalRow.stimulusConfidence,
            costDelta,
            stimulusDelta,
        });
    }
    for (const _row of live) if (!_row.occurrenceKey) result.push({ pairIndex: result.length, status: 'live_only' });
    for (const _row of canonical) if (!_row.occurrenceKey) result.push({ pairIndex: result.length, status: 'canonical_only' });
    return result;
}

/**
 * Compares already-derived production `CompletedExposure` rows. This deliberately does
 * not infer canonical semantics from Garmin telemetry or planned occurrences. Callers
 * must omit a canonical row when its performed facts cannot support a field and list its
 * stable, non-sensitive occurrence key in `unknownCanonicalOccurrenceKeys`.
 */
export function compareCompletedExposureSets(
    live: readonly CompletedExposure[],
    canonical: readonly CompletedExposure[],
    unknownCanonicalOccurrenceKeys: readonly string[] = [],
): ExposureComparison {
    const liveDose = live.flatMap(row => row.deliveredDose ? [row.deliveredDose] : []);
    const canonicalDose = canonical.flatMap(row => row.deliveredDose ? [row.deliveredDose] : []);
    const livePlannedMinutesKnown = liveDose.flatMap(dose => dose.plannedDurationMin === undefined ? [] : [dose.plannedDurationMin]);
    const canonicalPlannedMinutesKnown = canonicalDose.flatMap(dose => dose.plannedDurationMin === undefined ? [] : [dose.plannedDurationMin]);
    const liveMinutesKnown = liveDose.flatMap(dose => dose.completedDurationMin === undefined ? [] : [dose.completedDurationMin]);
    const canonicalMinutesKnown = canonicalDose.flatMap(dose => dose.completedDurationMin === undefined ? [] : [dose.completedDurationMin]);
    const liveRatioKnown = liveDose.flatMap(dose => dose.completionRatio === undefined ? [] : [dose.completionRatio]);
    const canonicalRatioKnown = canonicalDose.flatMap(dose => dose.completionRatio === undefined ? [] : [dose.completionRatio]);
    const livePlannedMinutes = livePlannedMinutesKnown.reduce((sum, value) => sum + value, 0);
    const canonicalPlannedMinutes = canonicalPlannedMinutesKnown.reduce((sum, value) => sum + value, 0);
    const liveMinutes = liveMinutesKnown.reduce((sum, value) => sum + value, 0);
    const canonicalMinutes = canonicalMinutesKnown.reduce((sum, value) => sum + value, 0);
    const liveMeanCompletionRatio = liveRatioKnown.length > 0
        ? liveRatioKnown.reduce((sum, value) => sum + value, 0) / liveRatioKnown.length : null;
    const canonicalMeanCompletionRatio = canonicalRatioKnown.length > 0
        ? canonicalRatioKnown.reduce((sum, value) => sum + value, 0) / canonicalRatioKnown.length : null;
    const liveRecovery = live.flatMap(row => row.recoveryHours === undefined ? [] : [row.recoveryHours]);
    const canonicalRecovery = canonical.flatMap(row => row.recoveryHours === undefined ? [] : [row.recoveryHours]);
    const liveGroups = occurrenceGroups(live);
    const canonicalGroups = occurrenceGroups(canonical);
    const perOccurrence = perOccurrenceDeltas(live, canonical);
    return {
        liveCount: live.length,
        canonicalCount: canonical.length,
        countDelta: canonical.length - live.length,
        costTotals: aggregate(live, canonical, COST_DIMENSIONS, (row, key) => row.costProfile[key]),
        deliveredDose: {
            liveKnown: liveDose.length,
            canonicalKnown: canonicalDose.length,
            livePlannedMinutesKnown: livePlannedMinutesKnown.length,
            canonicalPlannedMinutesKnown: canonicalPlannedMinutesKnown.length,
            livePlannedMinutes,
            canonicalPlannedMinutes,
            deltaPlannedMinutes: livePlannedMinutesKnown.length === live.length && canonicalPlannedMinutesKnown.length === canonical.length
                ? canonicalPlannedMinutes - livePlannedMinutes : null,
            liveCompletedMinutesKnown: liveMinutesKnown.length,
            canonicalCompletedMinutesKnown: canonicalMinutesKnown.length,
            liveCompletedMinutes: liveMinutes,
            canonicalCompletedMinutes: canonicalMinutes,
            deltaCompletedMinutes: liveMinutesKnown.length === live.length && canonicalMinutesKnown.length === canonical.length
                ? canonicalMinutes - liveMinutes : null,
            liveCompletionRatioKnown: liveRatioKnown.length,
            canonicalCompletionRatioKnown: canonicalRatioKnown.length,
            liveMeanCompletionRatio,
            canonicalMeanCompletionRatio,
            deltaMeanCompletionRatio: liveRatioKnown.length === live.length && canonicalRatioKnown.length === canonical.length
                && liveMeanCompletionRatio !== null && canonicalMeanCompletionRatio !== null
                ? canonicalMeanCompletionRatio - liveMeanCompletionRatio : null,
        },
        durationMinutes: {
            live: live.reduce((sum, row) => sum + row.trainingRecordLike.duration_min, 0),
            canonical: canonical.reduce((sum, row) => sum + row.trainingRecordLike.duration_min, 0),
            delta: canonical.reduce((sum, row) => sum + row.trainingRecordLike.duration_min, 0) - live.reduce((sum, row) => sum + row.trainingRecordLike.duration_min, 0),
        },
        recoveryHours: {
            liveKnown: liveRecovery.length,
            canonicalKnown: canonicalRecovery.length,
            live: liveRecovery.reduce((sum, value) => sum + value, 0),
            canonical: canonicalRecovery.reduce((sum, value) => sum + value, 0),
            delta: liveRecovery.length === live.length && canonicalRecovery.length === canonical.length
                ? canonicalRecovery.reduce((sum, value) => sum + value, 0) - liveRecovery.reduce((sum, value) => sum + value, 0)
                : null,
        },
        stimulusTotals: aggregate(live, canonical, STIMULUS_DIMENSIONS, (row, key) => row.stimulusProfile?.[key]),
        stimulusConfidence: {
            live: tally(live.map(row => row.stimulusConfidence)),
            canonical: tally(canonical.map(row => row.stimulusConfidence)),
        },
        unknownCanonicalOccurrenceCount: unknownCanonicalOccurrenceKeys.length,
        identityEvidence: { live: identityEvidence(live), canonical: identityEvidence(canonical) },
        duplicateOccurrenceKeys: {
            live: [...liveGroups.values()].filter(group => group.length > 1).length,
            canonical: [...canonicalGroups.values()].filter(group => group.length > 1).length,
        },
        perOccurrence,
    };
}

function stableJson(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`).join(',')}}`;
    }
    return JSON.stringify(value) ?? 'undefined';
}

/** Diff two results from the same deterministic engine call with only history swapped. */
export function compareRecommendationOutputs(
    live: Readonly<Record<string, unknown>>,
    canonical: Readonly<Record<string, unknown>>,
): RecommendationDelta {
    const fields = [...new Set([...Object.keys(live), ...Object.keys(canonical)])].sort();
    const changedFields = fields
        .filter(key => stableJson(live[key]) !== stableJson(canonical[key]))
        .sort();
    const has = (field: string) => changedFields.includes(field);
    const result = {
        verdict: has('verdict') || has('mode') || has('selectedTemplate') || has('prescription'),
        mode: has('mode'),
        selectedTemplate: has('selectedTemplate'),
        prescription: has('prescription'),
        dose: has('dose'),
        variant: has('variant'),
        coverage: has('coverage'),
        sequence: has('sequence'),
        fatigue: has('fatigue'),
        guardrails: has('guardrails'),
        changedFields,
    };
    const fieldClassifications = Object.fromEntries(changedFields.map(field => [field, 'unresolved'])) as RecommendationDelta['fieldClassifications'];
    const observedClassifications = Object.values(fieldClassifications);
    const classification = changedFields.length === 0 ? 'unchanged'
        : observedClassifications.includes('unresolved') ? 'unresolved'
            : observedClassifications.includes('explainable') ? 'explainable' : 'expected';
    return {
        ...result,
        fieldClassifications,
        classification,
    };
}
