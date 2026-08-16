import { describe, expect, it } from 'vitest';
import { critiqueExternalWeek, type ExternalWeekCritiqueInput } from './externalCritique';
import { adjudicateExternalSession } from './externalSession';
import { evaluateReadinessAndSafetyEnvelope } from './rules';
import { createEmptyFatigue } from './fatigue';
import type { PlacedSession } from './externalPlacement';
import type {
    DailyReadiness, DimensionalFatigue, EngineObjectiveInput, ExternalPlanSession,
    MicrocycleState, SubjectiveInput, TrainingSettings, UserContext, WeeklyObjective,
} from './models';

const MONDAY = '2026-08-17';

function session(overrides: Partial<ExternalPlanSession> = {}): ExternalPlanSession {
    return {
        id: 's1', title: 'Threshold 3x12', priority: 'key',
        placement: { week: 1, preferredDay: 'tuesday', flexibility: 'preferred', ifMissed: 'drop' },
        gating: { modality: 'cycling', intensity: 'hard', durationMin: 60, durationMax: 75, environment: 'either', equipment: [] },
        prescription: { summary: '3x12 at threshold.' },
        ...overrides,
    };
}

function placed(date: string, overrides: Partial<ExternalPlanSession> = {}, status: PlacedSession['status'] = 'planned'): PlacedSession {
    return { session: session(overrides), date, status, moved: false };
}

function flatFatigue(value: number): DimensionalFatigue {
    return { systemic: value, cardiovascular: value, lowerBody: value, upperBody: value, impactTissue: value, neuromuscular: value };
}

function objective(overrides: Partial<WeeklyObjective> = {}): WeeklyObjective {
    return {
        id: 'obj-1', key: 'threshold_quality', title: 'Threshold quality',
        requiredCredit: 2, completedCredit: 0, targetExposures: 2, completedExposures: 0,
        targetStimulus: { thresholdPower: 0.8 },
        ...overrides,
    };
}

function microcycle(objectives: WeeklyObjective[] = []): MicrocycleState {
    return { windowStartDate: MONDAY, objectives };
}

function input(overrides: Partial<ExternalWeekCritiqueInput> = {}): ExternalWeekCritiqueInput {
    return {
        weekStartDate: MONDAY,
        planId: 'autumn-block',
        revision: 1,
        placed: [],
        microcycle: microcycle(),
        fatigue: createEmptyFatigue(MONDAY),
        internalStrain: flatFatigue(0),
        internalStrainAsOf: MONDAY,
        weeklyCommitment: { minSessions: 3, targetSessions: 4, maxSessions: 5 },
        ...overrides,
    };
}

function codes(result: ReturnType<typeof critiqueExternalWeek>): string[] {
    return result.findings.map(finding => finding.code);
}

describe('critiqueExternalWeek scope', () => {
    it('reviews only the week under review, not the whole plan', () => {
        const result = critiqueExternalWeek(input({
            placed: [placed(MONDAY), placed('2026-08-19'), placed('2026-08-21'), placed('2026-08-25')],
        }));

        // Three in-week sessions clears the minimum; the fourth belongs to the next week.
        expect(codes(result)).not.toContain('weekly_session_count_outside_commitment');
        expect(result.weekStartDate).toBe(MONDAY);
    });

    it('ignores sessions the overlay dropped or superseded', () => {
        const result = critiqueExternalWeek(input({
            placed: [
                placed(MONDAY), placed('2026-08-19'), placed('2026-08-21'),
                placed('2026-08-22', {}, 'dropped'),
                placed('2026-08-23', {}, 'superseded'),
            ],
        }));

        expect(codes(result)).not.toContain('weekly_session_count_outside_commitment');
    });
});

describe('weekly session count vs commitment', () => {
    it('flags a week that falls short of the declared minimum', () => {
        const result = critiqueExternalWeek(input({ placed: [placed(MONDAY)] }));

        const finding = result.findings.find(item => item.code === 'weekly_session_count_outside_commitment');
        expect(finding?.detail).toContain('below the 3');
        expect(finding?.date).toBeNull();
    });

    it('flags a week that exceeds the declared ceiling', () => {
        const dates = ['2026-08-17', '2026-08-18', '2026-08-19', '2026-08-20', '2026-08-21', '2026-08-22'];
        const result = critiqueExternalWeek(input({
            placed: dates.map((date, index) => placed(date, { id: `s${index}`, gating: { ...session().gating, intensity: 'easy' } })),
        }));

        expect(result.findings.find(item => item.code === 'weekly_session_count_outside_commitment')?.detail)
            .toContain('above the 5');
    });
});

