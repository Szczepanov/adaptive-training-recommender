import type { WorkoutPrescription, PrescriptionBlock, PrescriptionStep, WorkoutBlock, WorkoutStep } from '../workouts/models';
import { WORKOUTS } from '../workouts/catalog';
import type {
    SessionDefinition,
    SessionBlock,
    SessionStep,
    ExecutionPrescription,
    BlockRole,
    SessionIntent,
    SessionDose,
} from './models';
import { hashExecutionPrescription } from './sessionDefinitionHash';

function mapBlockRole(role: string): BlockRole {
    switch (role) {
        case 'warmup':
            return 'warmup';
        case 'cooldown':
            return 'cooldown';
        case 'main':
            return 'main';
        case 'accessory':
            return 'accessory';
        default:
            return 'main';
    }
}

export function parsePrescriptionDose(doseStr: string): SessionDose | undefined {
    const trimmed = doseStr.trim().toLowerCase();

    // Check for "X sets × Y reps", "X × Y reps", "X x Y-Z fast repetitions", "X x Y-Z"
    const repsMatch = trimmed.match(/(\d+)\s*(?:sets\s*)?[x×]\s*(\d+)(?:\s*[-–]\s*(\d+))?\s*(?:fast\s*)?(?:reps?|repetitions?)?/i);
    if (repsMatch) {
        const sets = parseInt(repsMatch[1], 10);
        const minReps = parseInt(repsMatch[2], 10);
        const maxReps = repsMatch[3] ? parseInt(repsMatch[3], 10) : minReps;
        return {
            kind: 'repetition',
            sets,
            reps: minReps === maxReps ? minReps : { min: minReps, max: maxReps },
        };
    }

    // Check for "X-Y reps" or "X reps"
    const singleRepsMatch = trimmed.match(/^(\d+)(?:\s*[-–]\s*(\d+))?\s*(?:fast\s*)?(?:reps?|repetitions?)/i);
    if (singleRepsMatch) {
        const minReps = parseInt(singleRepsMatch[1], 10);
        const maxReps = singleRepsMatch[2] ? parseInt(singleRepsMatch[2], 10) : minReps;
        return {
            kind: 'repetition',
            sets: 1,
            reps: minReps === maxReps ? minReps : { min: minReps, max: maxReps },
        };
    }

    // Check for "X sec" or "X min"
    const secMatch = trimmed.match(/(\d+)\s*sec/i);
    if (secMatch) {
        return {
            kind: 'duration',
            seconds: parseInt(secMatch[1], 10),
        };
    }

    const minMatch = trimmed.match(/(\d+(?:\.\d+)?)\s*min/i);
    if (minMatch) {
        return {
            kind: 'duration',
            seconds: Math.round(parseFloat(minMatch[1]) * 60),
        };
    }

    // Check for meters
    const meterMatch = trimmed.match(/(\d+)\s*m\b/i);
    if (meterMatch) {
        return {
            kind: 'distance',
            meters: parseInt(meterMatch[1], 10),
        };
    }

    return undefined;
}

export function adaptCatalogPrescriptionStep(step: PrescriptionStep): SessionStep {
    const dose = parsePrescriptionDose(step.dose);
    return {
        id: step.id,
        kind: 'exercise',
        title: step.name,
        exerciseRef: {
            kind: 'catalog',
            exerciseId: step.id.replace(/-step.*$/, ''),
        },
        ...(dose ? { dose } : {}),
        ...(step.optional ? { optional: true } : {}),
        ...(step.cues && step.cues.length > 0 ? { notes: step.cues.join('; ') } : {}),
    };
}

export function adaptCatalogPrescriptionBlock(block: PrescriptionBlock): SessionBlock {
    return {
        id: block.id,
        title: block.name,
        role: mapBlockRole(block.role),
        executionMode: 'sequential',
        steps: block.steps.map(adaptCatalogPrescriptionStep),
    };
}

function doseFromWorkoutStep(step: WorkoutStep): SessionDose | undefined {
    if (step.duration.type === 'repetitions') {
        return { kind: 'repetition', sets: step.sets ?? 1, reps: step.duration.repetitions };
    }
    if (step.duration.type === 'time') {
        return { kind: 'duration', ...(step.sets ? { sets: step.sets } : {}), seconds: step.duration.seconds };
    }
    if (step.duration.type === 'distance') {
        return { kind: 'distance', ...(step.sets ? { sets: step.sets } : {}), meters: step.duration.meters };
    }
    return undefined;
}

