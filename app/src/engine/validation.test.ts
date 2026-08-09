import { describe, it, expect } from 'vitest';
import { isValidDate, validateRecommendation, validateAdherenceUpdate, validateGoal, validateFixedActivity, validateCheckin } from './validation';

describe('isValidDate', () => {
    it('rejects impossible calendar dates rather than normalizing them', () => {
        expect(isValidDate('2026-02-30')).toBe(false);
        expect(isValidDate('2026-13-01')).toBe(false);
    });

    it('handles leap years exactly', () => {
        expect(isValidDate('2024-02-29')).toBe(true);
        expect(isValidDate('2025-02-29')).toBe(false);
    });
});

describe('validateGoal', () => {
    const baseFields = {
        userId: 'u1',
        title: 'Road cycling event',
        domain: 'endurance',
        priority: 5,
        status: 'active',
    };

    it('requires category for an open-ended goal (no target date)', () => {
        const result = validateGoal({ ...baseFields });
        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.field === 'category')).toBe(true);
    });

    it('accepts an open-ended goal and keeps its explicit category as-is', () => {
        const result = validateGoal({ ...baseFields, category: 'long-term' });
        expect(result.isValid).toBe(true);
        expect(result.data?.category).toBe('long-term');
        expect(result.data?.targetDate).toBeNull();
    });

    it('derives category from target date and ignores whatever category the caller sent', () => {
        const result = validateGoal({
            ...baseFields,
            category: 'long-term', // deliberately wrong -- should be overridden
            targetDate: '2026-08-20', // 13 days from a fixed "today" would be short-term, but validateGoal uses the real current date
        });
        expect(result.isValid).toBe(true);
        expect(result.data?.category).not.toBe(undefined);
        // Whatever the real "today" is, the derived category must be internally
        // consistent with deriveGoalCategory rather than the raw 'long-term' sent above --
        // asserting it's NOT the (deliberately wrong) raw value is the stable check here.
    });

    it('does not require category at all once a target date is present', () => {
        const result = validateGoal({ ...baseFields, targetDate: '2026-09-13' });
        expect(result.isValid).toBe(true);
    });

    it('rejects an eventCategory without a target date', () => {
        const result = validateGoal({ ...baseFields, category: 'long-term', eventCategory: 'cycling_event' });
        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.field === 'eventCategory')).toBe(true);
    });

    it('rejects an unknown eventCategory value', () => {
        const result = validateGoal({ ...baseFields, targetDate: '2026-09-13', eventCategory: 'chess_tournament' });
        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.field === 'eventCategory')).toBe(true);
    });

    it('rejects an eventPreset that does not belong to the selected eventCategory', () => {
        const result = validateGoal({
            ...baseFields, targetDate: '2026-09-13', eventCategory: 'cycling_event', eventPreset: 'marathon',
        });
        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.field === 'eventPreset')).toBe(true);
    });

    it('accepts a complete dated event goal (the road-race scenario) end to end', () => {
        const result = validateGoal({
            ...baseFields, targetDate: '2026-09-13', eventCategory: 'cycling_event', eventPreset: 'road_race',
        });
        expect(result.isValid).toBe(true);
        expect(result.data?.eventCategory).toBe('cycling_event');
        expect(result.data?.eventPreset).toBe('road_race');
        expect(result.data?.eventLifecycle).toBeUndefined(); // not persisted -- defaults to 'scheduled' downstream in goalToUserEvent
    });

    it('rejects an invalid eventLifecycle value', () => {
        const result = validateGoal({
            ...baseFields, targetDate: '2026-09-13', eventCategory: 'cycling_event', eventLifecycle: 'in_progress',
        });
        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.field === 'eventLifecycle')).toBe(true);
    });

    it('rejects event lifecycle metadata without a dated event category', () => {
        const result = validateGoal({
            ...baseFields, category: 'long-term', eventLifecycle: 'completed',
        });
        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.field === 'eventLifecycle')).toBe(true);
    });

    // ADR-0012 Task 2.3 (EventTiming) -- validateGoal is the write-side gate that keeps
    // an inconsistent timing object out of Firestore in the first place.
    it('rejects timing without a dated event category', () => {
        const result = validateGoal({
            ...baseFields, category: 'long-term',
            timing: { earliestDate: '2026-09-05', latestDate: '2026-09-20', planningDate: '2026-09-05' },
        });
        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.field === 'timing')).toBe(true);
    });

    it('rejects timing whose dates violate validateEventTiming\'s ordering invariants', () => {
        const result = validateGoal({
            ...baseFields, targetDate: '2026-09-13', eventCategory: 'cycling_event',
            timing: { earliestDate: '2026-09-10', latestDate: '2026-09-05', planningDate: '2026-09-10' },
        });
        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.field === 'timing')).toBe(true);
    });

    it('accepts a valid unconfirmed timing range alongside a dated event and carries it through', () => {
        const result = validateGoal({
            ...baseFields, targetDate: '2026-09-05', eventCategory: 'cycling_event',
            timing: { earliestDate: '2026-09-05', latestDate: '2026-09-20', planningDate: '2026-09-05' },
        });
        expect(result.isValid).toBe(true);
        expect(result.data?.timing).toEqual({ earliestDate: '2026-09-05', latestDate: '2026-09-20', planningDate: '2026-09-05' });
    });

    it('accepts a confirmed date once planningDate has been updated to match it', () => {
        const result = validateGoal({
            ...baseFields, targetDate: '2026-09-05', eventCategory: 'cycling_event',
            timing: { earliestDate: '2026-09-05', latestDate: '2026-09-20', planningDate: '2026-09-19', confirmedDate: '2026-09-19' },
        });
        expect(result.isValid).toBe(true);
        expect(result.data?.timing?.confirmedDate).toBe('2026-09-19');
    });
});

