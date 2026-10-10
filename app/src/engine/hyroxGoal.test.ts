import { describe, expect, it } from 'vitest';
import { validateGoal } from './validation';
import { goalToUserEvent, evaluatePeriodizationPhase, modalitiesForEventCategory } from './periodization';
import { resolveDemandProfile } from './eventPresets';
import { resolveEventTaper } from './taperPolicy';

const goalInput = {
    userId: 'synthetic-user', title: 'HYROX Warsaw', domain: 'general_fitness',
    priority: 4, status: 'active', targetDate: '2027-04-10',
    eventCategory: 'fitness_race', eventPreset: 'hyrox_open_singles',
};

describe('HYROX target goals with generic training support', () => {
    it('validates and preserves format identity through event conversion', () => {
        const result = validateGoal(goalInput);
        expect(result.errors).toEqual([]);
        expect(result.isValid).toBe(true);
        const event = goalToUserEvent({ ...result.data!, id: 'hyrox-goal' });
        expect(event).toMatchObject({
            id: 'hyrox-goal', category: 'fitness_race', presetId: 'hyrox_open_singles',
            date: '2027-04-10', priority: 'B', lifecycle: 'scheduled',
        });
        expect(event!.demandProfile).toEqual(resolveDemandProfile('general_target', 'generic'));
        expect(modalitiesForEventCategory(event!.category)).toEqual([]);
        expect(resolveEventTaper(event!)).toMatchObject({ startDate: '2027-04-05', durationDays: 5 });
        expect(evaluatePeriodizationPhase([event!], '2027-04-06').focusEvent?.id).toBe('hyrox-goal');
    });

    it('rejects HYROX without a date or under an unrelated event category', () => {
        for (const input of [
            { ...goalInput, targetDate: null, category: 'long-term' },
            { ...goalInput, eventCategory: 'running_race' },
            { ...goalInput, eventPreset: 'marathon' },
            { ...goalInput, eventPreset: null },
            { ...goalInput, eventPreset: undefined },
            { ...goalInput, eventPreset: '' },
        ]) {
            expect(validateGoal(input).isValid).toBe(false);
        }
    });

    it('does not infer HYROX semantics from a title', () => {
        const result = validateGoal({ ...goalInput, eventCategory: 'general_target', eventPreset: 'generic' });
        expect(result.isValid).toBe(true);
        expect(goalToUserEvent(result.data!)?.category).toBe('general_target');
    });
});
