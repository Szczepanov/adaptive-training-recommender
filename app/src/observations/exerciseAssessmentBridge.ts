import { BACK_SQUAT_1RM_PROTOCOL, BENCH_PRESS_1RM_PROTOCOL } from './physicalCapitalProtocols';

/**
 * Reviewed bridge mapping bundled strength 1RM assessment protocols to canonical
 * exercise catalog identities (Issue #897 WP8.1, ADR-0041).
 *
 * Squat and bench assessments both emit the shared metric `strength_1rm_kg`.
 * Protocol identity alone does not establish canonical exercise identity, so
 * this explicit bridge binds each protocol to its exact matching exercise subject
 * to prevent movement cross-contamination.
 */
export interface ExerciseAssessmentBridge {
    exerciseId: string;
    protocolId: string;
    metricId: 'strength_1rm_kg';
}

export const EXERCISE_ASSESSMENT_BRIDGES: readonly ExerciseAssessmentBridge[] = [
    {
        exerciseId: 'bench_press',
        protocolId: BENCH_PRESS_1RM_PROTOCOL.id,
        metricId: 'strength_1rm_kg',
    },
    {
        exerciseId: 'back_squat',
        protocolId: BACK_SQUAT_1RM_PROTOCOL.id,
        metricId: 'strength_1rm_kg',
    },
] as const;

export function getAssessmentProtocolForExercise(exerciseId: string, metricId: string): string | null {
    if (metricId !== 'strength_1rm_kg') return null;
    const match = EXERCISE_ASSESSMENT_BRIDGES.find(
        bridge => bridge.exerciseId === exerciseId && bridge.metricId === metricId,
    );
    return match?.protocolId ?? null;
}

export function getExerciseForAssessmentProtocol(protocolId: string): string | null {
    const match = EXERCISE_ASSESSMENT_BRIDGES.find(bridge => bridge.protocolId === protocolId);
    return match?.exerciseId ?? null;
}

export function isExerciseAssessmentBridgeProtocol(protocolId: string): boolean {
    return EXERCISE_ASSESSMENT_BRIDGES.some(bridge => bridge.protocolId === protocolId);
}
