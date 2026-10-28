import type { FlagEvaluation } from '../derived/flags/flagEvaluation';

/** Append-only observation of what the app knew on one Warsaw date (#1153). */
export interface PersistedFlagEvaluation extends FlagEvaluation {
    schemaVersion: 1;
    userId: string;
    revisionId: string;
    idempotencyKey: string;
    observedOn: string;
    evaluatedAt: string;
    sessionRef?: string;
    baselineWindow?: string;
}
