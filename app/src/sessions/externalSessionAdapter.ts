import type { ExternalPlanSession } from '../engine/models';
import type {
    SessionDefinition,
    SessionBlock,
    SessionStep,
    SessionIntent,
    SessionDose,
} from './models';

export function adaptExternalPrescriptionStepToSessionStep(
    step: {
        name: string;
        target?: string;
        durationMin?: number;
        durationSec?: number;
        repeat?: number;
        sets?: number;
        notes?: string;
    },
    index: number,
): SessionStep {
    let dose: SessionDose | undefined;

    if (step.repeat !== undefined) {
        dose = {
            kind: 'repetition',
            sets: step.sets || 1,
            reps: step.repeat,
        };
    } else if (step.durationSec !== undefined) {
        dose = {
            kind: 'duration',
            sets: step.sets || 1,
            seconds: step.durationSec,
        };
    } else if (step.durationMin !== undefined) {
        dose = {
            kind: 'duration',
            sets: step.sets || 1,
            seconds: step.durationMin * 60,
        };
    }

    return {
        id: `step-${index + 1}`,
        kind: 'exercise',
        title: step.name,
        exerciseRef: {
            kind: 'unresolved_free_text',
            name: step.name,
        },
        ...(dose ? { dose } : {}),
        ...(step.notes ? { notes: step.notes } : {}),
    };
}

export function adaptExternalPlanSessionToSessionDefinition(
    session: ExternalPlanSession,
    revision = 1,
): SessionDefinition {
    const intent: SessionIntent =
        session.gating.modality === 'mobility'
            ? 'recovery'
            : session.isEvent
              ? 'competition'
              : 'training';

    const steps: SessionStep[] = session.prescription.steps
        ? session.prescription.steps.map((s, idx) => adaptExternalPrescriptionStepToSessionStep(s, idx))
        : [
              {
                  id: 'step-1',
                  kind: 'exercise',
                  title: session.title,
                  exerciseRef: {
                      kind: 'unresolved_free_text',
                      name: session.title,
                  },
                  notes: session.prescription.summary,
              },
          ];

    const block: SessionBlock = {
        id: 'block-main',
        title: 'Main',
        role: 'main',
        executionMode: 'sequential',
        steps,
    };

    return {
        schemaVersion: 1,
        id: session.id,
        revision,
        title: session.title,
        summary: session.prescription.summary,
        intent,
        dominantModality: session.gating.modality,
        duration: {
            min: session.gating.durationMin,
            max: session.gating.durationMax,
        },
        blocks: [block],
    };
}
