import type { DailySubjectiveCheckin } from './models';

/**
 * Direct check-in red-flag detection for ledger mode (P2-2).
 * P2-3 will replace/augment this with `resolveRedFlagFindings` in `derived/` and `FlagStrip`.
 *
 * Mirrors the red-flag branch of engine `resolveClinicalEnvelopeSources` /
 * `resolveRedFlagFindings` (`engine/adapters.ts`): true iff `redFlags.present`, or severe
 * `fever_or_chills` symptoms. Categories without `present: true` are not a red flag there.
 */
export function hasRecordedRedFlag(checkin: DailySubjectiveCheckin | null | undefined): boolean {
    if (!checkin) return false;
    if (checkin.redFlags?.present) return true;
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
