import { describe, expect, it } from 'vitest';
import { diffPlans } from './externalPlanDiff';
import { EXTERNAL_PLAN_SCHEMA, type ExternalTrainingPlan } from '../engine/models';
import { EXTERNAL_PLAN_SCHEMA_V2, type ExternalTrainingPlanV2 } from '../sessions/externalPlanV2';
import type { SessionDefinition } from '../sessions/models';

function plan(): ExternalTrainingPlan {
    return {
        schema: EXTERNAL_PLAN_SCHEMA,
        planId: 'block', revision: 1, title: 'Block', startDate: '2026-08-17', weekCount: 1,
        sessions: [{
            id: 's1', title: 'Threshold', priority: 'key',
            placement: { week: 1, preferredDay: 'tuesday', flexibility: 'preferred', ifMissed: 'reschedule_within_week' },
            gating: { modality: 'cycling', intensity: 'hard', durationMin: 60, durationMax: 75, environment: 'either', equipment: ['indoor_bike'] },
            objectives: ['threshold_quality', 'zone2_aerobic'],
            prescription: {
                summary: '3x12 at threshold.',
                steps: [{ name: 'Interval', durationMin: 12, repeat: 3, recoveryMin: 4, target: 'threshold' }],
            },
            scaling: { reducible: true, reducedSummary: '2x12', reducedDurationMin: 45, minimumUsefulDurationMin: 35 },
        }],
    };
}

function details(next: ExternalTrainingPlan): string {
    return diffPlans(plan(), next).map(row => row.detail).join(' ');
}

describe('diffPlans', () => {
    it('surfaces behavior changes that affect placement, adjudication, credit or event semantics', () => {
        const next = structuredClone(plan());
        next.revision = 2;
        const session = next.sessions[0];
        session.priority = 'supporting';
        session.placement.flexibility = 'fixed';
        session.placement.ifMissed = 'drop';
        session.gating.environment = 'indoor';
        session.gating.equipment = ['free_weights'];
        session.objectives = ['vo2_max'];
        session.scaling = { reducible: false, minimumUsefulDurationMin: 60 };
        session.isEvent = true;

        const detail = details(next);
        expect(detail).toContain('priority key → supporting');
        expect(detail).toContain('flexibility preferred → fixed');
        expect(detail).toContain('missed-session policy reschedule_within_week → drop');
        expect(detail).toContain('environment either → indoor');
        expect(detail).toContain('required equipment changed');
        expect(detail).toContain('objective tags changed');
        expect(detail).toContain('scaling / fallback policy changed');
        expect(detail).toContain('now marked as an event');
    });

    it('detects prescription structure changes even when the summary text is unchanged', () => {
        const next = structuredClone(plan());
        next.revision = 2;
        next.sessions[0].prescription.steps![0].repeat = 4;

        // M3.6: the message is schema-neutral now that a v2 session's content
        // (`definition`) is compared through the same coarse check.
        expect(details(next)).toContain('the session content changed');
    });

    it('does not report order-only changes to set-like equipment and objective tags', () => {
        const next = structuredClone(plan());
        next.revision = 2;
        next.sessions[0].gating.equipment = [...next.sessions[0].gating.equipment].reverse();
        next.sessions[0].objectives = [...(next.sessions[0].objectives ?? [])].reverse();

        expect(diffPlans(plan(), next)).toEqual([]);
    });
});

function v2Definition(): SessionDefinition {
    return {
        schemaVersion: 1,
        id: 's1',
        revision: 1,
        title: 'Threshold',
        intent: 'training',
        blocks: [
            {
                id: 'block-main',
                role: 'main',
                executionMode: 'sequential',
                steps: [
                    {
                        id: 'step-interval',
                        kind: 'exercise',
                        title: 'Interval',
                        exerciseRef: { kind: 'unresolved_free_text', name: 'Bike interval' },
                        dose: { kind: 'duration', sets: 3, seconds: 720 },
                        rest: 240,
                        optional: false,
                    },
                ],
            },
        ],
    };
}

function v2Plan(): ExternalTrainingPlanV2 {
    return {
        schema: EXTERNAL_PLAN_SCHEMA_V2,
        planId: 'block', revision: 1, title: 'Block', startDate: '2026-08-17', weekCount: 1,
        sessions: [{
            id: 's1', title: 'Threshold', priority: 'key',
            placement: { week: 1, preferredDay: 'tuesday', flexibility: 'preferred', ifMissed: 'reschedule_within_week' },
            gating: { modality: 'cycling', intensity: 'hard', durationMin: 60, durationMax: 75, environment: 'either', equipment: ['indoor_bike'] },
            objectives: ['threshold_quality', 'zone2_aerobic'],
            definition: v2Definition(),
        }],
    };
}

describe('diffPlans — M3.7 fine-grained v2 content diff', () => {
    it('replaces the coarse content line with per-field rows for a v2/v2 session pair', () => {
        const previous = v2Plan();
        const next = structuredClone(previous);
        next.revision = 2;
        next.sessions[0].definition.blocks[0].steps[0].optional = true;

        const rows = diffPlans(previous, next);
        const row = rows.find(r => r.sessionId === 's1');
        expect(row?.contentChanges).toBeDefined();
        expect(row?.contentChanges?.some(change => change.behaviorChanging && change.detail.includes('required → optional'))).toBe(true);
        expect(row?.detail).toContain('the session content changed (see below)');
    });

    it('marks a title-only content change as non-behavior-changing (cosmetic)', () => {
        const previous = v2Plan();
        const next = structuredClone(previous);
        next.revision = 2;
        next.sessions[0].definition.title = 'Threshold v2';

        const rows = diffPlans(previous, next);
        const row = rows.find(r => r.sessionId === 's1');
        expect(row?.contentChanges?.every(change => !change.behaviorChanging)).toBe(true);
        expect(row?.detail).toContain('session wording changed (see below)');
    });

    it('reports nothing when the v2 definition is unchanged', () => {
        const previous = v2Plan();
        const next = structuredClone(previous);
        next.revision = 2;

        expect(diffPlans(previous, next)).toEqual([]);
    });
});
