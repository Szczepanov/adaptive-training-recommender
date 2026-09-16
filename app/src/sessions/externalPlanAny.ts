/**
 * The "any schema version" union types, in their own file so `externalPlanV2.ts`,
 * `externalPlanV3.ts` and `externalPlanV4.ts` can all contribute to it without a runtime
 * import cycle between them (`externalPlanV3.ts`/`externalPlanV4.ts` import real functions
 * from `externalPlanV2.ts`; this file only ever imports types, which TypeScript erases, so
 * the cycle is type-only and safe).
 *
 * `externalPlanV2.ts` re-exports both names for backward compatibility -- every existing
 * `from '../sessions/externalPlanV2'` import site keeps working unchanged and now also
 * accepts a v3 or v4 plan (M3.6's own widening precedent, extended for ADR-0035/ADR-0036).
 *
 * v3 sessions are not a new type: ADR-0035 explicitly keeps `ExternalPlanSessionV2`
 * unchanged for v3 (rest is a plan-level directive, not a session), so
 * `AnyExternalPlanSession` does not need a v3 member. v4 (ADR-0036) is different: its
 * `intraday` field is session-level, so `ExternalPlanSessionV4` is a real new member here.
 */
import type { ExternalPlanSession, ExternalTrainingPlan } from '../engine/models';
import type { ExternalPlanSessionV2, ExternalTrainingPlanV2 } from './externalPlanV2';
import type { ExternalTrainingPlanV3 } from './externalPlanV3';
import type { ExternalPlanSessionV4, ExternalTrainingPlanV4 } from './externalPlanV4';
import type { ExternalTrainingPlanV5 } from './externalPlanV5';

/** v5 (ADR-0037) is plan-level like v3, not session-level like v4 -- no new
 * `AnyExternalPlanSession` member is needed, same reasoning v3 documents above. */
export type AnyExternalTrainingPlan = ExternalTrainingPlan | ExternalTrainingPlanV2 | ExternalTrainingPlanV3 | ExternalTrainingPlanV4 | ExternalTrainingPlanV5;
export type AnyExternalPlanSession = ExternalPlanSession | ExternalPlanSessionV2 | ExternalPlanSessionV4;