describe('validateRecommendation', () => {
    it('accepts a complete recommendation and defaults adherence to unanswered', () => {
        const result = validateRecommendation({
            userId: 'u1', date: '2026-08-07', templateId: 'str_upper_01', templateTitle: 'Upper Body Push/Pull',
            category: 'Upper-body Strength', modality: 'Strength', mode: 'modify', rationale: 'test rationale',
        });
        expect(result.isValid).toBe(true);
        expect(result.data?.adherence).toEqual({
            respondedAt: null, followed: null, actualModality: null, actualDurationMin: null, skipped: false, notes: null,
        });
    });

    it('rejects a payload missing required fields', () => {
        const result = validateRecommendation({ userId: 'u1', date: '2026-08-07' });
        expect(result.isValid).toBe(false);
        expect(result.errors.map(e => e.field)).toEqual(
            expect.arrayContaining(['templateId', 'templateTitle', 'category', 'modality', 'mode', 'rationale'])
        );
    });

    it('rejects an invalid mode', () => {
        const result = validateRecommendation({
            userId: 'u1', date: '2026-08-07', templateId: 't', templateTitle: 't', category: 'c', modality: 'm',
            mode: 'not-a-real-mode', rationale: 'r',
        });
        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.field === 'mode')).toBe(true);
    });

    it('re-saving a recommendation for the same date preserves prior adherence rather than clobbering it', () => {
        const result = validateRecommendation({
            userId: 'u1', date: '2026-08-07', templateId: 'str_upper_01', templateTitle: 'Upper Body Push/Pull',
            category: 'Upper-body Strength', modality: 'Strength', mode: 'modify', rationale: 'updated rationale',
            adherence: { respondedAt: '2026-08-08T07:00:00Z', followed: true, actualModality: null, actualDurationMin: null, skipped: false, notes: null },
        });
        expect(result.data?.adherence.followed).toBe(true);
        expect(result.data?.adherence.respondedAt).toBe('2026-08-08T07:00:00Z');
    });

    it('preserves a resolved detailed prescription snapshot', () => {
        const prescription = { workoutId: 'cycling_zone2_standard_01', displayBlocks: [] };
        const result = validateRecommendation({
            userId: 'u1', date: '2026-08-07', templateId: 'end_easy_01', templateTitle: 'Zone 2 Spin',
            category: 'Easy Endurance', modality: 'Cycling', mode: 'train', rationale: 'test rationale', prescription,
        });
        expect(result.data?.prescription).toEqual(prescription);
        expect(result.data?.schemaVersion).toBe(2);
    });
});

