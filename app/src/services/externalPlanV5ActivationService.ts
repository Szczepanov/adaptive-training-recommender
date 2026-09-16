/**
 * ADR-0037 D-SCHEMA persistence wiring: turns a validated `external-plan@5` revision's
 * authored `intentBlocks` into real, persisted `IntentBlock`s via `intentBlockService`, so
 * an imported block actually appears in H5c's review/progression flow the same way a
 * manually-authored one (`ProgressionBlockEditor.tsx`) already does.
 *
 * Deliberately separate from `services/externalPlanService.ts`'s `import()`: that function
 * stays schema-agnostic (validate raw bytes, store one revision) across all five schema
 * versions. Materialization is a second, explicit step the caller invokes after a successful
 * v5 import, not a side effect hidden inside a version-agnostic function. It is also separate
 * from `intentBlockService.ts` itself -- that file's `save()` was already built with a second
 * (non-manual) caller in mind and needs no change here.
 *
 * `IntentBlock.id`/`.revision` are per-block, per-athlete identity (`users/{userId}/
 * intent_blocks/{blockId}`), independent of the source plan's own revision counter. Each
 * authored entry's plan-scoped `id` is namespaced by the plan id (`${planId}::${entry.id}`)
 * so two different imported plans can never collide, while re-importing a later revision of
 * the *same* plan with the *same* entry id continues that block's own revision sequence
 * rather than starting a new one.
 */

import type { ExternalTrainingPlanV5 } from '../sessions/externalPlanV5';
import { resolveExternalIntentBlock } from '../sessions/externalPlanV5';
import { intentBlockService, type IntentBlockHeader, type IntentBlockService } from './intentBlockService';
import { getErrorMessage } from '../utils/errors';

export const EXTERNAL_INTENT_BLOCK_SOURCE_SCHEMA_VERSION = 'adaptive-training-recommender/external-plan@5';

/** Deterministic, collision-resistant across plans; stable across revisions of the same
 * plan so a re-import updates the same block rather than orphaning the earlier one. */
export function externalIntentBlockId(planId: string, entryId: string): string {
    return `${planId}::${entryId}`;
}

export type IntentBlockActivationOutcome =
    | { status: 'saved'; header: IntentBlockHeader }
    | { status: 'failed'; message: string };

export interface IntentBlockActivationResult {
    entryId: string;
    blockId: string;
    outcome: IntentBlockActivationOutcome;
}

/** The minimal `IntentBlockService` surface this module needs -- narrowed so a test double
 * only has to implement two methods instead of the whole class. */
export type IntentBlockActivationServiceDependency = Pick<IntentBlockService, 'getHeaderState' | 'save'>;

/**
 * Materializes every entry in `plan.intentBlocks` (if any) as a real `IntentBlock` revision.
 * One entry's failure -- a stale revision, a missing `TrainingIntentProfile`, a transient
 * Firestore error -- is caught and reported for that entry only; it never blocks the rest,
 * matching `IntentBlockService.getActiveBlocks`'s own "one corrupted block must never blank
 * out every other block" resilience discipline. Returns `[]` immediately for a plan with no
 * `intentBlocks` (absence retains the inherited v4 contract unchanged).
 */
export async function activateIntentBlocksFromPlan(
    userId: string,
    plan: ExternalTrainingPlanV5,
    service: IntentBlockActivationServiceDependency = intentBlockService,
): Promise<IntentBlockActivationResult[]> {
    const entries = plan.intentBlocks ?? [];
    if (entries.length === 0) return [];

    const sourceRef = `${plan.planId}@${plan.revision}`;

    return Promise.all(entries.map(async (entry): Promise<IntentBlockActivationResult> => {
        const blockId = externalIntentBlockId(plan.planId, entry.id);
        try {
            const headerState = await service.getHeaderState(userId, blockId);
            const existingRevision = headerState.status === 'AVAILABLE' ? headerState.data.revision : 0;
            const block = resolveExternalIntentBlock(
                { planId: plan.planId, revision: plan.revision, startDate: plan.startDate },
                entry,
                existingRevision + 1,
            );
            // The resolved block's own id must be the namespaced `blockId`, not the plan-scoped
            // authored `entry.id` -- `IntentBlockService` keys storage by `block.id`.
            const header = await service.save(
                userId,
                { ...block, id: blockId },
                { sourceSchemaVersion: EXTERNAL_INTENT_BLOCK_SOURCE_SCHEMA_VERSION, sourceRef },
            );
            return { entryId: entry.id, blockId, outcome: { status: 'saved', header } };
        } catch (error: unknown) {
            return { entryId: entry.id, blockId, outcome: { status: 'failed', message: getErrorMessage(error) } };
        }
    }));
}
