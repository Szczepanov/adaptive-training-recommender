/**
 * Drop/move reasons for imported plan sessions (ledger export Phase 3C). Pure helpers so the
 * reason a write carries is testable without a DOM.
 */
import type { ExternalPlacementAssignment } from '../engine/models';
import {
    PLACEMENT_REASON_CODES,
    PLACEMENT_REASON_NOTE_MAX,
    type PlacementReason,
    type PlacementReasonCode,
} from '../ledger/models';

export const PLACEMENT_REASON_LABELS: Record<PlacementReasonCode, string> = {
    time: 'Time',
    fatigue: 'Fatigue',
    pain: 'Pain',
    equipment: 'Equipment',
    travel: 'Travel',
    other: 'Other',
};

export const PLACEMENT_REASON_OPTIONS = PLACEMENT_REASON_CODES.map(code => ({ code, label: PLACEMENT_REASON_LABELS[code] }));

/**
 * The reason to store: `null` when nothing was chosen (asked, left blank). A note typed without a
 * code is kept under `other`, so free text is never silently dropped.
 */
export function placementReasonFrom(code: PlacementReasonCode | '', note: string): PlacementReason | null {
    const trimmed = note.trim().slice(0, PLACEMENT_REASON_NOTE_MAX);
    if (!code && !trimmed) return null;
    return { code: code || 'other', ...(trimmed ? { note: trimmed } : {}) };
}

/** Stamps the reason on the session's assignment when the write moved or dropped it. */
export function withPlacementReason(
    assignments: readonly ExternalPlacementAssignment[],
    sessionId: string,
    reason: PlacementReason | null,
): ExternalPlacementAssignment[] {
    return assignments.map(item => (item.sessionId === sessionId && (item.status === 'moved' || item.status === 'dropped')
        ? { ...item, reason }
        : item));
}
