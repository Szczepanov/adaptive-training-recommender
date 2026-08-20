/**
 * Source-neutral multidomain session models (ADR-0023).
 *
 * `SessionDefinition` is the single normalized executable-content contract.
 * Definitions, occurrences, execution prescriptions, and performed executions
 * have distinct lifecycles and ownership (D-MRECORDS).
 */

import type { IntensityGauge } from '../engine/models';

export const SESSION_SCHEMA_VERSION = 1;

export type SessionIntent =
    | 'training'
    | 'testing'
    | 'competition'
    | 'rehab_return'
    | 'recovery'
    | 'skill_technical';

export type SessionSourceRef =
    | { kind: 'catalog'; workoutId: string; catalogVersion: string }
    | { kind: 'external_plan'; planId: string; revision: number; sessionId: string; contentHash: string }
    | { kind: 'manual'; definitionId: string; revision: number; contentHash: string }
    | { kind: 'unplanned_fixture'; fixtureId: string };

export interface SessionReferenceBinding {
    sessionSource: SessionSourceRef;
    occurrenceId?: string;
    prescriptionHash: string;
}

export type ExerciseRef =
    | { kind: 'catalog'; exerciseId: string }
    | { kind: 'unresolved_free_text'; name: string };

export interface NumericRange {
    min: number;
    max: number;
}

export type RangeOrNumber = NumericRange | number;

export type RepetitionDose = {
    kind: 'repetition';
    sets: number;
    reps: RangeOrNumber;
};

export type DurationDose = {
    kind: 'duration';
    sets?: number;
    seconds: RangeOrNumber;
};

export type DistanceDose = {
    kind: 'distance';
    sets?: number;
    meters?: RangeOrNumber;
    metres?: RangeOrNumber;
    targetSplitSeconds?: number;
};

export type CheckoffDose = {
    kind: 'checkoff';
    rounds?: number;
};

export type SessionDose =
    | RepetitionDose
    | DurationDose
    | DistanceDose
    | CheckoffDose;

export type BodyweightLoad = { kind: 'bodyweight' };
export type MassLoad = { kind: 'mass'; kg: RangeOrNumber };
export type BandLoad = { kind: 'band'; bandColor: string };
export type PercentMaxLoad = { kind: 'percent_max'; percent: number; exerciseId?: string };
export type PercentOneRmLoad = { kind: 'percent_one_rm'; percent: number; exerciseId?: string };
export type RelativeStepLoad = { kind: 'relative_step'; stepId: string; percent: number };
export type DescriptiveLoad = { kind: 'descriptive'; display?: string; description?: string };
export type UnloadedLoad = { kind: 'unloaded' };

export type SessionLoad =
    | BodyweightLoad
    | MassLoad
    | BandLoad
    | PercentMaxLoad
    | PercentOneRmLoad
    | RelativeStepLoad
    | DescriptiveLoad
    | UnloadedLoad;

export interface SessionEffort {
    kind?: string;
    target?: RangeOrNumber;
    rpe?: RangeOrNumber;
    rir?: RangeOrNumber;
}

export interface SessionQuality {
    kind?: string;
    maxLossPercent?: number;
    velocityLossPercentCap?: number;
    technicalStop?: boolean;
}

export type SessionChoiceAction =
    | { kind: 'select_alternative'; targetStepId: string; alternativeId: string }
    | { kind: 'reduce_load_percent'; targetStepId: string; percent: number }
    | { kind: 'reduce_sets'; targetStepId: string; sets: number }
    | { kind: 'reduce_reps'; targetStepId: string; reps: number }
    | { kind: 'omit_step'; targetStepId: string }
    | { kind: 'end_block'; targetBlockId: string }
    | { kind: 'end_session' };

export interface SessionOption {
    id: string;
    label: string;
    actions: SessionChoiceAction[];
}

export interface SessionChoice {
    id: string;
    appliesAtStepId: string;
    trigger: {
        kind: 'athlete_observed';
        description: string;
    };
    options: SessionOption[];
}

export interface StepAlternative {
    id: string;
    title: string;
    exerciseRef: ExerciseRef;
    dose?: SessionDose;
    load?: SessionLoad;
}

export type StepLaterality = 'bilateral' | 'per_side' | 'alternating';

export interface SessionStep {
    id: string;
    kind: 'exercise' | 'transition' | 'rest';
    title?: string;
    exerciseRef?: ExerciseRef;
    dose?: SessionDose;
    load?: SessionLoad;
    effort?: SessionEffort;
    quality?: SessionQuality;
    rest?: RangeOrNumber;
    tempo?: string;
    laterality?: StepLaterality;
    optional?: boolean;
    alternatives?: StepAlternative[];
    notes?: string;
    /** Explicit technical or safety stop conditions shown to the athlete; no automatic evaluation. */
    stopConditions?: string[];
    resolutionNote?: string;
}

export type BlockRole =
    | 'warmup'
    | 'main'
    | 'cooldown'
    | 'accessory'
    | 'test'
    | 'recovery';