describe('projected fatigue vs tier ceiling', () => {
    it('flags a hard session on a day projected into the recover band', () => {
        const result = critiqueExternalWeek(input({
            placed: [placed(MONDAY)],
            fatigue: { ...createEmptyFatigue(MONDAY), externalLoadFatigue: flatFatigue(0.9), combinedFatigue: flatFatigue(0.9) },
        }));

        const finding = result.findings.find(item => item.code === 'projected_fatigue_exceeds_tier');
        expect(finding?.rule).toBe('PROJECTED_FATIGUE_RECOVER_THRESHOLD');
        expect(finding?.date).toBe(MONDAY);
        expect(finding?.sessionId).toBe('s1');
    });

    it('leaves a recovery session on the same day alone', () => {
        const result = critiqueExternalWeek(input({
            placed: [placed(MONDAY, { gating: { ...session().gating, modality: 'mobility', intensity: 'recovery' } })],
            fatigue: { ...createEmptyFatigue(MONDAY), externalLoadFatigue: flatFatigue(0.9), combinedFatigue: flatFatigue(0.9) },
        }));

        expect(codes(result)).not.toContain('projected_fatigue_exceeds_tier');
    });

    it('flags a costly session in the modify band and clears a cheap one', () => {
        const modifyBand = { ...createEmptyFatigue(MONDAY), externalLoadFatigue: flatFatigue(0.62), combinedFatigue: flatFatigue(0.62) };

        const costly = critiqueExternalWeek(input({ placed: [placed(MONDAY)], fatigue: modifyBand }));
        expect(costly.findings.find(item => item.code === 'projected_fatigue_exceeds_tier')?.rule)
            .toBe('PROJECTED_MODIFY_MAX_SYSTEMIC_COST');

        const cheap = critiqueExternalWeek(input({
            placed: [placed(MONDAY, { gating: { ...session().gating, modality: 'mobility', intensity: 'easy' } })],
            fatigue: modifyBand,
        }));
        expect(codes(cheap)).not.toContain('projected_fatigue_exceeds_tier');
    });

    it('accumulates the week\'s own sessions, so a later day is judged against earlier load', () => {
        // Neither session is a problem in isolation from a rested start; back-to-back-to-back
        // hard days are, and only a forward projection can see that.
        const hard = (id: string): Partial<ExternalPlanSession> => ({ id, gating: { ...session().gating, intensity: 'max' } });
        const result = critiqueExternalWeek(input({
            placed: [placed(MONDAY, hard('a')), placed('2026-08-18', hard('b')), placed('2026-08-19', hard('c'))],
            fatigue: { ...createEmptyFatigue(MONDAY), externalLoadFatigue: flatFatigue(0.35), combinedFatigue: flatFatigue(0.35) },
        }));

        const tierFindings = result.findings.filter(item => item.code === 'projected_fatigue_exceeds_tier');
        expect(tierFindings.length).toBeGreaterThan(0);
        expect(tierFindings.every(item => item.date! > MONDAY)).toBe(true);
    });

    it('charges the day\'s booked commitments before judging what the plan adds', () => {
        const withoutMatch = critiqueExternalWeek(input({
            placed: [placed(MONDAY)],
            fatigue: { ...createEmptyFatigue(MONDAY), externalLoadFatigue: flatFatigue(0.3), combinedFatigue: flatFatigue(0.3) },
        }));
        expect(codes(withoutMatch)).not.toContain('projected_fatigue_exceeds_tier');

        const withMatch = critiqueExternalWeek(input({
            placed: [placed(MONDAY)],
            fatigue: { ...createEmptyFatigue(MONDAY), externalLoadFatigue: flatFatigue(0.3), combinedFatigue: flatFatigue(0.3) },
            fixedActivities: [{
                id: 'match', userId: 'u1', date: MONDAY, title: 'League match', durationMin: 90,
                expectedCost: { systemic: 0.7, cardiovascular: 0.7, lowerBody: 0.7, impactTissue: 0.7, neuromuscular: 0.6 },
                fixed: true, environment: 'outdoor', equipment: [], isCompleted: false, createdAt: '', updatedAt: '',
            }],
        }));
        expect(codes(withMatch)).toContain('projected_fatigue_exceeds_tier');
    });
});

