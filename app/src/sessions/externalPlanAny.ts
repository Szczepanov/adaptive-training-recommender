/**
 * The "any schema version" union types, in their own file so `externalPlanV2.ts` and
 * `externalPlanV3.ts` can both contribute to it without a runtime import cycle between
 * them (`externalPlanV3.ts` imports real functions from `externalPlanV2.ts`; this file
 * only ever imports types, which TypeScript erases, so the cycle is type-only and safe).
 *
 * `externalPlanV2.ts` re-exports both names for backward compatibility -- every existing
 * `from '../sessions/externalPlanV2'` import site keeps working unchanged and now also
 * accepts a v3 plan (M3.6's own widening precedent, extended for ADR-0035).
 *
 * v3 sessions are not a new type: ADR-0035 explicitly keeps `ExternalPlanSessionV2`
 * unchanged for v3 (rest is a plan-level directive, not a session), so
 * `AnyExternalPlanSession` does not need a v3 member.
 */
import type { ExternalPlanSession, ExternalTrainingPlan } from '../engine/models';
import type { ExternalPlanSessionV2, ExternalTrainingPlanV2 } from './externalPlanV2';
import type { ExternalTrainingPlanV3 } from './externalPlanV3';

export type AnyExternalTrainingPlan = ExternalTrainingPlan | ExternalTrainingPlanV2 | ExternalTrainingPlanV3;
export type AnyExternalPlanSession = ExternalPlanSession | ExternalPlanSessionV2;