export type BlockExecutionMode =
    | 'sequential'
    | 'circuit'
    | 'superset'
    | 'density'
    | 'amrap'
    | 'alternating';

export interface SessionBlock {
    id: string;
    title?: string;
    role: BlockRole;
    executionMode: BlockExecutionMode;
    rounds?: RangeOrNumber;
    optionSets?: SessionChoice[];
    steps: SessionStep[];
}

export interface SessionDefinition {
    schemaVersion: number;
    id: string;
    revision: number;
    title: string;
    summary?: string;
    intent: SessionIntent;
    modalities?: string[];
    dominantModality?: string;
    duration?: NumericRange;
    defaultScheduledDate?: string;
    sessionTargets?: Array<{ kind: string; [key: string]: unknown }>;
    prohibitedAdditions?: string[];
    importWarnings?: string[];
    /** Separately executable session references; the runner never treats them as embedded work. */
    companionSessions?: Array<{
        id: string;
        definitionRef: string;
        relation: string;
        optional?: boolean;
        notEarlierThanMinutesAfter?: number;
        note?: string;
    }>;
    blocks: SessionBlock[];
}

export type OccurrenceAuthority =
    | 'unplanned_log'
    | 'schedule'
    | 'replace_recommendation'
    | 'additional_session';

export type OccurrenceState =
    | 'scheduled'
    | 'active'
    | 'superseded'
    | 'completed'
    | 'abandoned'
    | 'missed';

export interface SessionOccurrence {
    userId: string;
    occurrenceId: string;
    date: string;
    authority: OccurrenceAuthority;
    definitionRef: {
        definitionId: string;
        revision: number;
        contentHash: string;
    };
    state: OccurrenceState;
    placementOrder?: number;
    createdAt: string;
    updatedAt: string;
}

/**
 * The non-`blocks` fields `definitionHash` was computed over (M3.2), snapshotted so a
 * `catalog` source can be replayed with historical fidelity: the live catalog entry a
 * `SessionSourceRef` points at can be edited (title, duration, ...) after the day it was
 * prescribed, but the hash alone can't be inverted back into the original values. Optional
 * because prescriptions written before this field existed don't have it -- resolvers must
 * fall back to the live catalog for those, exactly as before.
 */
export interface SessionDisplayMetadata {
    title: string;
    summary?: string;
    intent: SessionIntent;
    dominantModality?: string;
    duration?: NumericRange;
}

export interface ExecutionPrescription {
    schemaVersion: number;
    prescriptionHash: string;
    /** Immutable source identity, covered by `prescriptionHash`. */
    sessionSource: SessionSourceRef;
    definitionHash: string;
    blocks: SessionBlock[];
    displayMetadata?: SessionDisplayMetadata;
    createdAt: string;
}

export type SessionExecutionState =
    | 'in_progress'
    | 'completed'
    | 'abandoned';

export interface SessionExecution {
    userId: string;
    executionId: string;
    occurrenceId?: string;
    sessionSource: SessionSourceRef;
    prescriptionHash?: string;
    date: string;
    startedAt: string;
    completedAt?: string | null;
    updatedAt: string;
    state: SessionExecutionState;
    sessionRpe?: number;
    notes?: string;
    schemaVersion: number;
}

export type RepetitionEntryPayload = {
    kind: 'repetition';
    setIndex: number;
    reps: number;
    weightKg?: number;
    isWarmup?: boolean;
    gauge?: IntensityGauge;
};

export type DurationEntryPayload = {
    kind: 'duration';
    seconds: number;
    loadKg?: number;
    position?: string;
};

export type DistanceEntryPayload = {
    kind: 'distance';
    meters: number;
    durationSeconds?: number;
};

export type SprintEntryPayload = {
    kind: 'sprint';
    meters: number;
    splitSeconds: number;
    surface?: string;
};

export type JumpAttemptEntryPayload = {
    kind: 'jump_attempt';
    attemptIndex: number;
    heightInches?: number;
    distanceMeters?: number;
};

export type CheckoffEntryPayload = {
    kind: 'checkoff';
    roundIndex?: number;
    completed: boolean;
};

/**
 * Records an athlete's answer to an authored `SessionChoice` (D-MCHOICE): the option
 * selected, and an optional reason. This is the execution event itself, not a performed
 * set -- callers that count performed work per step (`groupProgression.ts`,
 * `performedComparison.ts`) must exclude this payload kind from that accounting.
 */
export type ChoiceEntryPayload = {
    kind: 'choice';
    choiceId: string;
    optionId: string;
    reason?: string;
};

export type SessionEntryPayload =
    | RepetitionEntryPayload
    | DurationEntryPayload
    | DistanceEntryPayload
    | SprintEntryPayload
    | JumpAttemptEntryPayload
    | CheckoffEntryPayload
    | ChoiceEntryPayload;

export interface SessionEntry {
    id: string;
    executionId: string;
    stepId?: string;
    exerciseRef?: ExerciseRef;
    side?: 'left' | 'right' | 'bilateral';
    selectedOptionId?: string;
    completedAt: string;
    createdAt: string;
    updatedAt: string;
    payload: SessionEntryPayload;
}
