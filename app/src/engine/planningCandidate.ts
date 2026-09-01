import type { Equipment, WorkoutDefinition, WorkoutEnvironment } from '../workouts/models';
import type {
    Modality,
    SessionRole,
    SessionTemplate,
    TrainingEnvironment,
    WorkoutCostProfile,
    WorkoutStimulusProfile,
} from './models';
import { WORKOUTS } from '../workouts/catalog';
import { ENRICHED_TEMPLATES_BY_ID } from './templates';
import { ANCHOR_HISTORY_CATEGORIES } from './optimizer';

/**
 * Phase 5.2: moves the planner/workout-library boundary.
 *
 * Detailed `WorkoutDefinition`s already carry recovery hours, mechanical/eccentric load,
 * coordination demand, technical environment, contraindications, and minimum spacing
 * after hard lower-body work -- but the planner selects a coarse `SessionTemplate` first,
 * so that metadata arrived only *after* the decision it should have informed (see
 * `evaluateRecoveryConstraints` in optimizer.ts, whose hard-lower-body spacing rule was a
 * flat one-day gap with no per-workout data behind it at all). `PlanningCandidate` is
 * enough semantics to sequence a week without dragging every workout step (blocks,
 * variants, parameters) into the planner -- prescription generation
 * (`resolveWorkoutPrescription`) stays downstream and unchanged.
 *
 * This type intentionally lives in engine/, not workouts/models.ts as the plan's own
 * sketch might suggest at first read: workouts/models.ts has zero imports today, and
 * engine/models.ts already imports from it (`AthletePerformanceProfile`,
 * `WorkoutPrescription`). Defining a type that references engine types
 * (`SessionRole`/`Modality`/`WorkoutStimulusProfile`/`WorkoutCostProfile`/
 * `TrainingEnvironment`) inside workouts/models.ts would make that dependency circular.
 */
export interface PlanningCandidate {
    workoutId: string;
    sessionRole: SessionRole;
    modality: Modality;
    durationRange: { min: number; default: number; max: number };
    stimulus: WorkoutStimulusProfile;
    cost: WorkoutCostProfile;
    recoveryHours: number;
    minimumDaysAfterHardLowerBody?: number;
    equipment: Equipment[];
    environment: TrainingEnvironment[];
    contraindications: string[];
}

const ZERO_STIMULUS: WorkoutStimulusProfile = {
    aerobicEndurance: 0, thresholdPower: 0, vo2MaxPower: 0, repeatedSurges: 0,
    sprintPower: 0, fatigueResistance: 0, maxStrength: 0, hypertrophy: 0,
};

const ZERO_COST: WorkoutCostProfile = {
    systemic: 0, cardiovascular: 0, lowerBody: 0, upperBody: 0, impactTissue: 0, neuromuscular: 0,
};

/** `WorkoutEnvironment` (catalog-level: trainer/field/closed_road/low_traffic_road) is
 *  finer-grained than the engine's own `TrainingEnvironment` (indoor/outdoor/either) --
 *  this is the one, explicit mapping between the two vocabularies. */
function toTrainingEnvironment(environment: WorkoutEnvironment): TrainingEnvironment {
    return environment === 'trainer' ? 'indoor' : 'outdoor';
}

/** Static, date-independent role classification -- reuses optimizer.ts's own
 *  `ANCHOR_HISTORY_CATEGORIES` rather than inventing a second anchor definition.
 *  `realizedSessionRole` (planner.ts) is the date/anchor-aware sibling of this; that one
 *  answers "what did this pick become on this specific day", this one answers "what kind
 *  of session is this, independent of any day". */
function staticSessionRole(category: SessionTemplate['category']): SessionRole {
    if (category === 'Rest' || category === 'Mobility/Recovery') return 'recovery';
    return ANCHOR_HISTORY_CATEGORIES.includes(category) ? 'anchor' : 'supporting';
}

/**
 * Derives one `PlanningCandidate` from a catalog `WorkoutDefinition`, resolved against
 * its linked engine `SessionTemplate` (`engineTemplateIds[0]` -- a workout with several
 * linked templates uses the first, same determinism convention as
 * `engineTemplatePriority`'s own doc comment). Returns `null` for a workout with no
 * engine-selectable template at all: it exists in the prescription catalog but the
 * planner itself can never choose it, so it isn't a planning candidate.
 */