function adaptCatalogWorkoutStep(step: WorkoutStep, display?: PrescriptionStep): SessionStep {
    const technicalStopConditions = step.target?.type === 'technical_quality'
        ? step.target.stopConditions
        : undefined;
    return {
        id: step.id,
        kind: 'exercise',
        title: step.name,
        exerciseRef: { kind: 'catalog', exerciseId: step.exerciseId },
        ...(doseFromWorkoutStep(step) ? { dose: doseFromWorkoutStep(step) } : {}),
        ...(step.restAfterSec !== undefined ? { rest: step.restAfterSec } : {}),
        ...(step.target?.type === 'rpe' ? { effort: { rpe: { min: step.target.min, max: step.target.max } } } : {}),
        ...(step.target?.type === 'reps_in_reserve' ? { effort: { rir: { min: step.target.min, max: step.target.max } } } : {}),
        ...(step.optional ? { optional: true } : {}),
        ...(display?.cues?.length || step.notes?.length ? { notes: [...(display?.cues ?? []), ...(step.notes ?? [])].join('; ') } : {}),
        ...(technicalStopConditions?.length ? { stopConditions: technicalStopConditions } : {}),
    };
}

function adaptCatalogWorkoutBlock(block: WorkoutBlock, displayById: ReadonlyMap<string, PrescriptionStep>): SessionBlock {
    return {
        id: block.id,
        title: block.name,
        role: mapBlockRole(block.role),
        executionMode: 'sequential',
        steps: block.steps.map(step => adaptCatalogWorkoutStep(step, displayById.get(step.id))),
    };
}

export function adaptCatalogPrescriptionToSessionDefinition(
    prescription: WorkoutPrescription,
): SessionDefinition {
    const workout = WORKOUTS.find(w => w.id === prescription.workoutId);
    const modality = workout?.modality;

    const intent: SessionIntent =
        modality === 'recovery' || modality === 'mobility'
            ? 'recovery'
            : 'training';

    const displayById = new Map(
        prescription.displayBlocks.flatMap(block => block.steps.map(step => [step.id, step] as const)),
    );
    // adjustedBlocks is the evaluated prescription.  Do not parse display strings back
    // into dose: it loses source identity and silently changes the executed content.
    const blocks = prescription.adjustedBlocks.map(block => adaptCatalogWorkoutBlock(block, displayById));

    return {
        schemaVersion: 1,
        id: prescription.workoutId,
        revision: 1,
        title: workout?.name ?? prescription.workoutId,
        summary: workout?.description ?? '',
        intent,
        ...(modality ? { dominantModality: modality } : {}),
        duration: {
            min: prescription.targetDurationMin ?? workout?.duration.minimumMin ?? 30,
            max: prescription.targetDurationMin ?? workout?.duration.maximumMin ?? 30,
        },
        blocks,
    };
}

export async function createExecutionPrescriptionFromCatalog(
    prescription: WorkoutPrescription,
    definitionHash: string,
): Promise<ExecutionPrescription> {
    const sessionDef = adaptCatalogPrescriptionToSessionDefinition(prescription);
    const now = new Date().toISOString();
    const draft: ExecutionPrescription = {
        schemaVersion: 1,
        prescriptionHash: '',
        sessionSource: {
            kind: 'catalog',
            workoutId: prescription.workoutId,
            catalogVersion: String(prescription.workoutVersion),
        },
        definitionHash,
        blocks: sessionDef.blocks,
        // Snapshotted as of today's launch (M3.2), so a later edit to this workout's live
        // catalog entry can't rewrite what this recommendation actually displayed/prescribed.
        displayMetadata: {
            title: sessionDef.title,
            ...(sessionDef.summary !== undefined ? { summary: sessionDef.summary } : {}),
            intent: sessionDef.intent,
            ...(sessionDef.dominantModality !== undefined ? { dominantModality: sessionDef.dominantModality } : {}),
            ...(sessionDef.duration !== undefined ? { duration: sessionDef.duration } : {}),
        },
        createdAt: now,
    };
    const hash = await hashExecutionPrescription(draft);
    return {
        ...draft,
        prescriptionHash: hash,
    };
}
