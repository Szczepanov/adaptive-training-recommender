import type { LedgerFlagId, LedgerState } from '../../ledger/export/schema.ts';

/**
 * One D-FLAGS evaluation (ADR-0052) for one date. Evaluators are pure: they never read
 * Firestore or the clock, so the caller stamps `observedOn`/`evaluatedAt` when persisting.
 * State names are the ledger export's, so a persisted evaluation maps onto `LedgerFlag`.
 */
export interface FlagEvaluation {
    id: LedgerFlagId;
    /** null = could not evaluate; `state` says why. */
    active: boolean | null;
    state: LedgerState;
    /** Machine-readable cause of `active`, e.g. the source state that was mapped. */
    reasonCode: string;
    definitionVersion: string;
}
