import type { DailySubjectiveCheckin } from './models';

/**
 * Direct check-in red-flag detection for ledger mode (P2-2).
 * P2-3 will replace/augment this with `resolveRedFlagFindings` in `derived/` and `FlagStrip`.
 */
export function hasRecordedRedFlag(checkin: DailySubjectiveCheckin | null | undefined): boolean {
    if (!checkin) return false;
    if (checkin.redFlags?.present) return true;
    if (checkin.redFlags?.categories && checkin.redFlags.categories.length > 0) return true;
    const symptoms = checkin.healthContext?.symptoms;
    if (
        symptoms?.present &&
        symptoms.severity === 'severe' &&
        symptoms.types?.includes('fever_or_chills')
    ) {
        return true;
    }
    return false;
}
