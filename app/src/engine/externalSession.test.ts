import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    adjudicateExternalSession,
    EXTERNAL_MODIFY_MAX_SYSTEMIC_COST,
    EXTERNAL_PLAN_TIER_SYSTEMIC_COST_CEILING,
    type ExternalSessionDecision,
} from './externalSession';
import { evaluateReadinessAndSafetyEnvelope } from './rules';
import type {
    DailyReadiness, EngineObjectiveInput, ExternalPlanSession, PlannedDose,
    SubjectiveInput, TrainingSettings, UserContext,
} from './models';

const DATE = '2026-08-18'; // Tuesday
const FULL_DOSE: PlannedDose = { volume: 1, intensity: 1 };

function subjective(overrides: Partial<SubjectiveInput> = {}): SubjectiveInput {
    return {
        readiness: 8, sleepQuality: 8, fatigue: 2, soreness: 2, stress: 2, motivation: 8,
        timeAvailable: 120, painFlag: false, alreadyTrainedToday: false, preferredModalityToday: null,
        ...overrides,
    };
}

function objective(overrides: Partial<EngineObjectiveInput> = {}): EngineObjectiveInput {
    return {
        total_steps: 8000, sleep_score: 85, sleep_duration_min: 460, rhr: 48, rhr_7d_avg: 48, rhr_delta: 0,
        hrv_weekly_avg: 60, hrv_last_night: 60, hrv_delta: 0, respiration: 13, body_battery_wake: 85,
        last_3_days_hard_sessions_count: 0, yesterday_training: null, today_training: null,
        sleep_score_delta_7d: 0, rhr_delta_28d: 0, hrv_delta_28d: 0, sleep_score_delta_28d: 0,
        hrv_stdev_28d: 8.5, rhr_stdev_28d: 3.5, sleep_score_stdev_28d: 7.8,
        ...overrides,
    };
}

function readiness(s: Partial<SubjectiveInput> = {}, o: Partial<EngineObjectiveInput> = {}): DailyReadiness {
    return { subjective: subjective(s), objective: objective(o) };
}

function settings(overrides: Partial<TrainingSettings> = {}): TrainingSettings {
    return {
        userId: 'athlete', schemaVersion: 3,
        equipment: { free_weights: true, cable_machine: false, treadmill: false, indoor_bike: true, pullup_bar: true },
        guardrails: { avoid_high_impact: false, avoid_heavy_lower_body: false, avoid_overhead_pressing: false, avoid_heavy_spinal_loading: false },
        defaults: { weekdayMaxMinutes: 180, weekendMaxMinutes: 240, environment: 'either' },
        preferences: { preferActiveRecovery: false },
        migration: { legacyReviewed: true, migratedAt: null },
        createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
        ...overrides,
    };
}

function context(constraints: Partial<UserContext['constraints']> = {}, trainingSettings = settings()): UserContext {
    return {
        goals: { shortTerm: '', midTerm: '', longTerm: '' },
        constraints: {
            hasCableMachine: false, hasFreeWeights: true, hasTreadmill: false, hasIndoorBike: true,
            restrictedModalities: [], maxTimeMinutes: 180, ...constraints,
        },
        preferences: { avoidedModalities: [], deprioritizedModalities: [], preferredModalities: [], conservativeBias: false },
        trainingSettings,
    };
}

function session(overrides: Partial<ExternalPlanSession> = {}): ExternalPlanSession {
    return {
        id: 'w1-threshold', title: 'Threshold 3x12', priority: 'key',
        placement: { week: 1, preferredDay: 'tuesday', flexibility: 'preferred', ifMissed: 'reschedule_within_week' },
        gating: { modality: 'cycling', intensity: 'hard', durationMin: 60, durationMax: 75, environment: 'either', equipment: [] },
        prescription: { summary: '3x12 at threshold.' },
        scaling: { reducible: true, reducedSummary: '2x12 instead of 3x12.', reducedDurationMin: 45, minimumUsefulDurationMin: 30 },
        ...overrides,
    };
}

function adjudicate(s: ExternalPlanSession, r: DailyReadiness, c: UserContext = context(), dose: PlannedDose = FULL_DOSE) {
    return adjudicateExternalSession(s, r, c, evaluateReadinessAndSafetyEnvelope(r, c, DATE), dose, DATE);
}

