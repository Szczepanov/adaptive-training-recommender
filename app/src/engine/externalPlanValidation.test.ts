import { describe, expect, it } from 'vitest';
import { validateExternalTrainingPlan } from './validation';
import { EXTERNAL_PLAN_SCHEMA } from './models';

/**
 * Phase 8.1 / ADR-0019. The fixture below is the shape the 2026-08-15 round-trip produced,
 * expressed against the *revised* contract: second-granular steps, two-level repetition,
 * an `isEvent` race, and an irreducible dress rehearsal.
 */
function plan(overrides: Record<string, unknown> = {}) {
    return {
        schema: EXTERNAL_PLAN_SCHEMA,
        planId: 'sept-13-road-race-peak',
        revision: 1,
        title: '4-week road race peak',
        startDate: '2026-08-17', // a Monday
        weekCount: 4,
        notes: 'Outdoor power meter is the reference; RPE overrides wattage.',
        sessions: [
            {
                id: 'w1-threshold', title: 'Aerobic Engine 3x15', priority: 'key',
                placement: { week: 1, preferredDay: 'monday', flexibility: 'preferred', ifMissed: 'reschedule_within_week' },
                gating: { modality: 'cycling', intensity: 'hard', durationMin: 90, durationMax: 110, environment: 'either', equipment: [] },
                objectives: ['threshold_quality', 'race_specific_endurance'],
                prescription: {
                    summary: '3x15min at 230-240 W.',
                    steps: [
                        { name: 'Warm-up', durationMin: 20, target: '140-175 W' },
                        { name: 'Interval', durationMin: 15, repeat: 3, recoveryMin: 5, target: '230-240 W' },
                    ],
                },
                scaling: { reducible: true, reducedSummary: '2x12 instead of 3x15.', reducedDurationMin: 60, minimumUsefulDurationMin: 45, fallback: 'Indoor bike is acceptable.' },
            },
            {
                id: 'w1-vo2', title: 'VO2 30/15', priority: 'key',
                placement: { week: 1, preferredDay: 'wednesday', flexibility: 'preferred', ifMissed: 'drop' },
                gating: { modality: 'cycling', intensity: 'hard', durationMin: 60, durationMax: 75, environment: 'either', equipment: [] },
                objectives: ['vo2_max', 'surge_repeatability'],
                prescription: {
                    summary: '3 sets of 10 x 30s/15s.',
                    steps: [
                        // Second-granular with two levels of repetition -- the two things the
                        // round-trip proved a minutes-only, single-level step model cannot say.
                        { name: 'VO2 rep', durationSec: 30, recoverySec: 15, repeat: 10, sets: 3, setRecoveryMin: 4, target: '320-350 W' },
                    ],
                },
                scaling: { reducible: true, reducedSummary: '2 sets of 8.', reducedDurationMin: 45, minimumUsefulDurationMin: 40 },
            },
            {
                id: 'w2-rehearsal', title: 'Full race dress rehearsal', priority: 'key',
                placement: { week: 2, preferredDay: 'saturday', flexibility: 'preferred', ifMissed: 'carry_forward' },
                gating: { modality: 'cycling', intensity: 'hard', durationMin: 80, durationMax: 100, environment: 'outdoor', equipment: [] },
                prescription: { summary: 'Full simulation.' },
                // All-or-nothing: no useful reduced form (D-IRREDUCIBLE).
                scaling: { reducible: false, minimumUsefulDurationMin: 80, fallback: 'A safe route with the same terrain.' },
            },
            {
                id: 'w4-race', title: 'Road Race', priority: 'key',
                placement: { week: 4, preferredDay: 'sunday', flexibility: 'fixed', ifMissed: 'drop' },
                gating: { modality: 'cycling', intensity: 'max', durationMin: 50, durationMax: 60, environment: 'outdoor', equipment: [] },
                prescription: { summary: 'Race tactically.' },
                isEvent: true,
            },
            {
                id: 'w1-strength', title: 'Strength maintenance', priority: 'supporting',
                placement: { week: 1, flexibility: 'any_day', ifMissed: 'drop' },
                gating: { modality: 'strength', intensity: 'moderate', durationMin: 30, durationMax: 40, environment: 'either', equipment: ['free_weights', 'pullup_bar'] },
                objectives: ['strength_maintenance'],
                prescription: { summary: 'Low-fatigue maintenance.' },
            },
        ],
        ...overrides,
    };
}

function sessionWith(patch: Record<string, unknown>) {
    const base = plan();
    base.sessions = [{ ...base.sessions[0], ...patch }] as never;
    return base;
}

