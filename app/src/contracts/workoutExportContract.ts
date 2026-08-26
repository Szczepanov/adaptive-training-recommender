/* eslint-disable @typescript-eslint/no-explicit-any -- validating untrusted raw export payloads, matching engine/validationCore.ts's own convention */

export interface WorkoutExportContractResult {
    valid: boolean;
    errors: string[];
}

/**
 * Validates the real cross-language wire shape that crosses into Python:
 * `CanonicalWorkoutExport` (app/src/utils/workoutJsonExport.ts), which is what
 * `GarminQueuedWorkout.payload` holds and what `src/garmin_sync/workout_export.py`
 * actually reads (`title`, `workoutId`, `blocks[].role`, `steps[].durationSeconds`,
 * `steps[].targets` as a string array). This is distinct from the catalog's own
 * `WorkoutDefinition` shape (see `validateCatalogWorkoutStructure` below), which is
 * authoring-time only and never crosses the export boundary as-is.
 */
export function validateCanonicalWorkoutExportContract(payload: unknown): WorkoutExportContractResult {
    const errors: string[] = [];
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return { valid: false, errors: ['CanonicalWorkoutExport must be a non-null object'] };
    }

    const w = payload as Record<string, any>;
    if (w.schemaVersion !== 'canonical_workout_v1') {
        errors.push('schemaVersion must be \'canonical_workout_v1\', got ' + w.schemaVersion);
    }
    if (typeof w.title !== 'string' || !w.title.trim()) errors.push('title is required');
    if (typeof w.workoutId !== 'string' || !w.workoutId.trim()) errors.push('workoutId is required');
    if (typeof w.modality !== 'string' || !w.modality.trim()) errors.push('modality is required');

    if (!Array.isArray(w.blocks) || w.blocks.length === 0) {
        errors.push('blocks must be a non-empty array');
        return { valid: errors.length === 0, errors };
    }

    for (let bIdx = 0; bIdx < w.blocks.length; bIdx++) {
        const block = w.blocks[bIdx];
        if (!block || typeof block.role !== 'string' || !block.role.trim()) {
            errors.push('block[' + bIdx + '] must have a non-empty role');
        }
        if (!block || !Array.isArray(block.steps) || block.steps.length === 0) {
            errors.push('block[' + bIdx + '] must contain at least one step');
            continue;
        }
        for (let sIdx = 0; sIdx < block.steps.length; sIdx++) {
            const step = block.steps[sIdx];
            const where = 'block[' + bIdx + '].step[' + sIdx + ']';
            if (!step || typeof step.name !== 'string' || !step.name.trim()) {
                errors.push(where + ' must have a non-empty name');
            }
            // workout_export.py's _build_step_dto falls back to a 300s default
            // whenever durationSeconds is absent, and _resolve_end_condition only
            // honors repetitions for strength modality -- so every non-strength
            // step needs a real durationSeconds to avoid silently syncing as a
            // fixed 5-minute block, and every strength step needs either
            // repetitions or durationSeconds.
            const isStrength = typeof w.modality === 'string' && w.modality.toLowerCase() === 'strength';
            const hasDuration = typeof step?.durationSeconds === 'number' && step.durationSeconds > 0;
            const hasRepetitions = typeof step?.repetitions === 'number' && step.repetitions > 0;
            if ((!isStrength && !hasDuration) || (isStrength && !hasDuration && !hasRepetitions)) {
                errors.push(where + ' must specify durationSeconds or repetitions (workout_export.py otherwise fabricates a 300s default)');
            }
            if (
                step?.targets !== undefined
                && (!Array.isArray(step.targets) || !step.targets.every((target: unknown) => typeof target === 'string'))
            ) {
                errors.push(where + '.targets must be a string array, not ' + typeof step.targets);
            }
        }
    }

    return { valid: errors.length === 0, errors };
}

/**
 * Validates the persisted `GarminQueuedWorkout` document at
 * `users/{userId}/garmin_workout_queue/{date}` (app/src/services/garminWorkoutQueueService.ts).
 */