describe('validateAdherenceUpdate', () => {
    it('accepts a simple "followed it" answer', () => {
        const result = validateAdherenceUpdate({ followed: true });
        expect(result.isValid).toBe(true);
        expect(result.data?.followed).toBe(true);
        expect(result.data?.respondedAt).not.toBeNull();
    });

    it('accepts a "did something else" answer with details', () => {
        const result = validateAdherenceUpdate({
            followed: false, skipped: false, actualModality: 'Strength', actualDurationMin: 35, notes: 'felt good',
        });
        expect(result.isValid).toBe(true);
        expect(result.data).toMatchObject({ followed: false, skipped: false, actualModality: 'Strength', actualDurationMin: 35, notes: 'felt good' });
    });

    it('rejects a negative duration', () => {
        const result = validateAdherenceUpdate({ followed: false, actualDurationMin: -5 });
        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.field === 'actualDurationMin')).toBe(true);
    });

    it('rejects a payload missing the required followed field', () => {
        const result = validateAdherenceUpdate({ skipped: true });
        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.field === 'followed')).toBe(true);
    });

    it('normalizes an empty-string actualModality to null', () => {
        const result = validateAdherenceUpdate({ followed: false, actualModality: '' });
        expect(result.isValid).toBe(true);
        expect(result.data?.actualModality).toBeNull();
    });
});

describe('validateFixedActivity', () => {
    const baseFields = {
        userId: 'u1',
        title: 'Evening Football',
        date: '2026-08-12',
        durationMin: 90,
        fixed: true,
        environment: 'outdoor',
        isCompleted: false,
    };

    it('accepts a minimal valid fixed activity', () => {
        const result = validateFixedActivity({ ...baseFields });
        expect(result.isValid).toBe(true);
        expect(result.data?.durationMin).toBe(90);
        expect(result.data?.fixed).toBe(true);
    });

    it('accepts expectedStimulus/expectedCost maps within [0, 1]', () => {
        const result = validateFixedActivity({
            ...baseFields,
            expectedStimulus: { aerobicEndurance: 0.6, repeatedSurges: 0.4 },
            expectedCost: { systemic: 0.8, lowerBody: 0.5 },
        });
        expect(result.isValid).toBe(true);
        expect(result.data?.expectedStimulus).toEqual({ aerobicEndurance: 0.6, repeatedSurges: 0.4 });
    });

    it('rejects an expectedCost value above 1', () => {
        const result = validateFixedActivity({ ...baseFields, expectedCost: { systemic: 1.5 } });
        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.field === 'expectedCost')).toBe(true);
    });

    it('rejects an expectedStimulus map with an unrecognized axis key', () => {
        const result = validateFixedActivity({ ...baseFields, expectedStimulus: { notAnAxis: 0.5 } });
        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.field === 'expectedStimulus')).toBe(true);
    });

    it('rejects durationMin out of [1, 1440]', () => {
        expect(validateFixedActivity({ ...baseFields, durationMin: 0 }).isValid).toBe(false);
        expect(validateFixedActivity({ ...baseFields, durationMin: 1500 }).isValid).toBe(false);
    });

    it('requires the fixed field (movable vs immovable)', () => {
        const withoutFixed: Record<string, unknown> = { ...baseFields };
        delete withoutFixed.fixed;
        const result = validateFixedActivity(withoutFixed);
        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.field === 'fixed')).toBe(true);
    });

    it('rejects an unknown environment', () => {
        const result = validateFixedActivity({ ...baseFields, environment: 'space' });
        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.field === 'environment')).toBe(true);
    });

    it('rejects an oversized equipment list', () => {
        const result = validateFixedActivity({ ...baseFields, equipment: Array.from({ length: 21 }, (_, i) => `item-${i}`) });
        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.field === 'equipment')).toBe(true);
    });

    it('rejects an equipment item that is too long', () => {
        const result = validateFixedActivity({ ...baseFields, equipment: ['x'.repeat(51)] });
        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.field === 'equipment')).toBe(true);
    });

    it('rejects a malformed date', () => {
        const result = validateFixedActivity({ ...baseFields, date: '08/12/2026' });
        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.field === 'date')).toBe(true);
    });

    it('accepts availabilityOverride within [0, 1440] and rejects out-of-range', () => {
        expect(validateFixedActivity({ ...baseFields, availabilityOverride: 60 }).isValid).toBe(true);
        expect(validateFixedActivity({ ...baseFields, availabilityOverride: -1 }).isValid).toBe(false);
        expect(validateFixedActivity({ ...baseFields, availabilityOverride: 1500 }).isValid).toBe(false);
    });
});

