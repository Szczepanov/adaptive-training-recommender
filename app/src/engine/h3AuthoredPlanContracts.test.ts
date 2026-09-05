import { describe, expect, it } from 'vitest';
import { applyFixedActivityStimulusCredit } from './planner';
import { getUnresolvedObjectives } from './microcycle';
import { externalEventAsFixedActivity } from './externalSessionProfiles';
import type { ExternalPlanSession, MicrocycleState } from './models';

const DATE = '2026-08-20';

function hardCyclingEvent(): ExternalPlanSession {
    return {
        id: 'w1-race',
        title: 'Road race',
        priority: 'key',
        placement: {
            week: 1,
            preferredDay: 'thursday',
            flexibility: 'fixed',
            ifMissed: 'drop',
        },
        gating: {
            modality: 'cycling',
            intensity: 'hard',
            durationMin: 120,
            durationMax: 120,
            environment: 'outdoor',
            equipment: [],
        },
        objectives: ['threshold_quality'],
        prescription: { summary: 'Race hard; no additional threshold workout.' },
        isEvent: true,
    };
}

function thresholdMicrocycle(): MicrocycleState {
    return {
        windowStartDate: '2026-08-17',
        objectives: [{
            id: 'threshold-quality',
            key: 'threshold_quality',
            title: 'Threshold Development',
            requiredCredit: 0.5,
            targetExposures: 1,
            completedExposures: 0,
            completedCredit: 0,
            projectedCredit: 0,
            priority: 'must_have',
            targetStimulus: { thresholdPower: 0.9 },
            qualification: {
                minimumStimulus: { thresholdPower: 0.6 },
                allowedModalities: ['Cycling'],
            },
        }],
    };
}

describe('H3 authored-plan replacement contracts', () => {
    it('lets an imported hard cycling event satisfy threshold quality before catalog ranking', () => {
        const fixed = externalEventAsFixedActivity(hardCyclingEvent(), 'autumn-block', 1, 'u1', DATE);
        expect(fixed).not.toBeNull();
        expect(fixed?.externalAuthoredIdentity).toMatchObject({
            modality: 'Cycling',
            category: 'Hard Endurance',
            stimulusConfidence: 'inferred',
        });
        expect(fixed?.expectedStimulus?.thresholdPower ?? 0).toBeGreaterThanOrEqual(0.6);

        const credited = applyFixedActivityStimulusCredit(thresholdMicrocycle(), [fixed!], DATE);

        expect(credited.credits).toHaveLength(1);
        expect(credited.credits[0].objectiveKey).toBe('threshold_quality');
        expect(credited.credits[0].earnedCredit).toBeGreaterThanOrEqual(0.5);
        expect(getUnresolvedObjectives(credited.microcycle)).toEqual([]);
    });
});
