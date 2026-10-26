import type { LedgerFlag, LedgerFlagId, LedgerState } from '../../ledger/export/schema.ts';

/**
 * One D-FLAGS evaluation (ADR-0052) for one date. Evaluators are pure: they never read
 * Firestore or the clock, so the caller stamps `observedOn`/`evaluatedAt` when persisting.
 * Every field except `reasonCode` is the export's own `LedgerFlag` field, so a persisted
 * evaluation maps onto `LedgerFlag` without reconstructing inputs or thresholds later.
 */
export interface FlagEvaluation {
    id: LedgerFlagId;
    /** null = could not evaluate; `state` says why. */
    active: boolean | null;
    state: LedgerState;
    /** Machine-readable cause of `active`, e.g. the source state that was mapped. */
    reasonCode: string;
    /** Identifies the mapping rule; `threshold` identifies the thresholds behind its inputs. */
    definitionVersion: string;
    inputs: LedgerFlag['inputs'];
    threshold: string | null;
}
