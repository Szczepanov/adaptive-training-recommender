import { describe, expect, it } from 'vitest';
import type { FixedActivity } from './models';
import { coverageKeysForExposure } from './coverage';
import { resolveFixedActivityIdentity } from './fixedActivityIdentity';

function activity(overrides: Partial<FixedActivity> = {}): FixedActivity {
    return {
        id: 'fixed-1',
        userId: 'u1',
        title: 'Booked training',
        date: '2026-08-20',
        durationMin: 60,
        fixed: true,
        environment: 'either',
        equipment: [],
        isCompleted: false,
        createdAt: '2026-08-01T00:00:00Z',
        updatedAt: '2026-08-01T00:00:00Z',
        ...overrides,
    };
}

describe('Phase 6.2c fixed-activity exact identity', () => {
    it('resolves a known engine template to the same detailed workout used by prescription generation', () => {
        const identity = resolveFixedActivityIdentity(activity({ templateId: 'end_easy_01' }));
        expect(identity).toMatchObject({
            occurrenceKey: 'fixed:fixed-1',
            templateId: 'end_easy_01',
            workoutId: 'cycling_zone2_standard_01',
            modality: 'Cycling',
            category: 'Easy Endurance',
            exactCatalogIdentity: true,
        });
        expect(coverageKeysForExposure({ ...identity, durationMin: 60 }, 'peak')).toContain('aerobic_volume');
    });

    it('fails closed when supplied template and workout ids disagree', () => {
        expect(resolveFixedActivityIdentity(activity({
            templateId: 'end_easy_01',
            workoutId: 'cycling_event_specific_endurance_01',
        }))).toBeNull();
    });

    it('resolves a workout-only identity through the same canonical template mapping', () => {
        expect(resolveFixedActivityIdentity(activity({ workoutId: 'cycling_zone2_standard_01' }))).toMatchObject({
            templateId: 'end_easy_01',
            workoutId: 'cycling_zone2_standard_01',
            modality: 'Cycling',
            category: 'Easy Endurance',
            exactCatalogIdentity: true,
        });
    });

    it('keeps legacy anonymous stimulus unlinked so it cannot invent cycling coverage', () => {
        const identity = resolveFixedActivityIdentity(activity({
            title: 'Football match',
            expectedStimulus: { aerobicEndurance: 0.8, repeatedSurges: 0.8 },
        }));
        expect(identity?.exactCatalogIdentity).toBe(false);
        expect(identity?.occurrenceKey).toBe('fixed:fixed-1');
        expect(coverageKeysForExposure(identity ?? {}, 'peak')).toEqual([]);
    });

    it('resolves a transient external event with scoped inferred identity but never catalog coverage', () => {
        const identity = resolveFixedActivityIdentity(activity({
            id: 'external-event:block:1:race',
            externalAuthoredIdentity: {
                modality: 'Cycling',
                category: 'Hard Endurance',
                stimulusConfidence: 'inferred',
            },
        }));

        expect(identity).toMatchObject({
            occurrenceKey: 'fixed:external-event:block:1:race',
            templateId: 'external-event:block:1:race',
            workoutId: 'external:external-event:block:1:race',
            modality: 'Cycling',
            category: 'Hard Endurance',
            exactCatalogIdentity: false,
            stimulusConfidence: 'inferred',
        });
        expect(coverageKeysForExposure(identity ?? {}, 'peak')).toEqual([]);
    });

    it('fails closed if an activity claims exact catalog and external-derived identity at once', () => {
        expect(resolveFixedActivityIdentity(activity({
            templateId: 'end_easy_01',
            externalAuthoredIdentity: {
                modality: 'Cycling',
                category: 'Easy Endurance',
                stimulusConfidence: 'inferred',
            },
        }))).toBeNull();
    });
});
