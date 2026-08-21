import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
    adaptNormalizedExecutionToStrengthSession,
    adaptStrengthSessionToNormalizedExecution,
} from './legacyStrengthAdapter';
import type { StrengthSession } from '../engine/models';

describe('M3.4 Strength runner cutover', () => {
    it('keeps one live execution UI and no legacy Strength route/start path in App', () => {
        const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
        const navigationSource = readFileSync(new URL('../types/navigation.ts', import.meta.url), 'utf8');

        expect(appSource).toContain("import('./components/session/SessionRunner')");
        expect(appSource).not.toContain('StrengthSessionRunner');
        expect(appSource).not.toContain("screen === 'strength'");
        expect(appSource).not.toContain('strengthSessionService.startSession');
        expect(navigationSource).not.toContain("'strength'");
    });

    it('retains Strength v1 as a reversible read-compatibility format', () => {
        const legacy: StrengthSession = {
            userId: 'u1',
            sessionId: 'legacy-1',
            date: '2026-08-20',
            startedAt: '2026-08-20T05:00:00.000Z',
            completedAt: '2026-08-20T06:00:00.000Z',
            updatedAt: '2026-08-20T06:00:00.000Z',
            state: 'completed',
            sourceRecommendationDate: '2026-08-20',
            exercises: [{
                exerciseId: 'back_squat',
                sets: [{
                    setIndex: 1,
                    weightKg: 100,
                    reps: 5,
                    gauge: { scale: 'rir', value: 2 },
                    isWarmup: false,
                    completedAt: '2026-08-20T05:20:00.000Z',
                }],
            }],
            sessionRpe: 7,
            schemaVersion: 1,
        };

        const normalized = adaptStrengthSessionToNormalizedExecution(legacy);
        const roundTrip = adaptNormalizedExecutionToStrengthSession(normalized);

        expect(normalized.execution.executionId).toBe(legacy.sessionId);
        expect(normalized.entries).toHaveLength(1);
        expect(roundTrip.exercises[0]?.sets[0]).toMatchObject({
            weightKg: 100,
            reps: 5,
            gauge: { scale: 'rir', value: 2 },
        });
    });
});
