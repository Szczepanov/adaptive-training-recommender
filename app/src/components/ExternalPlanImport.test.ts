import { describe, expect, it } from 'vitest';
import { diffPlans } from './externalPlanDiff';
import { EXTERNAL_PLAN_SCHEMA, type ExternalTrainingPlan } from '../engine/models';

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

        expect(details(next)).toContain('the prescription changed');
    });

    it('does not report order-only changes to set-like equipment and objective tags', () => {
        const next = structuredClone(plan());
        next.revision = 2;
        next.sessions[0].gating.equipment = [...next.sessions[0].gating.equipment].reverse();
        next.sessions[0].objectives = [...(next.sessions[0].objectives ?? [])].reverse();

        expect(diffPlans(plan(), next)).toEqual([]);
    });
});