describe('recovery constraints', () => {
    it('flags two anchor-grade sessions on consecutive days', () => {
        const result = critiqueExternalWeek(input({
            placed: [
                placed(MONDAY, { id: 'a' }),
                placed('2026-08-18', { id: 'b' }),
            ],
        }));

        const finding = result.findings.find(item => item.rule === 'QUALITY_SPACING_VIOLATION');
        expect(finding?.code).toBe('recovery_constraint_violation');
        expect(finding?.date).toBe('2026-08-18');
        expect(finding?.sessionId).toBe('b');
    });

    it('flags heavy lower-body work repeated inside the required gap', () => {
        const lift: Partial<ExternalPlanSession> = {
            gating: { modality: 'strength', intensity: 'hard', durationMin: 45, durationMax: 60, environment: 'indoor', equipment: ['free_weights'] },
        };
        const result = critiqueExternalWeek(input({
            placed: [placed(MONDAY, { ...lift, id: 'lift-a' }), placed('2026-08-18', { ...lift, id: 'lift-b' })],
        }));

        expect(result.findings.map(item => item.rule)).toContain('HARD_LOWER_BODY_SPACING_VIOLATION');
    });

    it('reads completed work from before the week, not only the week itself', () => {
        const sunday = '2026-08-16';
        const result = critiqueExternalWeek(input({
            placed: [placed(MONDAY, { id: 'a' })],
            trailingHistory: [{
                date: sunday, modality: 'Cycling', category: 'Hard Endurance',
                role: 'anchor', systemicCost: 0.8, lowerBodyCost: 0.7,
            }],
        }));

        expect(result.findings.find(item => item.rule === 'QUALITY_SPACING_VIOLATION')?.date).toBe(MONDAY);
    });

    it('treats a hard session as anchor-grade from its cost, not only its category', () => {
        // A hard field session is costed at 0.8 systemic but its derived category is
        // "Field Maintenance", which is not in ANCHOR_HISTORY_CATEGORIES. Only
        // normalizeHistory's cost-derived role makes it count as the prior anchor -- so a
        // hard ride the next day has to be flagged.
        const field: Partial<ExternalPlanSession> = {
            gating: { modality: 'field', intensity: 'hard', durationMin: 90, durationMax: 100, environment: 'outdoor', equipment: [] },
        };
        const result = critiqueExternalWeek(input({
            placed: [placed(MONDAY, { ...field, id: 'match' }), placed('2026-08-18', { id: 'ride' })],
        }));

        const finding = result.findings.find(item => item.rule === 'QUALITY_SPACING_VIOLATION');
        expect(finding?.date).toBe('2026-08-18');
        expect(finding?.sessionId).toBe('ride');
    });

    it('leaves an adequately spaced week alone', () => {
        const result = critiqueExternalWeek(input({
            placed: [placed(MONDAY, { id: 'a' }), placed('2026-08-20', { id: 'b' }), placed('2026-08-23', { id: 'c' })],
        }));

        expect(codes(result)).not.toContain('recovery_constraint_violation');
    });
});

describe('unmet weekly objectives', () => {
    it('reports an objective the week\'s sessions cannot satisfy', () => {
        const result = critiqueExternalWeek(input({
            placed: [placed(MONDAY, { id: 'a', gating: { ...session().gating, intensity: 'easy' } })],
            microcycle: microcycle([objective({ key: 'strength_development', title: 'Strength development', targetStimulus: { maxStrength: 0.8 } })]),
        }));

        const finding = result.findings.find(item => item.code === 'unmet_weekly_objective');
        expect(finding?.rule).toBe('objective:strength_development');
        expect(finding?.date).toBeNull();
        expect(finding?.detail).toContain('Strength development');
    });

    it('stays silent when the week covers the objective', () => {
        const lift: Partial<ExternalPlanSession> = {
            gating: { modality: 'strength', intensity: 'hard', durationMin: 45, durationMax: 60, environment: 'indoor', equipment: ['free_weights'] },
        };
        const result = critiqueExternalWeek(input({
            placed: [
                placed(MONDAY, { ...lift, id: 'a' }), placed('2026-08-20', { ...lift, id: 'b' }),
                placed('2026-08-22', { ...lift, id: 'c' }), placed('2026-08-24', { ...lift, id: 'd' }),
            ],
            microcycle: microcycle([objective({
                key: 'strength_development', title: 'Strength development',
                requiredCredit: 0.5, targetExposures: 1, targetStimulus: { maxStrength: 0.8 },
            })]),
            weeklyCommitment: { minSessions: 1, targetSessions: 4, maxSessions: 9 },
        }));

        expect(codes(result)).not.toContain('unmet_weekly_objective');
    });

    it('discounts imported credit at the authoredExternal rung rather than crediting it as exact', () => {
        // The same week credited as an exact catalog match would clear this objective; an
        // imported session must not flatter the plan into looking more complete than it is.
        const nearMiss = microcycle([objective({
            key: 'threshold_quality', title: 'Threshold quality',
            requiredCredit: 0.7, targetExposures: 1, targetStimulus: { thresholdPower: 0.8 },
        })]);
        const result = critiqueExternalWeek(input({
            placed: [placed(MONDAY, { id: 'a' })],
            microcycle: nearMiss,
            weeklyCommitment: { minSessions: 1, targetSessions: 1, maxSessions: 3 },
        }));

        expect(codes(result)).toContain('unmet_weekly_objective');
    });
});

