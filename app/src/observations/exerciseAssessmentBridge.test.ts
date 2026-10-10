import { describe, expect, it } from 'vitest';
import {
    EXERCISE_ASSESSMENT_BRIDGES,
    getAssessmentProtocolForExercise,
    getExerciseForAssessmentProtocol,
    isExerciseAssessmentBridgeProtocol,
} from './exerciseAssessmentBridge';

describe('exerciseAssessmentBridge (#897 WP8.1)', () => {
    it('maps bench press to strength-bench-press-1rm for strength_1rm_kg', () => {
        expect(getAssessmentProtocolForExercise('bench_press', 'strength_1rm_kg')).toBe('strength-bench-press-1rm');
        expect(getExerciseForAssessmentProtocol('strength-bench-press-1rm')).toBe('bench_press');
        expect(isExerciseAssessmentBridgeProtocol('strength-bench-press-1rm')).toBe(true);
    });

    it('maps back squat to strength-back-squat-1rm for strength_1rm_kg', () => {
        expect(getAssessmentProtocolForExercise('back_squat', 'strength_1rm_kg')).toBe('strength-back-squat-1rm');
        expect(getExerciseForAssessmentProtocol('strength-back-squat-1rm')).toBe('back_squat');
        expect(isExerciseAssessmentBridgeProtocol('strength-back-squat-1rm')).toBe(true);
    });

    it('returns null for exercises without an assessment protocol', () => {
        expect(getAssessmentProtocolForExercise('conventional_deadlift', 'strength_1rm_kg')).toBeNull();
        expect(getAssessmentProtocolForExercise('front_squat', 'strength_1rm_kg')).toBeNull();
        expect(getAssessmentProtocolForExercise('unknown_exercise', 'strength_1rm_kg')).toBeNull();
    });

    it('returns null for metrics other than strength_1rm_kg', () => {
        expect(getAssessmentProtocolForExercise('bench_press', 'bench_press_mean_velocity_mps')).toBeNull();
        expect(getAssessmentProtocolForExercise('back_squat', 'back_squat_mean_velocity_mps')).toBeNull();
    });

    it('returns null for unknown protocol ids', () => {
        expect(getExerciseForAssessmentProtocol('field-standing-broad-jump')).toBeNull();
        expect(isExerciseAssessmentBridgeProtocol('field-standing-broad-jump')).toBe(false);
    });

    it('enforces 1:1 bidirectional mapping across all registered bridges', () => {
        const exercises = new Set<string>();
        const protocols = new Set<string>();
        for (const bridge of EXERCISE_ASSESSMENT_BRIDGES) {
            expect(exercises.has(bridge.exerciseId)).toBe(false);
            expect(protocols.has(bridge.protocolId)).toBe(false);
            exercises.add(bridge.exerciseId);
            protocols.add(bridge.protocolId);
            expect(getAssessmentProtocolForExercise(bridge.exerciseId, bridge.metricId)).toBe(bridge.protocolId);
            expect(getExerciseForAssessmentProtocol(bridge.protocolId)).toBe(bridge.exerciseId);
        }
    });
});