/** Readiness states that reach each mode, used to sweep the property tests. */
const READINESS_STATES: ReadonlyArray<{ label: string; value: DailyReadiness }> = [
    { label: 'green', value: readiness() },
    { label: 'sore', value: readiness({ soreness: 7 }) },
    { label: 'fatigued', value: readiness({ fatigue: 8, soreness: 8, readiness: 2, sleepQuality: 2, motivation: 2 }) },
    { label: 'pain', value: readiness({ painFlag: true }) },
    { label: 'already trained', value: readiness({ alreadyTrainedToday: true }) },
    { label: 'flat battery', value: readiness({}, { body_battery_wake: 10 }) },
];

describe('adjudicateExternalSession', () => {
    it('proceeds when readiness and constraints both clear the session', () => {
        const verdict = adjudicate(session(), readiness());
        expect(verdict.decision).toBe('proceed');
        expect(verdict.executionDose).toBeDefined();
        expect(verdict.gateFailures).toEqual([]);
    });

    it('skips on a clinical exclusion and says it is a safety call, not a dose call', () => {
        const verdict = adjudicate(
            session({ gating: { ...session().gating, modality: 'running' } }),
            readiness({ painFlag: true }),
        );
        expect(verdict.decision).toBe('skip');
        expect(verdict.rationale).toContain('safety exclusion, not a dose decision');
    });

    it('skips on feasibility and echoes the author fallback as context only', () => {
        const verdict = adjudicate(
            session({
                gating: { ...session().gating, equipment: ['treadmill'] },
                scaling: { fallback: 'Ride outside instead.' },
            }),
            readiness(),
        );
        expect(verdict.decision).toBe('skip');
        expect(verdict.gateFailures).toContain('equipment');
        expect(verdict.fallbackSuggestion).toBe('Ride outside instead.');
        expect(verdict.rationale).toContain('has not been checked against today\'s constraints');
    });

    it('defers rather than scaling when readiness mandates recovery', () => {
        const verdict = adjudicate(session(), readiness({ fatigue: 9, soreness: 9, readiness: 1, sleepQuality: 1, motivation: 1 }));
        expect(verdict.decision).toBe('defer');
        expect(verdict.executionDose).toBeUndefined();
    });

    it('scales a costly session in modify mode using the author\'s own reduced form', () => {
        const verdict = adjudicate(session(), readiness({ soreness: 7 }));
        expect(verdict.decision).toBe('scale');
        expect(verdict.scaledSummary).toBe('2x12 instead of 3x12.');
    });

    it('scales without a summary when the plan gives no reduced form, and says so', () => {
        const verdict = adjudicate(session({ scaling: { reducible: true } }), readiness({ soreness: 7 }));
        expect(verdict.decision).toBe('scale');
        expect(verdict.scaledSummary).toBeUndefined();
        expect(verdict.rationale).toContain('no reduced form');
    });

    it('defers instead of scaling an irreducible session (D-IRREDUCIBLE)', () => {
        const verdict = adjudicate(session({ scaling: { reducible: false } }), readiness({ soreness: 7 }));
        expect(verdict.decision).toBe('defer');
        expect(verdict.rationale).toContain('no useful reduced form');
    });

    it('defers when the ceiling would cut below the author\'s minimum useful dose', () => {
        // Body battery under 25 caps the plan tier at Easy, which halves volume.
        const verdict = adjudicate(
            session({ scaling: { reducible: true, minimumUsefulDurationMin: 55 } }),
            readiness({}, { body_battery_wake: 22 }),
        );
        expect(verdict.decision).toBe('defer');
        expect(verdict.rationale).toContain('minimum useful dose');
    });

    it('skips rather than guessing when the planned dose is out of contract', () => {
        // resolveExecutionDose fails closed on these; a normalised guess would be
        // persisted into an audit that requires finite volume in 0..1.
        for (const broken of [{ volume: 1.4, intensity: 1 }, { volume: Number.NaN, intensity: 1 }, { volume: 0.5, intensity: 9 }]) {
            const verdict = adjudicate(session(), readiness(), context(), broken);
            expect(verdict.decision, JSON.stringify(broken)).toBe('skip');
            expect(verdict.executionDose).toBeUndefined();
            expect(verdict.rationale).toContain('outside the supported contract');
        }
    });

    it('defers when the ceiling leaves no volume at all', () => {
        const verdict = adjudicate(session({ scaling: undefined }), readiness({ alreadyTrainedToday: true }));
        expect(['defer', 'skip']).toContain(verdict.decision);
        expect(verdict.executionDose).toBeUndefined();
    });

    it('applies the plan-tier ceiling even on a train-mode day', () => {
        // A flat body battery caps the tier at Easy while readiness still reads green, so
        // checking only the modify ceiling let a hard session through a day that excludes
        // every equivalent catalog template.
        const verdict = adjudicate(session({ scaling: { reducible: true, reducedSummary: 'half' } }), readiness({}, { body_battery_wake: 22 }));
        expect(verdict.decision).not.toBe('proceed');
    });

    it('honours the minimum useful floor on the scale path, not only on proceed', () => {
        // The scale branch is the one that actually cuts volume, so skipping the floor
        // there let it prescribe below the author's declared minimum.
        const verdict = adjudicate(
            session({ scaling: { reducible: true, reducedSummary: 'half', minimumUsefulDurationMin: 55 } }),
            readiness({ soreness: 7 }, { body_battery_wake: 22 }),
        );
        expect(verdict.decision).toBe('defer');
        expect(verdict.rationale).toContain('minimum useful dose');
    });

    it('actually cuts volume when it says scale, even at a tier that would not cut it', () => {
        // resolveExecutionDose caps by readiness *tier*, which is derived independently of
        // `mode`. A modify day at a high tier therefore leaves the planned volume untouched,
        // and returning that under a `scale` verdict tells the athlete to do the reduced
        // version while showing them the full prescription.
        const proceeded = adjudicate(session(), readiness());
        const scaled = adjudicate(session(), readiness({ soreness: 7 }));

        expect(proceeded.decision).toBe('proceed');
        expect(scaled.decision).toBe('scale');
        expect(scaled.executionDose!.volume).toBeLessThan(proceeded.executionDose!.volume);
    });

    it('cuts to the author\'s own reduced duration when they gave one', () => {
        const authored = session({
            scaling: { reducible: true, reducedSummary: '2x12', reducedDurationMin: 30 },
            gating: { modality: 'cycling', intensity: 'hard', durationMin: 60, durationMax: 75, environment: 'either', equipment: [] },
        });
        const proceeded = adjudicate(session(), readiness());
        const scaled = adjudicate(authored, readiness({ soreness: 7 }));

        // Their 30-of-60 halving, not a figure this engine invented.
        expect(scaled.executionDose!.volume).toBeCloseTo(proceeded.executionDose!.volume * 0.5, 6);
    });

    it('leaves a low-cost session alone in modify mode', () => {
        const mobility = session({
            gating: { modality: 'mobility', intensity: 'easy', durationMin: 30, durationMax: 40, environment: 'either', equipment: [] },
            scaling: undefined,
        });
        expect(adjudicate(mobility, readiness({ soreness: 7 })).decision).toBe('proceed');
    });
});

