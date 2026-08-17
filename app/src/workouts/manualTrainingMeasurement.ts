import type { StrengthSession } from '../engine/models';
import { deriveStrengthExposure } from './strengthExposure';

/**
 * S3.3 measurement infrastructure (ADR-0021 D-STRCOST). Summarizes what enabling
 * `ManualTrainingPolicy = 'included'` would add to a training history window, without running
 * a full decision-composer comparison. This is intentionally the smaller of two possible
 * scopes: a per-day recommendation-verdict comparison (matching `simulate:diff`'s semantic
 * diff, or `subjectiveDriftComparison.ts`'s Phase 9.6 precedent) would be the fuller
 * measurement, but building that generator is a meaningfully larger undertaking that is not
 * justified while zero real logged sessions exist to run it against -- see this item's
 * outcome note in the strength-session-logging plan for why the decision here is to defer,
 * not to ship, regardless of what this summary reports.
 */

export interface ManualTrainingMeasurementSummary {
    sessionCount: number;
    exposureCount: number;
    /** Additional derivable records that resolve to an already-counted physical
     * occurrence (usually manual + recommendation-linked evidence). */
    duplicateOccurrenceCount: number;
    /** Sessions with no admissible exposure (still `in_progress`, or nothing logged) --
     *  not an error, just excluded from the totals below. */
    skippedSessionCount: number;
    totalCostByAxis: Record<'systemic' | 'cardiovascular' | 'lowerBody' | 'upperBody' | 'impactTissue' | 'neuromuscular', number>;
    totalStimulus: { maxStrength: number; hypertrophy: number };
    /** How many exposures were inferred from fully catalog-identified work vs `unknown`
     *  confidence (at least one free-text exercise) -- a summary with a large
     *  unknown share is weaker evidence regardless of its magnitude. */
    confidenceCounts: { inferred: number; unknown: number };
}

export function summarizeManualTrainingMeasurement(sessions: readonly StrengthSession[]): ManualTrainingMeasurementSummary {
    const summary: ManualTrainingMeasurementSummary = {
        sessionCount: sessions.length,
        exposureCount: 0,
        duplicateOccurrenceCount: 0,
        skippedSessionCount: 0,
        totalCostByAxis: { systemic: 0, cardiovascular: 0, lowerBody: 0, upperBody: 0, impactTissue: 0, neuromuscular: 0 },
        totalStimulus: { maxStrength: 0, hypertrophy: 0 },
        confidenceCounts: { inferred: 0, unknown: 0 },
    };

    const exposuresByOccurrence = new Map<string, NonNullable<ReturnType<typeof deriveStrengthExposure>>>();
    for (const session of sessions) {
        const exposure = deriveStrengthExposure(session);
        if (!exposure) {
            summary.skippedSessionCount += 1;
            continue;
        }
        const occurrenceKey = exposure.occurrenceKey ?? `strength:${session.sessionId}`;
        if (exposuresByOccurrence.has(occurrenceKey)) summary.duplicateOccurrenceCount += 1;
        // Mirrors the snapshot builder: later, richer manual evidence replaces an earlier
        // record for the same occurrence instead of adding a second physical workout.
        exposuresByOccurrence.set(occurrenceKey, exposure);
    }

    summary.exposureCount = exposuresByOccurrence.size;
    for (const exposure of exposuresByOccurrence.values()) {
        for (const axis of Object.keys(summary.totalCostByAxis) as (keyof typeof summary.totalCostByAxis)[]) {
            summary.totalCostByAxis[axis] += exposure.costProfile[axis];
        }
        if (exposure.stimulusProfile) {
            summary.totalStimulus.maxStrength += exposure.stimulusProfile.maxStrength;
            summary.totalStimulus.hypertrophy += exposure.stimulusProfile.hypertrophy;
        }
        if (exposure.stimulusConfidence === 'inferred') summary.confidenceCounts.inferred += 1;
        else if (exposure.stimulusConfidence === 'unknown') summary.confidenceCounts.unknown += 1;
    }

    return summary;
}
