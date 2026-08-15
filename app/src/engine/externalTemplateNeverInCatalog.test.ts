import { describe, expect, it } from 'vitest';
import {
    EXTERNAL_TEMPLATE_ID_PREFIX,
    externalTemplateId,
    isExternalTemplateId,
    toSyntheticTemplate,
} from './externalSessionProfiles';
import { TEMPLATES, ENRICHED_TEMPLATES } from './templates';
import { workoutForTemplate } from '../workouts/prescription';
import { WORKOUTS } from '../workouts/catalog';
import { stimulusConfidenceForTier } from './completedTraining';
import type { ExternalPlanSession } from './models';

/**
 * ADR-0019 D-SHIM accepts one real risk: `Recommendation.template` no longer always refers
 * to a catalog entry. These tests are what keeps the two populations apart, so the shim
 * stays a contained adapter rather than leaking into the validated workout library.
 */

function session(overrides: Partial<ExternalPlanSession> = {}): ExternalPlanSession {
    return {
        id: 'w1-threshold', title: 'Threshold 3x12', priority: 'key',
        placement: { week: 1, preferredDay: 'tuesday', flexibility: 'preferred', ifMissed: 'drop' },
        gating: { modality: 'cycling', intensity: 'hard', durationMin: 60, durationMax: 75, environment: 'either', equipment: [] },
        prescription: { summary: '3x12 at threshold.' },
        ...overrides,
    };
}

describe('synthetic template identity', () => {
    it('never collides with a catalog template id', () => {
        const synthetic = toSyntheticTemplate(session(), 'autumn-block', 1);
        const catalogIds = new Set([...TEMPLATES, ...ENRICHED_TEMPLATES].map(item => item.id));

        expect(catalogIds.has(synthetic.id)).toBe(false);
        expect(synthetic.id.startsWith(EXTERNAL_TEMPLATE_ID_PREFIX)).toBe(true);
    });

    it('no catalog template or workout has ever claimed the reserved prefix', () => {
        for (const template of [...TEMPLATES, ...ENRICHED_TEMPLATES]) {
            expect(isExternalTemplateId(template.id), template.id).toBe(false);
        }
        for (const workout of WORKOUTS) {
            expect(isExternalTemplateId(workout.id), workout.id).toBe(false);
            for (const linked of workout.engineTemplateIds ?? []) {
                expect(isExternalTemplateId(linked), linked).toBe(false);
            }
        }
    });

    it('does not resolve to a catalog workout, so authored content is never misattributed', () => {
        const synthetic = toSyntheticTemplate(session(), 'autumn-block', 1);
        expect(workoutForTemplate(synthetic.id)).toBeUndefined();
    });

    it('distinguishes plan, revision and session, so two revisions are two identities', () => {
        expect(externalTemplateId('block', 1, 's1')).not.toBe(externalTemplateId('block', 2, 's1'));
        expect(externalTemplateId('block', 1, 's1')).not.toBe(externalTemplateId('other', 1, 's1'));
        expect(externalTemplateId('block', 1, 's1')).not.toBe(externalTemplateId('block', 1, 's2'));
    });

    it('carries derived load and stimulus but claims no safety tags or phase gating', () => {
        const synthetic = toSyntheticTemplate(session(), 'autumn-block', 1);
        expect(synthetic.costProfile).toBeDefined();
        expect(synthetic.stimulusProfile).toBeDefined();
        expect(synthetic.safetyTags).toEqual([]);
        // An imported session's timing belongs to its placement, not to event-relative
        // phase gating, so it must not be excluded by a phase it was never authored for.
        expect(synthetic.phaseEligibility).toBeUndefined();
    });
});

describe('authoredExternal evidence rung (D-EXTTIER)', () => {
    it('is discounted like an inferred session, not credited as an exact match', () => {
        expect(stimulusConfidenceForTier('authoredExternal')).toBe('inferred');
        expect(stimulusConfidenceForTier('exactPrescribedMatch')).toBe('exact');
    });
});