describe('D-CRITIQUE: advisory only', () => {
    function readiness(s: Partial<SubjectiveInput> = {}, o: Partial<EngineObjectiveInput> = {}): DailyReadiness {
        return {
            subjective: {
                readiness: 8, sleepQuality: 8, fatigue: 2, soreness: 2, stress: 2, motivation: 8,
                timeAvailable: 150, painFlag: false, alreadyTrainedToday: false, preferredModalityToday: null, ...s,
            },
            objective: {
                total_steps: 8000, sleep_score: 85, sleep_duration_min: 460, rhr: 48, rhr_7d_avg: 48, rhr_delta: 0,
                hrv_weekly_avg: 60, hrv_last_night: 60, hrv_delta: 0, respiration: 13, body_battery_wake: 85,
                last_3_days_hard_sessions_count: 0, yesterday_training: null, today_training: null,
                sleep_score_delta_7d: 0, rhr_delta_28d: 0, hrv_delta_28d: 0, sleep_score_delta_28d: 0,
                hrv_stdev_28d: 8.5, rhr_stdev_28d: 3.5, sleep_score_stdev_28d: 7.8, ...o,
            },
        };
    }

    function settings(): TrainingSettings {
        return {
            userId: 'athlete', schemaVersion: 3,
            equipment: { free_weights: true, cable_machine: false, treadmill: false, indoor_bike: true, pullup_bar: true },
            guardrails: { avoid_high_impact: false, avoid_heavy_lower_body: false, avoid_overhead_pressing: false, avoid_heavy_spinal_loading: false },
            defaults: { weekdayMaxMinutes: 180, weekendMaxMinutes: 240, environment: 'either' },
            preferences: { preferActiveRecovery: false },
            migration: { legacyReviewed: true, migratedAt: null },
            createdAt: '', updatedAt: '',
        };
    }

    function context(): UserContext {
        return {
            goals: { shortTerm: '', midTerm: '', longTerm: '' },
            constraints: { hasCableMachine: false, hasFreeWeights: true, hasTreadmill: false, hasIndoorBike: true, restrictedModalities: [], maxTimeMinutes: 180 },
            preferences: { avoidedModalities: [], deprioritizedModalities: [], preferredModalities: [], conservativeBias: false },
            trainingSettings: settings(),
        };
    }

    /** The most critique-laden week this module can produce, so the comparison below is
     * not vacuous: every finding type fires on it. */
    const loaded = input({
        placed: [placed(MONDAY, { id: 'a' }), placed('2026-08-18', { id: 'b' })],
        microcycle: microcycle([objective({ key: 'vo2_max', title: 'VO2 max', targetStimulus: { vo2MaxPower: 0.8 } })]),
        fatigue: { ...createEmptyFatigue(MONDAY), externalLoadFatigue: flatFatigue(0.7), combinedFatigue: flatFatigue(0.7) },
    });

    it('produces every finding type on the loaded fixture', () => {
        expect(new Set(codes(critiqueExternalWeek(loaded)))).toEqual(new Set([
            'weekly_session_count_outside_commitment',
            'projected_fatigue_exceeds_tier',
            'recovery_constraint_violation',
            'unmet_weekly_objective',
        ]));
    });

    it('cannot change a verdict: adjudication is identical before and after critiquing', () => {
        const today = readiness();
        const envelope = evaluateReadinessAndSafetyEnvelope(today, context(), MONDAY);
        const dose = { volume: 1, intensity: 1 };

        const before = adjudicateExternalSession(session(), today, context(), envelope, dose, MONDAY);
        critiqueExternalWeek(loaded);
        const after = adjudicateExternalSession(session(), today, context(), envelope, dose, MONDAY);

        expect(after).toEqual(before);
        expect(critiqueExternalWeek(loaded).findings.length).toBeGreaterThan(0);
    });

    it('mutates none of its inputs, so no caller state can be reshaped by a critique', () => {
        const objectives = [objective()];
        const state = microcycle(objectives);
        const snapshot = structuredClone({ state, fatigue: loaded.fatigue, placed: loaded.placed });

        critiqueExternalWeek({ ...loaded, microcycle: state });

        expect({ state, fatigue: loaded.fatigue, placed: loaded.placed }).toEqual(snapshot);
    });

    it('returns findings only, with no verdict-shaped field a caller could mistake for one', () => {
        for (const finding of critiqueExternalWeek(loaded).findings) {
            expect(Object.keys(finding).sort()).toEqual(['code', 'date', 'detail', 'rule', 'sessionId', 'sessionTitle']);
        }
    });
});