describe('D-EVENT: an event is advised, never instructed', () => {
    const event = session({
        id: 'race', title: 'Road Race', isEvent: true,
        placement: { week: 4, preferredDay: 'sunday', flexibility: 'fixed', ifMissed: 'drop' },
        gating: { modality: 'cycling', intensity: 'max', durationMin: 50, durationMax: 60, environment: 'outdoor', equipment: [] },
        scaling: undefined,
    });

    it('returns advisory under every readiness state, never skip, defer or scale', () => {
        for (const state of READINESS_STATES) {
            const verdict = adjudicate(event, state.value);
            expect(verdict.decision, `readiness: ${state.label}`).toBe('advisory');
        }
    });

    it('stays advisory even when a hard feasibility gate fails', () => {
        const unavailable = adjudicate(
            { ...event, gating: { ...event.gating, equipment: ['treadmill'] } },
            readiness({ painFlag: true }),
        );
        expect(unavailable.decision).toBe('advisory');
        expect(unavailable.gateFailures.length).toBeGreaterThan(0);
    });

    it('names what the athlete should weigh, and hands them the decision', () => {
        const concerning = adjudicate(event, readiness({ painFlag: true }));
        expect(concerning.rationale).toContain('the decision to start is yours');
        expect(concerning.rationale).toMatch(/pain|injury/i);

        const clear = adjudicate(event, readiness());
        expect(clear.rationale).toContain('Nothing in today\'s readiness');
    });
});

