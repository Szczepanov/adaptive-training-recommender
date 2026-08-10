import { describe, expect, it } from 'vitest';
import { applyPlanningOverlays } from './planningOverlays';

describe('planning overlays', () => {
    const travel = {
        id: 'trip', userId: 'u1', eventId: null, phase: 'travel' as const,
        startDate: '2026-08-10', endDate: '2026-08-12', volumeScale: 0.6, intensityScale: 0.5,
        createdAt: '', updatedAt: '',
    };

    it('constrains a plan dose without requiring a structured plan definition', () => {
        expect(applyPlanningOverlays({ volume: 1, intensity: 1 }, '2026-08-11', [travel])).toEqual({ volume: 0.6, intensity: 0.5 });
        expect(applyPlanningOverlays({ volume: 1, intensity: 1 }, '2026-08-13', [travel])).toEqual({ volume: 1, intensity: 1 });
    });

    it('does not double-scale a structured plan that already contains the authored block', () => {
        const structuredPlan = {
            id: 'plan', eventId: 'race', coverageSetId: 'september_cycling_event' as const,
            blocks: [{ id: 'authored_trip', phase: 'travel' as const, startDate: '2026-08-10', endDate: '2026-08-12', volumeScale: 0.6, intensityScale: 0.5 }],
            objectives: [], sequencingRules: [],
        };
        expect(applyPlanningOverlays({ volume: 0.6, intensity: 0.5 }, '2026-08-11', [travel], structuredPlan)).toEqual({ volume: 0.6, intensity: 0.5 });
    });
});
