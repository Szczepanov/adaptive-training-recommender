import { describe, it, expect } from 'vitest';
import {
    applyStimulusMatchedAlternative,
    findStimulusMatchedAlternatives,
    resolveStimulusMatchedAlternative,
} from './sessionAlternatives';
import { TEMPLATES_BY_ID } from './templates';
import type { Recommendation, SessionTemplate, UserContext } from './models';

function baseContext(overrides: Partial<UserContext> = {}): UserContext {
    return {
        goals: { shortTerm: '', midTerm: '', longTerm: '' },
        constraints: {
            hasCableMachine: false,
            hasFreeWeights: true,
            hasTreadmill: false,
            hasIndoorBike: true,
            restrictedModalities: [],
            maxTimeMinutes: 90,
        },
        preferences: {
            avoidedModalities: [],
            deprioritizedModalities: [],
            preferredModalities: [],
            conservativeBias: false,
        },
        ...overrides,
    };
}

function template(id: string): SessionTemplate {
    const found = TEMPLATES_BY_ID.get(id);
    if (!found) throw new Error(`Fixture template ${id} not found in catalog`);
    return found;
}

function recommendation(templateId = 'end_easy_01', overrides: Partial<Recommendation> = {}): Recommendation {
    return {
        template: template(templateId),
        rationale: 'Base recommendation',
        mode: 'train',
        plannedDose: { volume: 1, intensity: 1 },
        executionDose: { volume: 1, intensity: 1 },
        ...overrides,
    };
}

const DATE = '2026-09-18';

describe('findStimulusMatchedAlternatives', () => {
    it('offers Running and Walking as stimulus-matched alternatives to an easy-endurance ride', () => {
        const result = findStimulusMatchedAlternatives(template('end_easy_01'), baseContext(), 90, DATE);
        const modalities = result.map(t => t.modality);
        expect(modalities).toContain('Running');
        expect(modalities).toContain('Walking');
        expect(modalities).not.toContain('Cycling');
    });

    it('never offers a modality restricted by an active injury, even though the category matches', () => {
        const context = baseContext({
            constraints: { ...baseContext().constraints, restrictedModalities: ['Running'] },
        });
        const result = findStimulusMatchedAlternatives(template('end_easy_01'), context, 90, DATE);
        const modalities = result.map(t => t.modality);
        expect(modalities).not.toContain('Running');
        expect(modalities).toContain('Walking');
    });

    it('respects an explicit avoided-modality preference even without an injury', () => {
        const context = baseContext({
            preferences: { ...baseContext().preferences, avoidedModalities: ['Running'] },
        });
        const result = findStimulusMatchedAlternatives(template('end_easy_01'), context, 90, DATE);
        expect(result.map(t => t.modality)).not.toContain('Running');
    });

    it('uses non-deprioritized modalities when at least one survives', () => {
        const context = baseContext({
            preferences: { ...baseContext().preferences, deprioritizedModalities: ['Running'] },
        });
        const result = findStimulusMatchedAlternatives(template('end_easy_01'), context, 90, DATE);
        expect(result.map(t => t.modality)).not.toContain('Running');
        expect(result.map(t => t.modality)).toContain('Walking');
    });

    it('excludes a candidate that needs equipment the athlete does not have', () => {
        const context = baseContext({
            constraints: { ...baseContext().constraints, hasIndoorBike: false },
        });
        // Base is the run; cycling needs a bike the legacy context does not expose as available,
        // so the equipment-free Walking alternative survives instead.
        const result = findStimulusMatchedAlternatives(template('end_easy_02'), context, 90, DATE);
        const modalities = result.map(t => t.modality);
        expect(modalities).not.toContain('Cycling');
        expect(modalities).toContain('Walking');
    });

    it('picks the closest enriched stimulus/cost match when a modality has more than one candidate', () => {
        const result = findStimulusMatchedAlternatives(template('end_easy_01'), baseContext(), 90, DATE);
        const running = result.find(t => t.modality === 'Running');
        expect(running?.id).toBe('end_easy_02');
    });

    it('does not silently escalate systemic cost for a one-tap modality swap', () => {
        const result = findStimulusMatchedAlternatives(template('end_walk_01'), baseContext(), 90, DATE);
        expect(result).toEqual([]);
    });

    it('excludes candidates that explicitly opt out of objective transfer', () => {
        const result = findStimulusMatchedAlternatives(template('end_hard_02'), baseContext(), 90, DATE);
        const running = result.find(t => t.modality === 'Running');
        expect(running?.id).toBe('end_hard_01');
        expect(result.some(t => t.id === 'end_hard_03')).toBe(false);
    });

    it('returns nothing once the time budget is too small for any alternative', () => {
        const result = findStimulusMatchedAlternatives(template('end_easy_01'), baseContext(), 15, DATE);
        expect(result).toEqual([]);
    });

    it('returns nothing for a session whose stimulus does not transfer across modalities', () => {
        const nonTransferable: SessionTemplate = {
            ...template('end_easy_01'),
            id: 'synthetic_non_transferable',
            objectiveTransferable: false,
        };
        const result = findStimulusMatchedAlternatives(nonTransferable, baseContext(), 90, DATE);
        expect(result).toEqual([]);
    });

    it('never includes the base template itself', () => {
        const result = findStimulusMatchedAlternatives(template('end_easy_01'), baseContext(), 90, DATE);
        expect(result.some(t => t.id === 'end_easy_01')).toBe(false);
    });
});

describe('stimulus-matched alternative application', () => {
    it('revalidates a previously visible choice against the current safety context', () => {
        expect(resolveStimulusMatchedAlternative(
            template('end_easy_01'),
            'end_easy_02',
            baseContext(),
            90,
            DATE,
        )?.id).toBe('end_easy_02');

        const newlyRestricted = baseContext({
            constraints: { ...baseContext().constraints, restrictedModalities: ['Running'] },
        });
        expect(resolveStimulusMatchedAlternative(
            template('end_easy_01'),
            'end_easy_02',
            newlyRestricted,
            90,
            DATE,
        )).toBeNull();
    });

    it('fails closed instead of applying a stale alternative that is no longer eligible', () => {
        const newlyRestricted = baseContext({
            constraints: { ...baseContext().constraints, restrictedModalities: ['Running'] },
        });
        const applied = applyStimulusMatchedAlternative(
            recommendation(),
            'end_easy_02',
            newlyRestricted,
            90,
            DATE,
        );
        expect(applied).toBeNull();
    });

    it('re-derives the active dose from the replacement modality rather than leaking the original dose', () => {
        const base = recommendation('end_easy_01', {
            activeDose: template('end_easy_01').harderDose,
        });
        const applied = applyStimulusMatchedAlternative(base, 'end_easy_02', baseContext(), 35, DATE);

        expect(applied?.template.id).toBe('end_easy_02');
        expect(applied?.activeDose?.label).toBe('30 min Easy Base Run');
        expect(applied?.activeDose?.label).not.toContain('Ride');
        expect(applied?.adjustment?.originalTemplateId).toBe('end_easy_02');
    });
});