describe('invariants that must hold for any input', () => {
    const ACTIONABLE: ExternalSessionDecision[] = ['proceed', 'scale'];

    it('never returns proceed when a hard gate failed', () => {
        const blocked = [
            session({ gating: { ...session().gating, equipment: ['treadmill'] } }),
            session({ gating: { ...session().gating, modality: 'running' } }),
            session({ gating: { ...session().gating, durationMin: 300, durationMax: 320 } }),
        ];
        for (const candidate of blocked) {
            for (const state of READINESS_STATES) {
                const verdict = adjudicate(candidate, state.value, context({ restrictedModalities: ['Running'] }));
                if (verdict.gateFailures.length > 0 && !candidate.isEvent) {
                    expect(ACTIONABLE, `${candidate.gating.modality} / ${state.label}`).not.toContain(verdict.decision);
                }
            }
        }
    });

    it('never returns scale for an irreducible session, under any readiness', () => {
        const irreducible = session({ scaling: { reducible: false, minimumUsefulDurationMin: 30 } });
        for (const state of READINESS_STATES) {
            expect(adjudicate(irreducible, state.value).decision, `readiness: ${state.label}`).not.toBe('scale');
        }
    });

    it('never reads reducedSummary for an irreducible session', () => {
        const irreducible = session({ scaling: { reducible: false } });
        for (const state of READINESS_STATES) {
            expect(adjudicate(irreducible, state.value).scaledSummary).toBeUndefined();
        }
    });

    it('never returns a fallback suggestion as an actionable decision', () => {
        const withFallback = session({
            gating: { ...session().gating, equipment: ['cable_machine'] },
            scaling: { fallback: 'Do something else entirely.' },
        });
        for (const state of READINESS_STATES) {
            const verdict = adjudicate(withFallback, state.value);
            if (verdict.fallbackSuggestion !== undefined) {
                expect(ACTIONABLE).not.toContain(verdict.decision);
            }
        }
    });

    it('performs no I/O — the module imports no service or firebase dependency', () => {
        const source = readFileSync(join(import.meta.dirname, 'externalSession.ts'), 'utf8');
        expect(source).not.toMatch(/from '\.\.\/services\//);
        expect(source).not.toMatch(/firebase/);
    });
});

describe('ceiling constants', () => {
    it('the plan-tier ceiling matches rules.ts, which owns the real one', () => {
        const rulesSource = readFileSync(join(import.meta.dirname, 'rules.ts'), 'utf8');
        const block = rulesSource.match(/PLAN_TIER_SYSTEMIC_COST_CEILING[^=]*=\s*\{([^}]*)\}/);
        expect(block, 'PLAN_TIER_SYSTEMIC_COST_CEILING not found in rules.ts').not.toBeNull();
        for (const [tier, value] of Object.entries(EXTERNAL_PLAN_TIER_SYSTEMIC_COST_CEILING)) {
            const expected = value === Infinity ? 'Infinity' : String(value);
            expect(block![1], tier).toMatch(new RegExp(`${tier}:\\s*(${expected}|MODIFY_MAX_SYSTEMIC_COST)`));
        }
    });

    it('the modify ceiling matches rules.ts, which owns the real one', () => {
        // Duplicated rather than imported so this module stays off the selection path, and
        // so exporting it would not drag rules.ts into check-policy-drift for a no-op edit.
        // Read from source instead, so the two cannot silently diverge.
        const rulesSource = readFileSync(join(import.meta.dirname, 'rules.ts'), 'utf8');
        const match = rulesSource.match(/MODIFY_MAX_SYSTEMIC_COST\s*=\s*([\d.]+)/);
        expect(match, 'MODIFY_MAX_SYSTEMIC_COST not found in rules.ts').not.toBeNull();
        expect(Number(match![1])).toBe(EXTERNAL_MODIFY_MAX_SYSTEMIC_COST);
    });
});