export function validateQueuedWorkoutContract(entry: unknown): WorkoutExportContractResult {
    const errors: string[] = [];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        return { valid: false, errors: ['GarminQueuedWorkout must be a non-null object'] };
    }

    const e = entry as Record<string, any>;
    if (typeof e.userId !== 'string' || !e.userId.trim()) errors.push('userId is required');
    if (typeof e.date !== 'string' || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(e.date)) errors.push('date is required (YYYY-MM-DD)');
    if (typeof e.workoutTitle !== 'string' || !e.workoutTitle.trim()) errors.push('workoutTitle is required');
    if (typeof e.modality !== 'string' || !e.modality.trim()) errors.push('modality is required');
    if (!['pending', 'synced', 'failed'].includes(e.status)) {
        errors.push('status must be pending, synced, or failed, got ' + e.status);
    }
    if (typeof e.queuedAt !== 'string' || !e.queuedAt.trim()) errors.push('queuedAt ISO timestamp is required');

    if (e.payload !== undefined) {
        const payloadResult = validateCanonicalWorkoutExportContract(e.payload);
        if (!payloadResult.valid) {
            errors.push(...payloadResult.errors.map((err) => 'payload.' + err));
        }
    }

    return { valid: errors.length === 0, errors };
}

/**
 * Validates the app's own authoring-time `WorkoutDefinition` catalog shape
 * (app/src/workouts/catalog). This is upstream of export -- catalog entries get
 * adapted into a `CanonicalWorkoutExport` (via `exportWorkoutPrescriptionToJson`
 * or similar) before they ever reach `workout_export.py` -- so this check catches
 * malformed catalog authoring, not export-boundary drift. Use
 * `validateCanonicalWorkoutExportContract` for the actual cross-language contract.
 */
export function validateCatalogWorkoutStructure(workout: unknown): WorkoutExportContractResult {
    const errors: string[] = [];
    if (!workout || typeof workout !== 'object' || Array.isArray(workout)) {
        return { valid: false, errors: ['WorkoutDefinition must be a non-null object'] };
    }

    const w = workout as Record<string, any>;
    if (typeof w.id !== 'string' || !w.id.trim()) errors.push('workout.id is required');
    if (typeof w.name !== 'string' || !w.name.trim()) errors.push('workout.name is required');
    if (typeof w.modality !== 'string' || !w.modality.trim()) errors.push('workout.modality is required');
    if (!Array.isArray(w.blocks) || w.blocks.length === 0) {
        errors.push('workout.blocks must be a non-empty array');
    } else {
        for (let bIdx = 0; bIdx < w.blocks.length; bIdx++) {
            const block = w.blocks[bIdx];
            if (!block || !Array.isArray(block.steps) || block.steps.length === 0) {
                errors.push('block[' + bIdx + '] must contain at least one step');
            } else {
                for (let sIdx = 0; sIdx < block.steps.length; sIdx++) {
                    const step = block.steps[sIdx];
                    if (!step || typeof step !== 'object' || Array.isArray(step)) {
                        errors.push('block[' + bIdx + '].step[' + sIdx + '] must be a non-null object');
                        continue;
                    }
                    if (!step.id || typeof step.id !== 'string') {
                        errors.push('block[' + bIdx + '].step[' + sIdx + '] must have a valid string id');
                    }
                    if (!step.name || typeof step.name !== 'string') {
                        errors.push('block[' + bIdx + '].step[' + sIdx + '] must have a valid string name');
                    }
                    const stepDurationType = step.duration?.type;
                    if (!stepDurationType || !['time', 'distance', 'repetitions', 'open'].includes(stepDurationType)) {
                        errors.push('block[' + bIdx + '].step[' + sIdx + '] has invalid duration type ' + stepDurationType);
                    }
                }
            }
        }
    }

    return { valid: errors.length === 0, errors };
}

/** @deprecated Use {@link validateCatalogWorkoutStructure} — kept as an alias during migration. */
export const validateWorkoutDefinitionForExport = validateCatalogWorkoutStructure;
