import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EXTERNAL_PLAN_SCHEMA } from '../engine/models';
import { EXTERNAL_PLAN_SESSION_ID_MAX_CHARS } from '../engine/validation';
import { validateAnyExternalTrainingPlan, validateExternalPlanImport } from './externalPlanValidation';

function plan(sessionIds: readonly string[]) {
    return {
        schema: EXTERNAL_PLAN_SCHEMA,
        planId: 'autumn-block', revision: 1, title: '4-week block',
        startDate: '2026-08-17', weekCount: 4,
        sessions: sessionIds.map(id => ({
            id, title: 'Threshold', priority: 'key',
            placement: { week: 1, preferredDay: 'tuesday', flexibility: 'preferred', ifMissed: 'drop' },
            gating: { modality: 'cycling', intensity: 'hard', durationMin: 60, durationMax: 75, environment: 'either', equipment: [] },
            prescription: { summary: '3x12.' },
        })),
    };
}

const atCap = 's'.repeat(EXTERNAL_PLAN_SESSION_ID_MAX_CHARS);
const overCap = 's'.repeat(EXTERNAL_PLAN_SESSION_ID_MAX_CHARS + 1);

describe('validateExternalPlanImport session id bound (#945)', () => {
    it('accepts a session id at the persisted identity cap', () => {
        expect(validateExternalPlanImport(plan([atCap])).isValid).toBe(true);
    });

    it('rejects a session id one character over the cap, naming the session', () => {
        const result = validateExternalPlanImport(plan(['w1-a', overCap]));
        expect(result.isValid).toBe(false);
        expect(result.errors).toEqual([{
            field: 'sessions[1].id',
            message: `Session id must be at most ${EXTERNAL_PLAN_SESSION_ID_MAX_CHARS} characters`,
        }]);
    });

    it('reports the id bound alongside other contract errors in one pass', () => {
        const result = validateExternalPlanImport({ ...plan([overCap]), title: '' });
        expect(result.isValid).toBe(false);
        expect(result.errors.map(error => error.field)).toEqual(expect.arrayContaining(['title', 'sessions[0].id']));
    });

    it('keeps an already-stored revision with a longer id readable', () => {
        expect(validateAnyExternalTrainingPlan(plan([overCap])).isValid).toBe(true);
    });

    it('matches the session_occurrences externalPlanRef bound in firestore.rules', () => {
        const rules = [resolve(process.cwd(), 'firestore.rules'), resolve(__dirname, '../../firestore.rules')]
            .map(path => { try { return readFileSync(path, 'utf8'); } catch { return ''; } })
            .find(text => text.length > 0) ?? '';
        expect(rules).toContain(`data.externalPlanRef.sessionId.size() <= ${EXTERNAL_PLAN_SESSION_ID_MAX_CHARS}`);
    });
});
