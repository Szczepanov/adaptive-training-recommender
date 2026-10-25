/** Provider activity detail, bounded per purpose (OD1/OD2: newest 12, <= 20 segments each). */
import type { ActivitySegmentSummary, NormalizedGarminActivity } from '../models.ts';
import { collect, type BuildContext } from './buildContext.ts';
import type { LedgerExportRecords } from './inputs.ts';
import { fact, fieldMap, record } from './ledgerValue.ts';
import { ACTIVITY_FIELDS, type LedgerFacts, type LedgerValue } from './schema.ts';
import { inWindow } from './window.ts';

type ActivityField = typeof ACTIVITY_FIELDS[number];

interface ExportedSegment {
    segmentIndex: number;
    segmentType: string;
    durationSeconds: number;
    averagePowerWatts: number | null;
    averageHrBpm: number | null;
    maxHrBpm: number | null;
    evidenceConfidence: string;
}

function exportSegment(segment: ActivitySegmentSummary): ExportedSegment {
    return {
        segmentIndex: segment.segmentIndex,
        segmentType: segment.segmentType,
        durationSeconds: segment.durationSeconds,
        averagePowerWatts: segment.averagePowerWatts ?? null,
        averageHrBpm: segment.averageHrBpm ?? null,
        maxHrBpm: segment.maxHrBpm ?? null,
        evidenceConfidence: segment.evidenceConfidence,
    };
}

/** Newest first: instant when known, otherwise the calendar date; id breaks ties. */
function newestFirst(a: NormalizedGarminActivity, b: NormalizedGarminActivity): number {
    const left = a.startedAt ?? a.date;
    const right = b.startedAt ?? b.date;
    return right.localeCompare(left) || a.activityId.localeCompare(b.activityId);
}

function segmentFacts(
    activity: NormalizedGarminActivity,
    segmentCap: number | null,
    base: { source: string; observedOn: string },
): Pick<Record<ActivityField, LedgerValue<unknown>>, 'segmentCountTotal' | 'segmentsTruncated' | 'segments'> {
    const telemetry = activity.activityResponse;
    if (!telemetry) {
        return {
            segmentCountTotal: fact(undefined, base),
            segmentsTruncated: fact(undefined, base),
            segments: fact(undefined, base),
        };
    }
    const kept = segmentCap === null ? telemetry.segments : telemetry.segments.slice(0, segmentCap);
    return {
        segmentCountTotal: fact(telemetry.segmentCountTotal, base),
        segmentsTruncated: fact(telemetry.segmentsTruncated || kept.length < telemetry.segments.length, base),
        segments: fact(kept.map(exportSegment), base),
    };
}

function activityFields(activity: NormalizedGarminActivity, segmentCap: number | null) {
    const base = { source: 'garmin', observedOn: activity.date };
    const segments = segmentFacts(activity, segmentCap, base);
    const scalar: Record<Exclude<ActivityField, keyof typeof segments>, LedgerValue<unknown>> = {
        type: fact(activity.type, base),
        durationMin: fact(activity.durationMin, { ...base, unit: 'min' }),
        averageHr: fact(activity.averageHr, { ...base, unit: 'bpm' }),
        maxHr: fact(activity.maxHr, { ...base, unit: 'bpm' }),
        activityTrainingLoad: fact(activity.activityTrainingLoad, base),
        intensityTag: fact(activity.intensityTag, base),
        sessionCost: fact(activity.sessionCost, base),
    };
    return fieldMap(ACTIVITY_FIELDS, key => (key in segments
        ? segments[key as keyof typeof segments]
        : scalar[key as keyof typeof scalar]));
}

export function buildActivities(records: LedgerExportRecords, context: BuildContext): LedgerFacts['activities'] {
    return collect(context, 'activities', records.activities, rows => {
        const inRange = rows.filter(row => inWindow(row.date, context.window)).sort(newestFirst);
        const cap = context.bounds.activityCap;
        const kept = cap === null ? inRange : inRange.slice(0, cap);
        return kept.map(row => record(row.activityId, row.date, activityFields(row, context.bounds.segmentCap)));
    });
}
