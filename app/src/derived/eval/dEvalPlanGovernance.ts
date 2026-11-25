import { getLocalDateString } from '../../utils/localDate.ts';
import { parseUtcTimestampMs } from './dEvalCriteria.ts';
import type { DEvalRawPlanRevision } from './dEvalRawLedger.ts';

function wasImportedBy(revision: DEvalRawPlanRevision, date: string): boolean {
    const importedMs = parseUtcTimestampMs(revision.importedAt);
    return importedMs === null || getLocalDateString(new Date(importedMs)) <= date;
}

/**
 * The stored revision that governed a Warsaw date. Mirrors `ActiveExternalPlanService`: within a
 * plan, the latest activation effective by the date whose own horizon covers it; across plans, the
 * most recently imported. A revision imported after the date never governed it, because the
 * criteria use the assignments as they stood on that date.
 */
export function governingPlanRevision(
    revisions: Iterable<DEvalRawPlanRevision>,
    date: string,
): DEvalRawPlanRevision | null {
    const byPlan = new Map<string, DEvalRawPlanRevision>();
    for (const revision of revisions) {
        const { effectiveFrom, startDate, endDate } = revision.horizon;
        if (effectiveFrom > date || startDate > date || endDate < date || !wasImportedBy(revision, date)) continue;
        const current = byPlan.get(revision.planId);
        if (
            !current
            || effectiveFrom > current.horizon.effectiveFrom
            || (effectiveFrom === current.horizon.effectiveFrom && revision.revision > current.revision)
        ) {
            byPlan.set(revision.planId, revision);
        }
    }
    return [...byPlan.values()].sort((a, b) =>
        b.importedAt.localeCompare(a.importedAt) || b.planId.localeCompare(a.planId))[0] ?? null;
}