export function derivePlanningCandidate(
    workout: WorkoutDefinition,
    templates: readonly SessionTemplate[] | ReadonlyMap<string, SessionTemplate>
): PlanningCandidate | null {
    const templateId = workout.engineTemplateIds?.[0];
    const template = templateId
        ? (templates instanceof Map
            ? templates.get(templateId)
            : (templates as readonly SessionTemplate[]).find(t => t.id === templateId))
        : undefined;
    if (!template) return null;

    const environment: TrainingEnvironment[] = workout.technicalRequirements?.environment.length
        ? Array.from(new Set(workout.technicalRequirements.environment.map(toTrainingEnvironment)))
        : [template.environment];

    return {
        workoutId: workout.id,
        sessionRole: staticSessionRole(template.category),
        modality: template.modality,
        durationRange: {
            min: workout.duration.minimumMin,
            default: workout.duration.defaultMin,
            max: workout.duration.maximumMin,
        },
        stimulus: template.stimulusProfile ?? ZERO_STIMULUS,
        cost: template.costProfile ?? ZERO_COST,
        recoveryHours: workout.loadProfile.recoveryHours,
        ...(workout.eligibility.minimumDaysAfterHardLowerBody !== undefined
            ? { minimumDaysAfterHardLowerBody: workout.eligibility.minimumDaysAfterHardLowerBody }
            : {}),
        equipment: workout.equipment,
        environment,
        contraindications: workout.contraindicationTags,
    };
}

/** Every active workout's `PlanningCandidate`, keyed by its resolved engine template id.
 *  Deprecated/draft workouts are excluded -- the planner can't select them regardless of
 *  what detail they carry. Built once at module load, same convention as
 *  `ENRICHED_TEMPLATES` -- the catalog and template roster are both static data. */
export function buildPlanningCandidateIndex(
    workouts: readonly WorkoutDefinition[],
    templates: readonly SessionTemplate[] | ReadonlyMap<string, SessionTemplate>
): Map<string, PlanningCandidate> {
    const index = new Map<string, PlanningCandidate>();
    const templatesById: ReadonlyMap<string, SessionTemplate> = templates instanceof Map
        ? templates
        : new Map((templates as readonly SessionTemplate[]).map(t => [t.id, t]));
    const workoutsById = new Map(workouts.map(w => [w.id, w]));

    for (const workout of workouts) {
        if (workout.status !== 'active' || workout.manualOnly) continue;
        const candidate = derivePlanningCandidate(workout, templatesById);
        if (!candidate) continue;
        const templateId = workout.engineTemplateIds?.[0];
        if (!templateId) continue;
        // A template already indexed keeps whichever workout comes first in the catalog
        // array unless engineTemplatePriority says otherwise -- the *lower* number wins,
        // ties keep whichever was inserted first. This must match `workoutForTemplate`
        // (prescription.ts), the pre-existing resolver for the same field: two independent
        // "which workout represents this template" answers would otherwise disagree the
        // moment more than one workout links to the same template id.
        const existingWorkout = index.has(templateId)
            ? workoutsById.get(index.get(templateId)!.workoutId)
            : undefined;
        if (existingWorkout && (workout.engineTemplatePriority ?? 1) >= (existingWorkout.engineTemplatePriority ?? 1)) continue;
        index.set(templateId, candidate);
    }
    return index;
}

export const PLANNING_CANDIDATE_INDEX: Map<string, PlanningCandidate> = buildPlanningCandidateIndex(WORKOUTS, ENRICHED_TEMPLATES_BY_ID);

/** Convenience resolver matching optimizer.ts's `OptimizationOptions.resolveMinimumDaysAfterHardLowerBody`
 *  shape -- looks up the per-workout spacing requirement for a given engine template id,
 *  falling back to `undefined` (the existing flat one-day rule) when no detailed workout
 *  declares a stricter one. */
export function resolveMinimumDaysAfterHardLowerBody(templateId: string): number | undefined {
    return PLANNING_CANDIDATE_INDEX.get(templateId)?.minimumDaysAfterHardLowerBody;
}

/** Looks up the declared recovery hours for a given engine template id from the
 *  active catalog's planning candidate index. */
export function resolveRecoveryHoursForTemplate(templateId: string): number | undefined {
    return PLANNING_CANDIDATE_INDEX.get(templateId)?.recoveryHours;
}
