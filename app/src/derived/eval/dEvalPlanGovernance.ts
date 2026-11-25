import { getLocalDateString } from '../../utils/localDate.ts';
import { parseUtcTimestampMs } from './dEvalCriteria.ts';
import type { DEvalRawPlanRevision } from './dEvalRawLedger.ts';

export type PlanGovernance = (date: string) => DEvalRawPlanRevision | null;

/**
 * Resolves the stored revision that governed a Warsaw date. Mirrors `ActiveExternalPlanService`:
 * within a plan, the latest activation effective by the date whose own horizon covers it; across
 * plans, the most recently imported. A revision imported after the date never governed it, because
 * the criteria use the assignments as they stood on that date. Results are memoized per date.
 */
export function createPlanGovernance(revisions: Iterable<DEvalRawPlanRevision>): PlanGovernance {
    const dated = [...revisions].map(revision => {
        const importedMs = parseUtcTimestampMs(revision.importedAt);
        return { revision, importedOn: importedMs === null ? null : getLocalDateString(new Date(importedMs)) };
    });
    const cache = new Map<string, DEvalRawPlanRevision | null>();

    const resolve: PlanGovernance = date => {
        const byPlan = new Map<string, DEvalRawPlanRevision>();
        for (const { revision, importedOn } of dated) {
            const { effectiveFrom, startDate, endDate } = revision.horizon;
            if (effectiveFrom > date || startDate > date || endDate < date) continue;
            if (importedOn !== null && importedOn > date) continue;
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
    };

    return date => {
        const cached = cache.get(date);
        if (cached !== undefined) return cached;
        const governing = resolve(date);
        cache.set(date, governing);
        return governing;
    };
}