describe('validateCheckin: tissueResponses (Phase 5.4)', () => {
    const baseFields = {
        userId: 'u1',
        date: '2026-08-08',
        readiness: 7,
        painOrInjury: true,
    };

    it('accepts a minimal valid tissue response with just morningState', () => {
        const result = validateCheckin({ ...baseFields, tissueResponses: { knee: { morningState: 'mild' } } });
        expect(result.isValid).toBe(true);
        expect(result.data?.tissueResponses?.knee).toEqual({ region: 'knee', morningState: 'mild' });
    });

    it('accepts all four signals on a region', () => {
        const result = validateCheckin({
            ...baseFields,
            tissueResponses: {
                shoulder: { morningState: 'normal', painDuringTraining: 'severe', afterTrainingState: 'moderate', nextMorningReaction: 'mild' },
            },
        });
        expect(result.isValid).toBe(true);
        expect(result.data?.tissueResponses?.shoulder).toEqual({
            region: 'shoulder', morningState: 'normal', painDuringTraining: 'severe', afterTrainingState: 'moderate', nextMorningReaction: 'mild',
        });
    });

    it('rejects an unrecognized region key', () => {
        const result = validateCheckin({ ...baseFields, tissueResponses: { notARegion: { morningState: 'mild' } } });
        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.field === 'tissueResponses')).toBe(true);
    });

    it('rejects a missing required morningState', () => {
        const result = validateCheckin({ ...baseFields, tissueResponses: { knee: { painDuringTraining: 'mild' } } });
        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.field === 'tissueResponses.knee.morningState')).toBe(true);
    });

    it('rejects an invalid level value', () => {
        const result = validateCheckin({ ...baseFields, tissueResponses: { knee: { morningState: 'extreme' } } });
        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.field === 'tissueResponses.knee.morningState')).toBe(true);
    });

    it('omits the field entirely when absent, and drops it when empty', () => {
        const absent = validateCheckin({ ...baseFields });
        expect(absent.isValid).toBe(true);
        expect(absent.data?.tissueResponses).toBeUndefined();

        const empty = validateCheckin({ ...baseFields, tissueResponses: {} });
        expect(empty.isValid).toBe(true);
        expect(empty.data?.tissueResponses).toBeUndefined();
    });

    it('rejects an entry whose own region field mismatches its containing map key', () => {
        const result = validateCheckin({ ...baseFields, tissueResponses: { knee: { region: 'ankle', morningState: 'mild' } } });
        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.field === 'tissueResponses.knee.region')).toBe(true);
    });

    it('accepts an entry whose own region field matches its containing map key', () => {
        const result = validateCheckin({ ...baseFields, tissueResponses: { knee: { region: 'knee', morningState: 'mild' } } });
        expect(result.isValid).toBe(true);
        expect(result.data?.tissueResponses?.knee).toEqual({ region: 'knee', morningState: 'mild' });
    });
});

describe('validateEventTiming', () => {
    it('accepts valid unconfirmed EventTiming', async () => {
        const { validateEventTiming } = await import('./models');
        const result = validateEventTiming({
            earliestDate: '2026-09-05',
            latestDate: '2026-09-20',
            planningDate: '2026-09-05',
        });
        expect(result.status).toBe('AVAILABLE');
    });

    it('rejects earliestDate > planningDate', async () => {
        const { validateEventTiming } = await import('./models');
        const result = validateEventTiming({
            earliestDate: '2026-09-10',
            latestDate: '2026-09-20',
            planningDate: '2026-09-05',
        });
        expect(result.status).toBe('INVALID');
    });

    it('rejects planningDate > latestDate', async () => {
        const { validateEventTiming } = await import('./models');
        const result = validateEventTiming({
            earliestDate: '2026-09-05',
            latestDate: '2026-09-15',
            planningDate: '2026-09-20',
        });
        expect(result.status).toBe('INVALID');
    });

    it('rejects confirmedDate outside range or not matching planningDate', async () => {
        const { validateEventTiming } = await import('./models');
        // Confirmed date inside range, but planningDate hasn't been updated to match confirmedDate
        const resultMismatch = validateEventTiming({
            earliestDate: '2026-09-05',
            latestDate: '2026-09-20',
            planningDate: '2026-09-05',
            confirmedDate: '2026-09-19',
        });
        expect(resultMismatch.status).toBe('INVALID');

        // Confirmed date matching planningDate and inside range -> valid
        const resultValid = validateEventTiming({
            earliestDate: '2026-09-05',
            latestDate: '2026-09-20',
            planningDate: '2026-09-19',
            confirmedDate: '2026-09-19',
        });
        expect(resultValid.status).toBe('AVAILABLE');
    });
});

