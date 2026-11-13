import type { DailySubjectiveCheckin } from './models';
import { resolveRedFlagFindings } from '../derived/flags/redFlagFindings';

/**
 * Direct check-in red-flag detection for ledger mode (OQ2, ADR-0052).
 *
 * Mirrors the red-flag branch of `resolveClinicalEnvelopeSources` /
 * `resolveRedFlagFindings` (`derived/flags/redFlagFindings.ts`): true iff
 * `redFlags.present`, or severe `fever_or_chills` symptoms. Categories without
 * `present: true` are not a red flag there.
 */
export function hasRecordedRedFlag(checkin: DailySubjectiveCheckin | null | undefined): boolean {
    if (!checkin) return false;
    return Boolean(checkin.redFlags?.present) || resolveRedFlagFindings(checkin).length > 0;
}
