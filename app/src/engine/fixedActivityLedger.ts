import type { LedgerEntry } from './dailyLedger';
import { fixedActivityOccurrenceKey } from './fixedActivityIdentity';
import type { FixedActivity } from './models';

/**
 * Adapts a persisted fixed activity to ADR-0036's occurrence/revision accounting
 * boundary. A fixed activity is a scheduled commitment, so it remains a reservation
 * until a richer performed-occurrence source supersedes it; `isCompleted` is handled by
 * the caller that decides whether this planned-capacity path still applies.
 */
export function fixedActivityLedgerEntry(activity: FixedActivity): LedgerEntry {
    const updatedAt = Date.parse(activity.updatedAt);
    return {
        occurrenceId: fixedActivityOccurrenceKey(activity),
        revision: Number.isSafeInteger(updatedAt) && updatedAt >= 0 ? updatedAt : 0,
        reservedMinutes: activity.durationMin,
        reservedSystemicCost: activity.expectedCost?.systemic ?? 0,
        state: 'reserved',
    };
}

function decisionFingerprint(activity: FixedActivity): string {
    return JSON.stringify({
        date: activity.date,
        durationMin: activity.durationMin,
        expectedCost: activity.expectedCost ?? null,
        expectedStimulus: activity.expectedStimulus ?? null,
        fixed: activity.fixed,
        environment: activity.environment,
        equipment: activity.equipment,
        availabilityOverride: activity.availabilityOverride ?? null,
        availabilityContextOverride: activity.availabilityContextOverride ?? null,
        isCompleted: activity.isCompleted,
    });
}

/**
 * Keeps the newest revision of each fixed-activity occurrence. Equal revisions must
 * describe the same decision-bearing activity; otherwise planning fails closed instead of
 * depending on Firestore/query order. This mirrors `computeDailyLedger`'s identity rule
 * while retaining the full activity for schedule and stimulus consumers.
 */
export function dedupeFixedActivitiesByLedgerIdentity(
    activities: readonly FixedActivity[],
): FixedActivity[] {
    const latest = new Map<string, FixedActivity>();
    for (const activity of activities) {
        const entry = fixedActivityLedgerEntry(activity);
        const current = latest.get(entry.occurrenceId);
        if (!current) {
            latest.set(entry.occurrenceId, activity);
            continue;
        }

        const currentEntry = fixedActivityLedgerEntry(current);
        if (entry.revision > currentEntry.revision) {
            latest.set(entry.occurrenceId, activity);
            continue;
        }
        if (entry.revision === currentEntry.revision
            && decisionFingerprint(activity) !== decisionFingerprint(current)) {
            throw new Error(`Conflicting fixed-activity revisions for occurrence '${entry.occurrenceId}' at revision ${entry.revision}`);
        }
    }
    return [...latest.values()];
}

/** Entries for the planner's still-pending fixed commitments. Completed activities are
 * reconstructed through completed-history authority rather than re-reserved here. */
export function pendingFixedActivityLedgerEntries(
    activities: readonly FixedActivity[],
): LedgerEntry[] {
    return dedupeFixedActivitiesByLedgerIdentity(activities)
        .filter(activity => !activity.isCompleted)
        .map(fixedActivityLedgerEntry);
}
