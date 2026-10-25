/**
 * Provider activity detail, bounded per purpose (`PURPOSE_BOUNDS`). Omission is counted:
 * `totalInWindow` and `truncated` say how much detail the cap withheld.
 */
import { addDaysToLocalDateString } from '../../utils/localDate.ts';
import type { ActivitySegmentSummary, NormalizedGarminActivity } from '../models.ts';
import { sourceState, type BuildContext } from './buildContext.ts';
import type { LedgerExportRecords } from './inputs.ts';
import { fact, fieldMap, record } from './ledgerValue.ts';
import { ACTIVITY_FIELDS, type ActivityCollection, type LedgerFacts, type LedgerValue } from './schema.ts';
import { windowBounds, windowRows } from './window.ts';

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

/** Newest first: semantic date, then start instant (only compared when both exist), then id. */
function newestFirst(a: NormalizedGarminActivity, b: NormalizedGarminActivity): number {
    if (a.date !== b.date) return a.date > b.date ? -1 : 1;
    if (a.startedAt && b.startedAt && a.startedAt !== b.startedAt) return a.startedAt > b.startedAt ? -1 : 1;
    return a.activityId < b.activityId ? -1 : a.activityId > b.activityId ? 1 : 0;
}

type SegmentFacts = Pick<Record<ActivityField, LedgerValue<unknown>>, 'segmentCountTotal' | 'segmentsTruncated' | 'segments'>;

function segmentFacts(
    activity: NormalizedGarminActivity,
    segmentCap: number,
    base: { source: string; observedOn: string },
    detailAllowed: boolean,
): SegmentFacts {
    const telemetry = activity.activityResponse;
    if (!telemetry) {
        return {
            segmentCountTotal: fact(undefined, base),
            segmentsTruncated: fact(undefined, base),
            segments: fact(undefined, base),
        };
    }
    // Outside the purpose's detail scope the count stays visible; the rows are withheld.
    const kept = detailAllowed ? telemetry.segments.slice(0, segmentCap) : [];
    return {
        segmentCountTotal: fact(telemetry.segmentCountTotal, base),
        segmentsTruncated: fact(telemetry.segmentsTruncated || (detailAllowed && kept.length < telemetry.segments.length), base),
        segments: detailAllowed ? fact(kept.map(exportSegment), base) : fact<ExportedSegment[]>(null, { ...base, absent: 'not_applicable' }),
    };
}

function activityFields(activity: NormalizedGarminActivity, context: BuildContext) {
    const bounds = context.bounds;
    const detailAllowed = !bounds.segmentDetailOnlyDMinus1
        || activity.date === addDaysToLocalDateString(context.asOfDate, -1);
    const base = { source: 'garmin', observedOn: activity.date };
    const segments = segmentFacts(activity, bounds.segmentCap, base, detailAllowed);
    const scalar: Record<Exclude<ActivityField, keyof SegmentFacts>, LedgerValue<unknown>> = {
        type: fact(activity.type, base),
        durationMin: fact(activity.durationMin, { ...base, unit: 'min' }),
        averageHr: fact(activity.averageHr, { ...base, unit: 'bpm' }),
        maxHr: fact(activity.maxHr, { ...base, unit: 'bpm' }),
        activityTrainingLoad: fact(activity.activityTrainingLoad, base),
        intensityTag: fact(activity.intensityTag, base),
        sessionCost: fact(activity.sessionCost, base),
    };
    return fieldMap(ACTIVITY_FIELDS, key => (key in segments
        ? segments[key as keyof SegmentFacts]
        : scalar[key as keyof typeof scalar]));
}

/** Morning gives D-1 rows priority, so same-day rows cannot crowd out the detail the handoff is for. */
function selectForCap(ordered: NormalizedGarminActivity[], context: BuildContext): NormalizedGarminActivity[] {
    const cap = context.bounds.activityCap;
    if (!context.bounds.segmentDetailOnlyDMinus1) return ordered.slice(0, cap);
    const dMinus1 = addDaysToLocalDateString(context.asOfDate, -1);
    const prioritised = [...ordered.filter(row => row.date === dMinus1), ...ordered.filter(row => row.date !== dMinus1)];
    return prioritised.slice(0, cap).sort(newestFirst);
}

export function buildActivities(records: LedgerExportRecords, context: BuildContext): LedgerFacts['activities'] {
    const { rows, droppedUndated } = windowRows(records.activities ?? [], row => row.date, windowBounds(context.window));
    const ordered = [...rows].sort(newestFirst);
    const kept = selectForCap(ordered, context);
    const items = kept.map(row => record(row.activityId, row.date, activityFields(row, context)));
    const collection: ActivityCollection<LedgerFacts['activities']['items'][number]> = {
        state: sourceState(context, 'activities', records.activities !== undefined),
        source: 'activities',
        // Newest first is the contract for activity detail, so no date re-sort here.
        items,
        droppedUndated,
        truncated: ordered.length > kept.length,
        totalInWindow: ordered.length,
    };
    return collection;
}
