import type { LedgerFlag, LedgerFlagId, LedgerState } from '../../ledger/export/schema.ts';

/**
 * One D-FLAGS evaluation (ADR-0052) for one date. Evaluators are pure: they never read
 * Firestore or the clock, so the caller stamps `observedOn`/`evaluatedAt` when persisting.
 * Every field except `reasonCode` is the export's own `LedgerFlag` field, with the D-EXPORT
 * meaning: `definitionVersion` identifies the evaluator and the thresholds used, `threshold`
 * is the human-readable rule. A persisted evaluation therefore maps onto `LedgerFlag` without
 * reconstructing inputs or thresholds later; `reasonCode` is evaluator-local and not exported.
 */
export interface FlagEvaluation {
    id: LedgerFlagId;
    /** null = could not evaluate; `state` says why. */
    active: boolean | null;
    state: LedgerState;
    /** Machine-readable cause of `active`, e.g. the source state that was mapped. */
    reasonCode: string;
    definitionVersion: string;
    inputs: LedgerFlag['inputs'];
    threshold: string | null;
}
