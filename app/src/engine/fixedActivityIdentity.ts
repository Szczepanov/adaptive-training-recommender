import { WORKOUTS_BY_ID } from '../workouts/catalog';
import { workoutForTemplate } from '../workouts/prescription';
import { ENRICHED_TEMPLATES_BY_ID } from './templates';
import { getUniqueTemplateIdForWorkoutId } from './workoutTemplateIndex';
import type { FixedActivity, SessionTemplate } from './models';
import type { StimulusConfidence } from './stimulus';

/**
 * Phase 6.2c / ADR-0016 integration boundary.
 *
 * FixedActivity predates exact catalog identity. These optional fields are persisted when
 * a booked activity is intended to behave like a known authored workout for scoped
 * stimulus and weekly-role credit.
 *
 * ADR-0019 adds one transient-only identity shape for an imported event. It is deliberately
 * not a catalog link and is never persisted: the event plan knows its modality/category,
 * but its stimulus was derived rather than authored against this catalog, so objective
 * credit must retain `inferred` confidence instead of masquerading as exact.
 */
declare module './models' {
    interface FixedActivity {
        /** Exact coarse engine template that the booked activity represents. */
        templateId?: string;
        /** Exact detailed workout identity. When both ids exist they must resolve to the
         * same prescription; otherwise identity fails closed. */
        workoutId?: string;
        /** Transient ADR-0019 identity for an imported `isEvent` commitment. Never stored. */
        externalAuthoredIdentity?: {
            modality: SessionTemplate['modality'];
            category: SessionTemplate['category'];
            stimulusConfidence: 'inferred';
        };
    }
}

export interface ResolvedFixedActivityIdentity {
    occurrenceKey: string;
    templateId: string;
    workoutId: string;
    modality: SessionTemplate['modality'];
    category: SessionTemplate['category'];
    /** False for legacy anonymous activities and externally-authored event commitments. */
    exactCatalogIdentity: boolean;
    /** Defaults to exact when absent. External-authored events explicitly carry inferred. */
    stimulusConfidence?: StimulusConfidence;
}

export function fixedActivityOccurrenceKey(activity: Pick<FixedActivity, 'id'>): string {
    return `fixed:${activity.id}`;
}

/**
 * Resolve a fixed activity for objective-credit bookkeeping.
 *
 * - Supplied template/workout ids must resolve exactly and consistently.
 * - An imported event can carry transient modality/category identity plus inferred
 *   confidence. This is sufficient for scoped objective credit but never for catalog
 *   coverage, because its sentinel ids cannot resolve to a catalog workout.
 * - A legacy activity with neither identity gets an unlinked sentinel. This preserves
 *   backward-compatible credit for genuinely unscoped objectives while modality-scoped
 *   objectives fail because its modality is `None`.
 * - No title/category heuristic is ever used.
 */
export function resolveFixedActivityIdentity(activity: FixedActivity): ResolvedFixedActivityIdentity | null {
    const declaredTemplateId = activity.templateId;
    const declaredWorkoutId = activity.workoutId;
    const external = activity.externalAuthoredIdentity;

    // An activity cannot claim both an exact catalog link and external-derived identity.
    if (external && (declaredTemplateId || declaredWorkoutId)) return null;
    if (external) {
        return {
            occurrenceKey: fixedActivityOccurrenceKey(activity),
            templateId: activity.id,
            workoutId: `external:${activity.id}`,
            modality: external.modality,
            category: external.category,
            exactCatalogIdentity: false,
            stimulusConfidence: external.stimulusConfidence,
        };
    }

    if (!declaredTemplateId && !declaredWorkoutId) {
        return {
            occurrenceKey: fixedActivityOccurrenceKey(activity),
            templateId: activity.id,
            workoutId: `unlinked:${activity.id}`,
            modality: 'None',
            category: 'Rest',
            exactCatalogIdentity: false,
        };
    }

    if (declaredTemplateId) {
        const template = ENRICHED_TEMPLATES_BY_ID.get(declaredTemplateId);
        const resolvedWorkout = workoutForTemplate(declaredTemplateId);
        if (!template || !resolvedWorkout) return null;
        if (declaredWorkoutId && declaredWorkoutId !== resolvedWorkout.id) return null;
        return {
            occurrenceKey: fixedActivityOccurrenceKey(activity),
            templateId: declaredTemplateId,
            workoutId: resolvedWorkout.id,
            modality: template.modality,
            category: template.category,
            exactCatalogIdentity: true,
        };
    }

    const candidate = declaredWorkoutId ? WORKOUTS_BY_ID.get(declaredWorkoutId) : undefined;
    const workout = candidate && candidate.status === 'active' && !candidate.manualOnly
        ? candidate
        : undefined;
    const templateId = workout ? getUniqueTemplateIdForWorkoutId(workout.id) : undefined;
    const template = templateId ? ENRICHED_TEMPLATES_BY_ID.get(templateId) : undefined;
    if (!workout || !template) return null;
    return {
        occurrenceKey: fixedActivityOccurrenceKey(activity),
        templateId: template.id,
        workoutId: workout.id,
        modality: template.modality,
        category: template.category,
        exactCatalogIdentity: true,
    };
}

/** Persistence accepts an identity field only when it is a real catalog link; the legacy
 * anonymous and external sentinels exist solely inside the engine and are never written. */
export function hasExactFixedActivityCatalogIdentity(activity: FixedActivity): boolean {
    return resolveFixedActivityIdentity(activity)?.exactCatalogIdentity === true;
}
