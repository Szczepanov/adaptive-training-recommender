import { describe, expect, it } from 'vitest';
import { EXERCISES } from './exercises';
import { EXERCISE_SEARCH_ALIASES, matchesExerciseQuery } from './exerciseSearch';

const idsFor = (query: string) => EXERCISES.filter(ex => matchesExerciseQuery(ex, query)).map(ex => ex.id);

describe('matchesExerciseQuery', () => {
    it('finds the single-arm (suitcase) carry when the athlete searches for a farmer carry', () => {
        expect(idsFor('farmer')).toEqual(expect.arrayContaining(['farmer_carry', 'suitcase_carry']));
        expect(idsFor('single-arm farmer')).toContain('suitcase_carry');
        expect(idsFor('single arm farmer carry')).toContain('suitcase_carry');
    });

    it('matches movement patterns written with spaces', () => {
        expect(idsFor('carry')).toEqual(expect.arrayContaining(['farmer_carry', 'suitcase_carry']));
        expect(idsFor('anti lateral')).toContain('suitcase_carry');
    });

    it('matches everything for a blank query', () => {
        expect(EXERCISES.every(ex => matchesExerciseQuery(ex, '  '))).toBe(true);
    });
});

describe('EXERCISE_SEARCH_ALIASES', () => {
    it('only names exercises that exist in the catalog', () => {
        const ids = new Set(EXERCISES.map(ex => ex.id));
        expect(Object.keys(EXERCISE_SEARCH_ALIASES).filter(id => !ids.has(id))).toEqual([]);
    });
});