function firstError(raw: unknown): string {
    const result = validateExternalTrainingPlan(raw);
    expect(result.isValid).toBe(false);
    return result.errors.map(error => `${error.field}: ${error.message}`).join(' | ');
}

describe('validateExternalTrainingPlan', () => {
    it('accepts the round-trip plan expressed against the revised contract', () => {
        const result = validateExternalTrainingPlan(plan());
        expect(result.errors).toEqual([]);
        expect(result.isValid).toBe(true);
    });

    it('rejects a startDate that is not a Monday', () => {
        expect(firstError(plan({ startDate: '2026-08-18' }))).toContain('startDate must be a Monday');
    });

    it('rejects the fractional minutes the round-trip produced, naming the step', () => {
        // The pre-revision form: 0.5 min for a 30-second rep.
        const raw = sessionWith({ prescription: { summary: 'x', steps: [{ name: 'VO2 rep', durationMin: 0.5, repeat: 30 }] } });
        expect(firstError(raw)).toContain('steps[0].durationMin: Minutes must be a whole number');
    });

    it('rejects a step declaring both minutes and seconds', () => {
        const raw = sessionWith({ prescription: { summary: 'x', steps: [{ name: 'Rep', durationMin: 1, durationSec: 30 }] } });
        expect(firstError(raw)).toContain('Use durationMin or durationSec, not both');
    });

    it('rejects an event session that is not fixed to a day (D-EVENT)', () => {
        const movable = sessionWith({ isEvent: true, placement: { week: 1, preferredDay: 'sunday', flexibility: 'preferred', ifMissed: 'drop' } });
        expect(firstError(movable)).toContain('An event session must be fixed with a preferredDay');

        const dayless = sessionWith({ isEvent: true, placement: { week: 1, flexibility: 'fixed', ifMissed: 'drop' } });
        expect(firstError(dayless)).toContain('preferredDay');
    });

    it('rejects an irreducible session that also declares a reduced form (D-IRREDUCIBLE)', () => {
        const raw = sessionWith({ scaling: { reducible: false, reducedSummary: 'half of it', reducedDurationMin: 40 } });
        expect(firstError(raw)).toContain('An irreducible session must not declare a reduced form');
    });

    it('rejects a week beyond weekCount', () => {
        const raw = sessionWith({ placement: { week: 5, flexibility: 'any_day', ifMissed: 'drop' } });
        expect(firstError(raw)).toContain('Week must be 1-4');
    });

    it('rejects unrecognised fields rather than silently dropping them', () => {
        expect(firstError(plan({ cadence: 90 }))).toContain('Unrecognized field(s): cadence');
        expect(firstError(sessionWith({ rpe: 7 }))).toContain('Unrecognized session field(s): rpe');
    });

    it('rejects plausible-but-unsupported enum values', () => {
        expect(firstError(sessionWith({ gating: { ...plan().sessions[0].gating, modality: 'strength_training' } })))
            .toContain('Unsupported modality');
        expect(firstError(sessionWith({ gating: { ...plan().sessions[0].gating, intensity: 'tempo' } })))
            .toContain('Unsupported intensity');
        expect(firstError(sessionWith({ objectives: ['aerobic_base'] }))).toContain('supported objective keys');
    });

    it('rejects duplicate session ids', () => {
        const raw = plan();
        raw.sessions = [raw.sessions[0], { ...raw.sessions[1], id: raw.sessions[0].id }] as never;
        expect(firstError(raw)).toContain('Session ids must be unique');
    });

    it('rejects durationMin above durationMax and out-of-range durations', () => {
        expect(firstError(sessionWith({ gating: { ...plan().sessions[0].gating, durationMin: 120, durationMax: 60 } })))
            .toContain('durationMin must not exceed durationMax');
        expect(firstError(sessionWith({ gating: { ...plan().sessions[0].gating, durationMin: 2, durationMax: 4 } })))
            .toContain('5-360');
    });

    it('rejects a plan over the published bounds', () => {
        expect(firstError(plan({ weekCount: 27 }))).toContain('weekCount must be 1-26');
        const many = plan();
        many.sessions = Array.from({ length: 121 }, (_, index) => ({ ...many.sessions[0], id: `s${index}` })) as never;
        expect(firstError(many)).toContain('At most 120 sessions');
    });

    it('rejects the wrong schema literal, so a future contract cannot be read as this one', () => {
        expect(firstError(plan({ schema: 'adaptive-training-recommender/external-plan@2' }))).toContain('Schema must be');
    });
});
