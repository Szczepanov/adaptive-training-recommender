import { describe, it, expect } from 'vitest';
import { findStimulusMatchedAlternatives } from './sessionAlternatives';
import { TEMPLATES_BY_ID } from './templates';
import type { SessionTemplate, UserContext } from './models';

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

const DATE = '2026-09-18';

describe('findStimulusMatchedAlternatives', () => {
    it('offers Running and Walking as same-stimulus alternatives to an easy-endurance ride', () => {
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

    it('excludes a candidate that needs equipment the athlete does not have', () => {
        const context = baseContext({
            constraints: { ...baseContext().constraints, hasIndoorBike: false },
        });
        // Base is the run; cycling needs an indoor bike the athlete lacks, so only Walking survives.
        const result = findStimulusMatchedAlternatives(template('end_easy_02'), context, 90, DATE);
        const modalities = result.map(t => t.modality);
        expect(modalities).not.toContain('Cycling');
        expect(modalities).toContain('Walking');
    });

    it('picks the closest systemic-cost match when a modality has more than one candidate', () => {
        // end_easy_01 (Cycling) systemicCost 0.3. Running has two Easy Endurance templates:
        // end_easy_02 at 0.3 (exact match) and end_easy_03 at 0.25. The closer one must win.
        const result = findStimulusMatchedAlternatives(template('end_easy_01'), baseContext(), 90, DATE);
        const running = result.find(t => t.modality === 'Running');
        expect(running?.id).toBe('end_easy_02');
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
