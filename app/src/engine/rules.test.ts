import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
    buildNextDayScenarios, evaluateTraining, evaluateNextDayPlan, evaluateNextDayPlanWithIntent, adjustSessionRecommendation, evaluateEnvelopes,
    evaluateReadinessAndSafetyEnvelope, subjectiveDriftStrain, REFERENCE_SUBJECTIVE_DRIFT_WEIGHTS, type SubjectiveDriftWeights,
} from './rules';
import type { TrainingHistoryProvider } from './trainingHistory';
import type { DailyReadiness, UserContext, EngineObjectiveInput, SubjectiveInput, TrainingSettings } from './models';
import type { SubjectiveBaseline, SubjectiveBaselineMetric, SubjectiveMetricBaseline } from './subjectiveBaseline';
import { mapContextFromGoalsAndTrainingSettings } from './adapters';
import { TEMPLATES } from './templates';

// --- Fixtures --------------------------------------------------------------

function baseContext(overrides: Partial<UserContext['preferences']> = {}): UserContext {
    return {
        goals: { shortTerm: '', midTerm: '', longTerm: '' },
        constraints: {
            hasCableMachine: false,
            hasFreeWeights: true,
            hasTreadmill: false,
            hasIndoorBike: false,
            restrictedModalities: [],
            maxTimeMinutes: 90,
        },
        preferences: {
            avoidedModalities: [],
            deprioritizedModalities: [],
            preferredModalities: [],
            conservativeBias: false,
            ...overrides,
        },
    };
}

function neutralSubjective(overrides: Partial<SubjectiveInput> = {}): SubjectiveInput {
    return {
        readiness: 5, sleepQuality: 5, fatigue: 5, soreness: 5, stress: 5, motivation: 5,
        timeAvailable: 60, painFlag: false, alreadyTrainedToday: false, preferredModalityToday: null,
        ...overrides,
    };
}

function greenSubjective(overrides: Partial<SubjectiveInput> = {}): SubjectiveInput {
    return neutralSubjective({ readiness: 9, sleepQuality: 9, fatigue: 2, soreness: 2, motivation: 9, ...overrides });
}

/** All deltas null / no strain contribution -- isolates whatever the caller overrides. */
function quietObjective(overrides: Partial<EngineObjectiveInput> = {}): EngineObjectiveInput {
    return {
        total_steps: 8000, sleep_score: 85, sleep_duration_min: 450, rhr: 50, rhr_7d_avg: 50, rhr_delta: 0,
        hrv_weekly_avg: 50, hrv_last_night: 50, hrv_delta: 0, respiration: 14, body_battery_wake: 85,
        last_3_days_hard_sessions_count: 0, yesterday_training: null, today_training: null,
        sleep_score_delta_7d: 0, rhr_delta_28d: 0, hrv_delta_28d: 0, sleep_score_delta_28d: 0,
        hrv_stdev_28d: 8.5, rhr_stdev_28d: 3.5, sleep_score_stdev_28d: 7.8,
        ...overrides,
    };
}

// --- Baseline-relative strain scoring --------------------------------------

describe('objective strain scoring', () => {
    it('a single-night HRV dip within normal night-to-night noise does not trigger modify', () => {
        // -6ms is well under 1 SD for a person with an 8.5ms trailing stdev -- this used
        // to be an automatic "modify" under the old fixed "-5ms" threshold.
        const objective = quietObjective({ hrv_delta: -6, hrv_delta_28d: -6 });
        const rec = evaluateTraining({ subjective: greenSubjective(), objective }, baseContext(), '2026-08-01');
        expect(rec.mode).toBe('train');
    });

    it('a larger HRV dip combined with elevated RHR crosses into modify', () => {
        const objective = quietObjective({ hrv_delta: -12, hrv_delta_28d: -12, rhr_delta: 5, rhr_delta_28d: 5 });
        const rec = evaluateTraining({ subjective: greenSubjective(), objective }, baseContext(), '2026-08-01');
        expect(rec.mode).toBe('modify');
    });

    it('chronic drift (7d baseline sinking below 28d) adds strain even when the acute reading looks fine', () => {
        // Today's HRV sits right at its own 7d baseline (no acute red flag) but that 7d
        // baseline itself has drifted well below the 28d baseline -- a multi-day decline
        // the old engine (7d-delta-only) could never see.
        const stable = quietObjective({ hrv_delta: 0, hrv_delta_28d: 0 });
        const declining = quietObjective({ hrv_delta: 0, hrv_delta_28d: -15 });
        const stableRec = evaluateTraining({ subjective: greenSubjective(), objective: stable }, baseContext(), '2026-08-01');
        const decliningRec = evaluateTraining({ subjective: greenSubjective(), objective: declining }, baseContext(), '2026-08-01');
        expect(stableRec.mode).toBe('train');
        expect(decliningRec.mode).not.toBe('train');
    });

    it('a genuinely poor absolute sleep score tips an otherwise-borderline day into modify', () => {
        // SLEEP_SCORE_ABSOLUTE_FLOOR_STRAIN is deliberately a modest, additive-only
        // contribution (see rules.ts) -- it's not meant to single-handedly force a mode
        // change, so this pairs it with a day that's already close to the modify
        // threshold from other signals, then shows crossing the absolute floor is what
        // tips it over.
        const nearBorderline = quietObjective({ hrv_delta: -8, hrv_delta_28d: -8, rhr_delta: 3, rhr_delta_28d: 3 });
        const withBadSleep = quietObjective({ ...nearBorderline, sleep_score: 45, sleep_score_delta_7d: 0, sleep_score_delta_28d: 0 });
        const borderlineRec = evaluateTraining({ subjective: greenSubjective(), objective: nearBorderline }, baseContext(), '2026-08-01');
        const badSleepRec = evaluateTraining({ subjective: greenSubjective(), objective: withBadSleep }, baseContext(), '2026-08-01');
        expect(borderlineRec.mode).toBe('train');
        expect(badSleepRec.mode).toBe('modify');
    });

    it('two or more hard sessions in the last 3 days pushes toward modify even with a great morning', () => {
        const objective = quietObjective({ last_3_days_hard_sessions_count: 2 });
        const rec = evaluateTraining({ subjective: greenSubjective(), objective }, baseContext(), '2026-08-01');
        expect(rec.mode).not.toBe('train');
    });

    it('conservativeBias nudges a borderline day from train to modify', () => {
        const objective = quietObjective({ hrv_delta: -5, hrv_delta_28d: -5, rhr_delta: 3, rhr_delta_28d: 3, sleep_score: 80, sleep_score_delta_7d: -2, sleep_score_delta_28d: -2 });
        const normal = evaluateTraining({ subjective: greenSubjective(), objective }, baseContext(), '2026-08-01');
        const conservative = evaluateTraining({ subjective: greenSubjective(), objective }, baseContext({ conservativeBias: true }), '2026-08-01');
        expect(normal.mode).toBe('train');
        expect(conservative.mode).toBe('modify');
    });
});

// --- Systemic-cost gating on 'modify' days ---------------------------------

describe('modify-mode systemic cost gating', () => {
    it('upper-body strength is reachable on a modify day (unlike the old category allow-list)', () => {
        const objective = quietObjective({ hrv_delta: -12, hrv_delta_28d: -12, rhr_delta: 5, rhr_delta_28d: 5 });
        const context = baseContext();
        const categoriesSeen = new Set<string>();
        for (let i = 1; i <= 28; i++) {
            const date = `2026-08-${String(i).padStart(2, '0')}`;
            const rec = evaluateTraining({ subjective: greenSubjective(), objective }, context, date);
            expect(rec.mode).toBe('modify');
            categoriesSeen.add(rec.template.category);
        }
        expect(categoriesSeen.has('Upper-body Strength')).toBe(true);
        expect(categoriesSeen.has('Full-body Strength')).toBe(true); // str_full_03 is intentionally modify-admissible.
        // The genuinely high-cost categories remain excluded; the gate is a cost contract, not a category ban.
        expect(categoriesSeen.has('Hard Endurance')).toBe(false);
        expect(categoriesSeen.has('Lower-body Strength')).toBe(false);
        expect(categoriesSeen.has('Moderate Endurance')).toBe(false);
    });

    it('recover mode never offers anything beyond Rest/Mobility, regardless of preferences', () => {
        const objective = quietObjective({
            sleep_score: 40, sleep_score_delta_7d: -30, sleep_score_delta_28d: -30,
            hrv_delta: -20, hrv_delta_28d: -20,
            rhr_delta: 8, rhr_delta_28d: 8,
        });
        const rec = evaluateTraining({ subjective: greenSubjective(), objective }, baseContext(), '2026-08-01');
        expect(rec.mode).toBe('recover');
        expect(['Rest', 'Mobility/Recovery']).toContain(rec.template.category);
    });
});

// --- Modality preferences ---------------------------------------------------

describe('modality preferences', () => {
    it('honors an explicit train-day ask for something gentler than train mode would normally offer', () => {
        const rec = evaluateTraining(
            { subjective: greenSubjective({ preferredModalityToday: 'Mobility' }), objective: quietObjective() },
            baseContext(), '2026-08-01'
        );
        expect(rec.mode).toBe('train');
        expect(rec.template.category).toBe('Mobility/Recovery');
        expect(rec.rationale).toContain('mobility');
    });

    it('satisfies a modify-day modality ask from within the safe tier rather than refusing it', () => {
        // "Running" matches both Easy Endurance (in-ceiling) and Hard Endurance
        // (above-ceiling) templates -- must resolve to the former without a "can't honor" note.
        const objective = quietObjective({ hrv_delta: -12, hrv_delta_28d: -12, rhr_delta: 5, rhr_delta_28d: 5 });
        const rec = evaluateTraining(
            { subjective: greenSubjective({ preferredModalityToday: 'Running' }), objective },
            baseContext(), '2026-08-01'
        );
        expect(rec.mode).toBe('modify');
        expect(rec.template.modality).toBe('Running');
        expect(rec.template.category).toBe('Easy Endurance');
        expect(rec.rationale).not.toContain("don't have a matching session");
        expect(rec.rationale).not.toContain("don't support it");
    });

    it('narrows a modify-day Strength ask to an in-ceiling strength variant, including reduced Full-body maintenance', () => {
        const objective = quietObjective({ hrv_delta: -12, hrv_delta_28d: -12, rhr_delta: 5, rhr_delta_28d: 5 });
        for (let i = 1; i <= 14; i++) {
            const date = `2026-08-${String(i).padStart(2, '0')}`;
            const rec = evaluateTraining(
                { subjective: greenSubjective({ preferredModalityToday: 'Strength' }), objective },
                baseContext(), date
            );
            expect(rec.mode).toBe('modify');
            expect(rec.template.modality).toBe('Strength');
            expect(rec.template.systemicCost).toBeLessThanOrEqual(0.5);
            expect(['Upper-body Strength', 'Power Maintenance', 'Full-body Strength']).toContain(rec.template.category);
        }
    });

    it('falls back with a distinct note when the requested modality has no matching template at all', () => {
        const rec = evaluateTraining(
            { subjective: greenSubjective({ preferredModalityToday: 'Swimming' }), objective: quietObjective() },
            baseContext(), '2026-08-01'
        );
        expect(rec.rationale).toContain("don't have a matching session type in the catalog yet");
    });

    it('avoidedModalities is a hard exclude across every mode', () => {
        const context = baseContext({ avoidedModalities: ['Strength'] });
        const objective = quietObjective();
        const modalitiesSeen = new Set<string>();
        for (let i = 1; i <= 28; i++) {
            const date = `2026-08-${String(i).padStart(2, '0')}`;
            const rec = evaluateTraining({ subjective: greenSubjective(), objective }, context, date);
            modalitiesSeen.add(rec.template.modality);
        }
        expect(modalitiesSeen.has('Strength')).toBe(false);
    });
});

// --- Overrides that take precedence over everything else -------------------

describe('already-trained-today override', () => {
    it('forces recover mode even on an otherwise green-light day', () => {
        const rec = evaluateTraining(
            { subjective: greenSubjective({ alreadyTrainedToday: true }), objective: quietObjective() },
            baseContext(), '2026-08-01'
        );
        expect(rec.mode).toBe('recover');
    });

    it('a Garmin-synced same-day session has the same effect as the self-reported flag', () => {
        const objective = quietObjective({
            today_training: { type: 'running', duration_min: 30, training_effect: 2.0, intensity_tag: 'moderate/easy' },
        });
        const rec = evaluateTraining({ subjective: greenSubjective(), objective }, baseContext(), '2026-08-01');
        expect(rec.mode).toBe('recover');
    });
});

describe('extreme fatigue / pain override', () => {
    it('a pain flag forces recover regardless of otherwise-good objective data', () => {
        const rec = evaluateTraining(
            { subjective: greenSubjective({ painFlag: true }), objective: quietObjective() },
            baseContext(), '2026-08-01'
        );
        expect(rec.mode).toBe('recover');
    });
});

// --- Hysteresis --------------------------------------------------------------

describe('post-recover-day hysteresis', () => {
    const greatDayReadiness: DailyReadiness = { subjective: greenSubjective(), objective: quietObjective() };

    it('a great morning right after a recover day is softened to modify', () => {
        const rec = evaluateTraining(greatDayReadiness, baseContext(), '2026-08-01', 'recover');
        expect(rec.mode).toBe('modify');
        expect(rec.rationale).toContain('mandated recovery day');
    });

    it('is inert with no previous-day history', () => {
        const rec = evaluateTraining(greatDayReadiness, baseContext(), '2026-08-01');
        expect(rec.mode).toBe('train');
    });

    it('does not apply when yesterday was train or modify', () => {
        expect(evaluateTraining(greatDayReadiness, baseContext(), '2026-08-01', 'train').mode).toBe('train');
        expect(evaluateTraining(greatDayReadiness, baseContext(), '2026-08-01', 'modify').mode).toBe('train');
    });

    it('never masks an independently bad day (buffer does not fight fatigueTriggeredRecover)', () => {
        const badDay: DailyReadiness = {
            subjective: greenSubjective({ fatigue: 9, soreness: 9 }),
            objective: quietObjective(),
        };
        const rec = evaluateTraining(badDay, baseContext(), '2026-08-01', 'recover');
        expect(rec.mode).toBe('recover');
    });
});

// --- Constraints: time and equipment ----------------------------------------

describe('constraint filtering', () => {
    it('never selects a template requiring equipment the user does not have', () => {
        const context = baseContext();
        context.constraints.hasFreeWeights = false;
        context.constraints.hasCableMachine = false;
        context.constraints.hasIndoorBike = false;
        context.constraints.hasTreadmill = false;
        for (let i = 1; i <= 20; i++) {
            const date = `2026-08-${String(i).padStart(2, '0')}`;
            const rec = evaluateTraining({ subjective: greenSubjective(), objective: quietObjective() }, context, date);
            expect(rec.template.requiredEquipment).toEqual([]);
        }
    });

    it('never selects a template longer than the available time', () => {
        const context = baseContext();
        const rec = evaluateTraining(
            { subjective: greenSubjective({ timeAvailable: 10 }), objective: quietObjective() },
            context, '2026-08-01'
        );
        expect(rec.template.durationMin).toBeLessThanOrEqual(10);
    });

    it('never selects Race-Specific Endurance, since evaluateTraining has no PeriodizationResult to gate it against', () => {
        // Regression guard for a phase-gated category (see engine/templates.ts's
        // end_race_specific_01/end_race_sim_01/etc): Path A (evaluateTraining) takes no
        // `events` argument at all, so a template whose phaseEligibility requires a focus
        // event can never legitimately be selected here, on any input, on any day.
        const context = baseContext({ preferredModalities: ['Cycling'] });
        context.constraints.hasIndoorBike = true;
        for (let i = 1; i <= 30; i++) {
            const date = `2026-08-${String(i).padStart(2, '0')}`;
            const rec = evaluateTraining({ subjective: greenSubjective(), objective: quietObjective() }, context, date);
            expect(rec.template.category).not.toBe('Race-Specific Endurance');
        }
    });

    it('an explicit "Cycling" ask cannot widen the search pool into Race-Specific Endurance either', () => {
        // The 'train'-mode explicit-ask path deliberately searches every constraint-eligible
        // template of the asked modality (see applyModalityPreference), not just the mode's
        // usual category allowlist -- phase-gated templates must be excluded upstream of
        // that widening (availableTemplates itself), or an explicit ask would bypass the
        // category allowlist entirely and reach an event-proximity-gated session with no
        // way to check how far away the event actually is.
        const context = baseContext();
        context.constraints.hasIndoorBike = true;
        const rec = evaluateTraining(
            { subjective: greenSubjective({ preferredModalityToday: 'Cycling' }), objective: quietObjective() },
            context, '2026-08-01'
        );
        expect(rec.template.modality).toBe('Cycling');
        expect(rec.template.category).not.toBe('Race-Specific Endurance');
    });
});

// --- evaluateNextDayPlan -----------------------------------------------------

describe('evaluateNextDayPlan', () => {
    it('retains independently evaluable synthetic inputs for each scenario', () => {
        const todayReadiness: DailyReadiness = { subjective: greenSubjective(), objective: quietObjective() };
        const context = baseContext();
        const todayRec = evaluateTraining(todayReadiness, context, '2026-08-01');
        const scenarios = buildNextDayScenarios(todayReadiness, context, '2026-08-01', todayRec);
        expect(scenarios.scenarios.green).toMatchObject({ tier: 'green', label: 'Optimal Readiness' });
        expect(scenarios.scenarios.yellow.readiness.subjective.fatigue).toBeGreaterThan(scenarios.scenarios.green.readiness.subjective.fatigue);
        expect(scenarios.scenarios.red.readiness.subjective.fatigue).toBeGreaterThan(scenarios.scenarios.yellow.readiness.subjective.fatigue);
    });

    it('keeps green, yellow, and red distinct through intent-aware evaluation', async () => {
        const todayReadiness: DailyReadiness = { subjective: greenSubjective(), objective: quietObjective() };
        const context = baseContext();
        const todayRec = evaluateTraining(todayReadiness, context, '2026-08-01');
        const provider: TrainingHistoryProvider = { reconstruct: async () => [] };
        const plan = await evaluateNextDayPlanWithIntent('u1', [], todayReadiness, context, '2026-08-01', todayRec, provider);
        expect(plan.branches.green.recommendation.mode).toBe('train');
        expect(plan.branches.yellow.recommendation.mode).toBe('modify');
        expect(plan.branches.red.recommendation.mode).toBe('recover');
    });

    it('produces a single mandatory recovery plan when pain/injury is flagged today', () => {
        const todayReadiness: DailyReadiness = { subjective: greenSubjective({ painFlag: true }), objective: quietObjective() };
        const context = baseContext();
        const todayRec = evaluateTraining(todayReadiness, context, '2026-08-01');
        const plan = evaluateNextDayPlan(todayReadiness, context, '2026-08-01', todayRec);
        expect(plan.isSinglePlan).toBe(true);
        expect(plan.branches.green.recommendation.template.category).toMatch(/Rest|Mobility/);
    });

    it('produces three distinct branches on a normal day', () => {
        const todayReadiness: DailyReadiness = { subjective: greenSubjective(), objective: quietObjective() };
        const context = baseContext();
        const todayRec = evaluateTraining(todayReadiness, context, '2026-08-01');
        const plan = evaluateNextDayPlan(todayReadiness, context, '2026-08-01', todayRec);
        expect(plan.isSinglePlan).toBe(false);
        expect(plan.branches.green.recommendation.mode).toBe('train');
        expect(plan.branches.yellow.recommendation.mode).toBe('modify');
        expect(plan.branches.red.recommendation.mode).toBe('recover');
    });

    it('carries today\'s mode into tomorrow\'s hysteresis reference point', () => {
        // Today itself is a recover day -- even a tomorrow that would otherwise be a
        // full green light should reflect the post-recover buffer, not promise a hard
        // session outright. evaluateNextDayPlan's green/yellow/red branches pass
        // todayRec.mode through for exactly this reason.
        const todayReadiness: DailyReadiness = { subjective: greenSubjective({ painFlag: true }), objective: quietObjective() };
        const context = baseContext();
        const todayRec = evaluateTraining(todayReadiness, context, '2026-08-01');
        expect(todayRec.mode).toBe('recover');

        const normalTomorrow: DailyReadiness = { subjective: greenSubjective(), objective: quietObjective() };
        const greenTomorrow = evaluateTraining(normalTomorrow, context, '2026-08-02', todayRec.mode);
        expect(greenTomorrow.mode).toBe('modify');
    });

    it('locks tomorrow to recovery after cumulative overload (2+ hard sessions plus a hard session today)', () => {
        const objective = quietObjective({ last_3_days_hard_sessions_count: 2 });
        const todayReadiness: DailyReadiness = { subjective: greenSubjective(), objective };
        const context = baseContext();
        // Force today's own recommendation to actually land on a hard-session category by
        // using a context/time window wide enough for one, then feed that into the plan.
        const todayRec = evaluateTraining(todayReadiness, context, '2026-08-01');
        const plan = evaluateNextDayPlan(todayReadiness, context, '2026-08-01', todayRec);
        if (['Hard Endurance', 'Full-body Strength', 'Lower-body Strength', 'Upper-body Strength'].includes(todayRec.template.category)) {
            expect(plan.isSinglePlan).toBe(true);
        }
    });
});

// --- Telemetry Reconciliation & Decision Relevance --------------------------

describe('telemetry reconciliation & decision relevance', () => {
    it('returns telemetry where metric strain and context penalties sum to totalDecisionScore', () => {
        const readiness: DailyReadiness = {
            subjective: greenSubjective(),
            objective: quietObjective({
                hrv_delta: -5,
                hrv_delta_28d: -8,
                hrv_stdev_28d: 10,
                rhr_delta: 4,
                rhr_delta_28d: 6,
                rhr_stdev_28d: 4,
                sleep_score: 45, // Absolute sleep floor penalty applies
                body_battery_wake: 40, // Body battery deficit applies
                last_3_days_hard_sessions_count: 2 // Hard sessions penalty applies
            })
        };
        const context = baseContext();
        context.preferences.conservativeBias = true; // Conservative bias applies

        const rec = evaluateTraining(readiness, context, '2026-08-01');
        expect(rec.telemetry).toBeDefined();

        const t = rec.telemetry!;
        // Check metric strain sum
        const expectedMetricTotal = Math.round((t.metricStrain.acuteDeviation + t.metricStrain.multiDayDrift) * 100) / 100;
        expect(t.metricStrain.totalMetricStrain).toBeCloseTo(expectedMetricTotal, 2);

        // Check context penalties
        const contextSum = t.contextPenalties.recentHardSessions +
            t.contextPenalties.bodyBatteryDeficit +
            t.contextPenalties.sleepFloorPenalty +
            t.contextPenalties.conservativeBias;

        const expectedTotalScore = Math.round((t.metricStrain.totalMetricStrain + contextSum) * 100) / 100;
        expect(t.totalDecisionScore).toBeCloseTo(expectedTotalScore, 2);
    });

    it('annotates rationale when multiDayDrift alters the mode outcome (decision-relevant)', () => {
        // Construct readiness where acute delta alone is manageable, but multi-day baseline drift pushes score > STRAIN_MODIFY_THRESHOLD (1.0)
        const readiness: DailyReadiness = {
            subjective: greenSubjective(),
            objective: quietObjective({
                hrv_delta: -3,       // Mild acute drop
                hrv_delta_28d: -15,  // Significant 28d baseline drop (multi-day drift)
                hrv_stdev_28d: 10
            })
        };
        const rec = evaluateTraining(readiness, baseContext(), '2026-08-01');
        expect(rec.mode).toBe('modify');
        expect(rec.rationale).toContain("Your recovery metrics have been trending away from baseline over several days");
    });

    it('does not add multiDayDrift rationale when drift did not alter the mode outcome', () => {
        // Fully optimal day -- mode remains 'train' with or without drift
        const readiness: DailyReadiness = {
            subjective: greenSubjective(),
            objective: quietObjective({
                hrv_delta: 0,
                hrv_delta_28d: 0,
                hrv_stdev_28d: 10
            })
        };
        const rec = evaluateTraining(readiness, baseContext(), '2026-08-01');
        expect(rec.mode).toBe('train');
        expect(rec.rationale).not.toContain("trending away from baseline");
    });

    it('preserves immediate safety downgrades regardless of multi-day trends', () => {
        // Positive 28-day drift (improving trend) but acute pain reported today
        const readiness: DailyReadiness = {
            subjective: greenSubjective({ painFlag: true }),
            objective: quietObjective({
                hrv_delta: 5,
                hrv_delta_28d: 10,
                hrv_stdev_28d: 10
            })
        };
        const rec = evaluateTraining(readiness, baseContext(), '2026-08-01');
        expect(rec.mode).toBe('recover');
    });
});

// --- Sequence & Threshold Oscillation Simulation ----------------------------

describe('sequence trajectory & threshold oscillation simulation', () => {
    it('handles a multi-day gradual deterioration sequence smoothly', () => {
        const baseObj = quietObjective({ hrv_stdev_28d: 5, rhr_stdev_28d: 3 });
        const context = baseContext();

        // Day 1: Fresh & optimal
        const d1 = evaluateTraining({ subjective: greenSubjective(), objective: { ...baseObj, hrv_delta: 0, hrv_delta_28d: 0 } }, context, '2026-08-01');
        expect(d1.mode).toBe('train');

        // Day 2: Mild multi-day drift starting -> pushes score over 1.0 threshold into modify (strain ~1.3)
        const d2 = evaluateTraining({ subjective: greenSubjective(), objective: { ...baseObj, hrv_delta: -4, hrv_delta_28d: -10 } }, context, '2026-08-02', d1.mode);
        expect(d2.mode).toBe('modify');

        // Day 3: Continued drift + high soreness -> stays modify
        const d3 = evaluateTraining({ subjective: greenSubjective({ soreness: 7 }), objective: { ...baseObj, hrv_delta: -4, hrv_delta_28d: -10 } }, context, '2026-08-03', d2.mode);
        expect(d3.mode).toBe('modify');

        // Day 4: Acute safety crash -> immediate recover
        const d4 = evaluateTraining({ subjective: greenSubjective({ fatigue: 9 }), objective: { ...baseObj, hrv_delta: -15, hrv_delta_28d: -25 } }, context, '2026-08-04', d3.mode);
        expect(d4.mode).toBe('recover');

        // Day 5: Morning after recovery day -> post-recover buffer eases back in to modify
        const d5 = evaluateTraining({ subjective: greenSubjective(), objective: { ...baseObj, hrv_delta: 0, hrv_delta_28d: -2 } }, context, '2026-08-05', d4.mode);
        expect(d5.mode).toBe('modify');
    });

    it('evaluates near-threshold oscillation behavior cleanly', () => {
        const context = baseContext();
        // Hovering consistently in the modify threshold range (~1.3 strain)
        const nearThresholdDeltas = [-4, -5, -4, -5, -4];
        const modes: string[] = [];

        let prevMode: 'train' | 'modify' | 'recover' | undefined = undefined;
        for (let i = 0; i < nearThresholdDeltas.length; i++) {
            const hrv_delta = nearThresholdDeltas[i];
            const readiness: DailyReadiness = {
                subjective: greenSubjective(),
                objective: quietObjective({
                    hrv_delta,
                    hrv_delta_28d: hrv_delta - 6,
                    hrv_stdev_28d: 5
                })
            };
            const rec = evaluateTraining(readiness, context, `2026-08-0${i + 1}`, prevMode);
            modes.push(rec.mode);
            prevMode = rec.mode;
        }

        // Verify engine produces consistent classifications without random oscillation
        expect(modes).toEqual(['modify', 'modify', 'modify', 'modify', 'modify']);
    });
});

// --- Session Adjustment Tests -----------------------------------------------

describe('session adjustment engine', () => {
    it('never makes a stale running recommendation harder after a high-impact safety limit is enabled', () => {
        const readiness: DailyReadiness = { subjective: greenSubjective(), objective: quietObjective() };
        const context = baseContext();
        context.trainingSettings = {
            userId: 'athlete', schemaVersion: 2,
            equipment: { free_weights: true, cable_machine: false, treadmill: false, indoor_bike: false, pullup_bar: false },
            guardrails: { avoid_high_impact: true, avoid_heavy_lower_body: false, avoid_overhead_pressing: false, avoid_heavy_spinal_loading: false },
            defaults: { weekdayMaxMinutes: null, weekendMaxMinutes: null, environment: 'either' },
            preferences: { preferActiveRecovery: false }, migration: { legacyReviewed: true, migratedAt: null },
            createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
        };
        const baseRec = evaluateTraining(readiness, baseContext(), '2026-08-07');
        baseRec.template = TEMPLATES.find(template => template.id === 'end_hard_01')!;
        expect(adjustSessionRecommendation(baseRec, 'harder', readiness, context, '2026-08-07')).toBeNull();
    });

    it('Tier 1: 4x4 VO2 run -> Easier produces a reduced 3x4 VO2 dose preserving training purpose', () => {
        const readiness: DailyReadiness = { subjective: greenSubjective(), objective: quietObjective() };
        const context = baseContext();
        const date = '2026-08-07';
        const baseRec = evaluateTraining(readiness, context, date);

        // Force a 4x4 run recommendation
        baseRec.template = {
            id: 'end_hard_01',
            category: 'Hard Endurance',
            modality: 'Running',
            durationMin: 30,
            durationMax: 60,
            title: 'Interval Speed Work',
            description: 'Warm up, then 4x4 minute intervals near threshold. Cool down.',
            requiredEquipment: [],
            environment: 'outdoor', safetyTags: ['avoid_high_impact'],
            systemicCost: 1.0,
            objectiveTransferable: true,
            easierDose: {
                label: '3x4 min Intervals (30 min)',
                durationMin: 25,
                durationMax: 40,
                doseRatio: 0.75,
                prescriptionSummary: 'Reduced to 3x4 minute VO2 intervals.'
            }
        };

        const adjusted = adjustSessionRecommendation(baseRec, 'easier', readiness, context, date);
        expect(adjusted).not.toBeNull();
        expect(adjusted?.template.id).toBe('end_hard_01');
        expect(adjusted?.activeDose?.label).toBe('3x4 min Intervals (30 min)');
        expect(adjusted?.adjustment?.tier).toBe(1);
        expect(adjusted?.adjustment?.direction).toBe('easier');
        expect(adjusted?.adjustment?.originalTemplateId).toBe('end_hard_01');
    });

    it('Tier 1: 4x4 VO2 run -> Harder produces an increased 5x4 VO2 dose', () => {
        const readiness: DailyReadiness = { subjective: greenSubjective(), objective: quietObjective() };
        const context = baseContext();
        const date = '2026-08-07';
        const baseRec = evaluateTraining(readiness, context, date);

        baseRec.template = {
            id: 'end_hard_01',
            category: 'Hard Endurance',
            modality: 'Running',
            durationMin: 30,
            durationMax: 60,
            title: 'Interval Speed Work',
            description: 'Warm up, then 4x4 minute intervals near threshold.',
            requiredEquipment: [],
            environment: 'outdoor', safetyTags: ['avoid_high_impact'],
            systemicCost: 1.0,
            objectiveTransferable: true,
            harderDose: {
                label: '5x4 min Intervals (50 min)',
                durationMin: 40,
                durationMax: 60,
                doseRatio: 1.25,
                prescriptionSummary: 'Increased to 5x4 minute VO2 intervals.'
            }
        };

        const adjusted = adjustSessionRecommendation(baseRec, 'harder', readiness, context, date);
        expect(adjusted).not.toBeNull();
        expect(adjusted?.activeDose?.label).toBe('5x4 min Intervals (50 min)');
        expect(adjusted?.adjustment?.tier).toBe(1);
    });

    it('Zone 2 continuous -> Harder scales duration without changing category', () => {
        const readiness: DailyReadiness = { subjective: greenSubjective(), objective: quietObjective() };
        const context = baseContext();
        context.constraints.hasIndoorBike = true;
        const date = '2026-08-07';
        const baseRec = evaluateTraining(readiness, context, date);

        baseRec.template = {
            id: 'end_easy_01',
            category: 'Easy Endurance',
            modality: 'Cycling',
            durationMin: 30,
            durationMax: 60,
            title: 'Zone 2 Spin',
            description: 'Easy conversational pace on the bike.',
            requiredEquipment: ['indoor_bike'],
            environment: 'indoor', safetyTags: [],
            systemicCost: 0.3,
            objectiveTransferable: true,
            harderDose: {
                label: '75 min Aerobic Base Ride',
                durationMin: 60,
                durationMax: 90,
                doseRatio: 1.5,
                prescriptionSummary: 'Extended 75 min Zone 2 aerobic base ride.'
            }
        };

        const adjusted = adjustSessionRecommendation(baseRec, 'harder', readiness, context, date);
        expect(adjusted?.template.category).toBe('Easy Endurance');
        expect(adjusted?.activeDose?.label).toBe('75 min Aerobic Base Ride');
    });

    it('Pain/Injury flag prevents upward adjustment (clinical safety floor)', () => {
        const readiness: DailyReadiness = { subjective: neutralSubjective({ painFlag: true }), objective: quietObjective() };
        const context = baseContext();
        const date = '2026-08-07';
        const baseRec = evaluateTraining(readiness, context, date);

        const adjusted = adjustSessionRecommendation(baseRec, 'harder', readiness, context, date);
        expect(adjusted).toBeNull();
    });

    it('Non-transferable objective (Hill Repeats) skips Tier 4 cross-modal substitution', () => {
        const readiness: DailyReadiness = { subjective: greenSubjective(), objective: quietObjective() };
        // Restrict running via injury so Tier 1-3 in running fail
        const context = baseContext();
        context.constraints.restrictedModalities = ['Running'];

        const date = '2026-08-07';
        const baseRec = evaluateTraining(readiness, context, date);

        baseRec.template = {
            id: 'end_hard_03',
            category: 'Hard Endurance',
            modality: 'Running',
            durationMin: 35,
            durationMax: 55,
            title: 'Hill Repeats',
            description: 'Hard hill efforts.',
            requiredEquipment: [],
            environment: 'outdoor', safetyTags: ['avoid_high_impact'],
            systemicCost: 1.0,
            objectiveTransferable: false // Non transferable neuromuscular goal
        };

        // Running is restricted by injury, and hill repeats objectiveTransferable is false -> should return null rather than arbitrary cross-modal workout
        const adjusted = adjustSessionRecommendation(baseRec, 'harder', readiness, context, date);
        expect(adjusted).toBeNull();
    });

    it('Immutable baseline recommendation: baseRec remains unchanged when adjusted', () => {
        const readiness: DailyReadiness = { subjective: greenSubjective(), objective: quietObjective() };
        const context = baseContext();
        const date = '2026-08-07';
        const baseRec = evaluateTraining(readiness, context, date);
        const originalTitle = baseRec.template.title;

        const adjusted = adjustSessionRecommendation(baseRec, 'easier', readiness, context, date);

        expect(baseRec.template.title).toBe(originalTitle);
        expect(baseRec.adjustment).toBeUndefined();
        expect(adjusted?.adjustment).toBeDefined();
    });

    it('evaluateEnvelopes computes clinical safety and plan envelopes correctly', () => {
        const readiness: DailyReadiness = { subjective: neutralSubjective({ painFlag: true }), objective: quietObjective() };
        const context = baseContext();
        context.constraints.restrictedModalities = ['Running'];

        const envelopes = evaluateEnvelopes(readiness, context);
        expect(envelopes.safety.clinicalFlagActive).toBe(true);
        expect(envelopes.safety.restrictedModalities).toContain('Running');
        expect(envelopes.plan.maxAllowableTier).toBe('Mobility');
    });

    it('evaluateEnvelopes does not false-positive a running injury on unrelated substrings (e.g. "trunk")', () => {
        // Plain .includes('run')/'leg' would also match "trunk"/"college" -- word-boundary
        // matching keeps the running restriction tied to actual running-relevant injuries.
        const readiness: DailyReadiness = { subjective: neutralSubjective(), objective: quietObjective() };
        const context = baseContext();
        context.constraints.restrictedModalities = [];

        const envelopes = evaluateEnvelopes(readiness, context);
        expect(envelopes.safety.clinicalFlagActive).toBe(false);
        expect(envelopes.safety.restrictedModalities).not.toContain('Running');
    });

    it('goal-title taper keywords no longer cap the safety envelope or block a harder dose', () => {
        const readiness: DailyReadiness = { subjective: greenSubjective(), objective: quietObjective() };
        const context = baseContext();
        context.goals.shortTerm = 'Taper for race day';
        const date = '2026-08-07';
        const baseRec = evaluateTraining(readiness, context, date);

        baseRec.template = {
            id: 'end_hard_01',
            category: 'Hard Endurance',
            modality: 'Running',
            durationMin: 30,
            durationMax: 60,
            title: 'Interval Speed Work',
            description: 'Warm up, then 4x4 minute intervals near threshold.',
            requiredEquipment: [],
            environment: 'outdoor', safetyTags: ['avoid_high_impact'],
            systemicCost: 1.0,
            objectiveTransferable: true,
            harderDose: {
                label: '5x4 min Intervals (50 min)',
                durationMin: 40,
                durationMax: 60,
                doseRatio: 1.25,
                prescriptionSummary: 'Increased to 5x4 minute VO2 intervals.'
            }
        };

        // Taper is periodization policy, not a safety limit inferred from a title. With
        // fully green readiness, the existing harder-dose behavior remains available.
        const adjusted = adjustSessionRecommendation(baseRec, 'harder', readiness, context, date);
        expect(adjusted?.adjustment?.tier).toBe(1);
        expect(adjusted?.activeDose?.label).toBe('5x4 min Intervals (50 min)');
    });

    it('Reduced Full-body Strength Maintenance -> Easier scales to 25 min upper/trunk focus (Tier 1)', () => {
        const readiness: DailyReadiness = { subjective: greenSubjective(), objective: quietObjective() };
        const context = baseContext();
        context.constraints.hasFreeWeights = true;
        const date = '2026-08-07';
        const baseRec = evaluateTraining(readiness, context, date);
        const strFull03 = TEMPLATES.find(t => t.id === 'str_full_03')!;
        baseRec.template = strFull03;

        const adjusted = adjustSessionRecommendation(baseRec, 'easier', readiness, context, date);
        expect(adjusted).not.toBeNull();
        expect(adjusted?.template.id).toBe('str_full_03');
        expect(adjusted?.adjustment?.tier).toBe(1);
        expect(adjusted?.adjustment?.direction).toBe('easier');
        expect(adjusted?.activeDose?.label).toBe('2 Sets Upper/Trunk Focus (25 min)');
        expect(adjusted?.activeDose?.doseRatio).toBe(0.7);
    });

    it('Reduced Full-body Strength Maintenance -> Harder scales to 45 min full-body maintenance (Tier 1)', () => {
        const readiness: DailyReadiness = { subjective: greenSubjective(), objective: quietObjective() };
        const context = baseContext();
        context.constraints.hasFreeWeights = true;
        const date = '2026-08-07';
        const baseRec = evaluateTraining(readiness, context, date);
        const strFull03 = TEMPLATES.find(t => t.id === 'str_full_03')!;
        baseRec.template = strFull03;

        const adjusted = adjustSessionRecommendation(baseRec, 'harder', readiness, context, date);
        expect(adjusted).not.toBeNull();
        expect(adjusted?.template.id).toBe('str_full_03');
        expect(adjusted?.adjustment?.tier).toBe(1);
        expect(adjusted?.adjustment?.direction).toBe('harder');
        expect(adjusted?.activeDose?.label).toBe('3 Sets Full-body Maintenance (45 min)');
        expect(adjusted?.activeDose?.doseRatio).toBe(1.25);
    });

    it('Tier 2 candidate filtering strictly enforces lower systemic cost when adjusting easier', () => {
        const readiness: DailyReadiness = { subjective: greenSubjective(), objective: quietObjective() };
        const context = baseContext();
        context.constraints.hasFreeWeights = true;
        const date = '2026-08-07';
        const baseRec = evaluateTraining(readiness, context, date);

        // A hypothetical template with no in-template easierDose and cost 0.45 in Full-body Strength
        baseRec.template = {
            id: 'hypothetical_str_01',
            category: 'Full-body Strength',
            modality: 'Strength',
            durationMin: 30,
            durationMax: 45,
            title: 'Hypothetical Mid Strength',
            description: 'Mid strength session',
            requiredEquipment: ['free_weights'],
            environment: 'either',
            safetyTags: [],
            systemicCost: 0.45,
            objectiveTransferable: false,
        };

        const adjusted = adjustSessionRecommendation(baseRec, 'easier', readiness, context, date);
        // It must NOT pick str_full_01 (0.60) or str_full_02 (0.55) as Tier 2 because they are harder.
        // If it adjusts (Tier 3), it must pick a strictly easier session (systemicCost < 0.45).
        if (adjusted) {
            expect(adjusted.adjustment?.tier).not.toBe(2);
            expect(adjusted.template.systemicCost).toBeLessThan(0.45);
        }
    });

    it('an exclude achilles injury removes every Running template on the readiness path and populates restrictedModalities', () => {
        const readiness: DailyReadiness = { subjective: greenSubjective(), objective: quietObjective() };
        const settings: TrainingSettings = {
            userId: 'user1',
            schemaVersion: 3,
            equipment: { free_weights: true, cable_machine: true, treadmill: true, indoor_bike: true, pullup_bar: true },
            guardrails: { avoid_high_impact: false, avoid_heavy_lower_body: false, avoid_overhead_pressing: false, avoid_heavy_spinal_loading: false },
            injuries: [{ region: 'achilles', severity: 'exclude' }],
            defaults: { weekdayMaxMinutes: 60, weekendMaxMinutes: 60, environment: 'either' },
            preferences: { preferActiveRecovery: false },
            migration: { legacyReviewed: true, migratedAt: null },
            createdAt: '2026-08-08T00:00:00Z',
            updatedAt: '2026-08-08T00:00:00Z',
        };
        const context = mapContextFromGoalsAndTrainingSettings([], settings, null, '2026-08-08');
        const rec = evaluateTraining(readiness, context, '2026-08-08');
        expect(rec.envelopes?.safety.restrictedModalities).toContain('Running');
        expect(rec.template.modality).not.toBe('Running');
    });
});

// --- Phase 9.2: DailyReadiness carries an optional subjectiveBaseline field --------------

function fixtureSubjectiveBaseline(): SubjectiveBaseline {
    // A "worst case" baseline -- every metric drifted maximally adverse -- to make the
    // strongest possible case that attaching it changes nothing. If 9.2 accidentally wired
    // this into the mode calculation, this fixture would be the one most likely to expose it.
    const adverseMetric = { recentAvg: 2, longAvg: 8, variability: 1 };
    return {
        estimatorId: 'test-fixture-v1',
        historyThroughDateExclusive: '2026-08-08',
        recentRecordedDays: 7,
        longRecordedDays: 28,
        lastObservationDate: '2026-08-07',
        metrics: {
            readiness: adverseMetric,
            sleepQuality: adverseMetric,
            fatigue: adverseMetric,
            soreness: adverseMetric,
            mentalStress: adverseMetric,
            motivation: adverseMetric,
        },
    };
}

describe('Phase 9.2: DailyReadiness.subjectiveBaseline is optional and inert', () => {
    it('evaluateReadinessAndSafetyEnvelope returns byte-identical output whether or not a baseline is attached', () => {
        const context = baseContext();
        const withoutBaseline: DailyReadiness = { subjective: neutralSubjective(), objective: quietObjective() };
        const withBaseline: DailyReadiness = { ...withoutBaseline, subjectiveBaseline: fixtureSubjectiveBaseline() };

        const resultWithout = evaluateReadinessAndSafetyEnvelope(withoutBaseline, context);
        const resultWith = evaluateReadinessAndSafetyEnvelope(withBaseline, context);

        expect(resultWith).toEqual(resultWithout);
    });

    it('remains true across every mode band (train/modify/recover), not only a neutral day', () => {
        const context = baseContext();
        const fixtures: DailyReadiness[] = [
            { subjective: greenSubjective(), objective: quietObjective() }, // train
            { subjective: neutralSubjective({ soreness: 7 }), objective: quietObjective() }, // modify (soreness > 6)
            { subjective: neutralSubjective({ fatigue: 9, soreness: 9 }), objective: quietObjective() }, // recover
        ];
        for (const readiness of fixtures) {
            const withoutBaseline = evaluateReadinessAndSafetyEnvelope(readiness, context);
            const withBaseline = evaluateReadinessAndSafetyEnvelope({ ...readiness, subjectiveBaseline: fixtureSubjectiveBaseline() }, context);
            expect(withBaseline).toEqual(withoutBaseline);
        }
    });

    it('a DailyReadiness omitting subjectiveBaseline entirely still type-checks and evaluates (field is truly optional)', () => {
        const readiness: DailyReadiness = { subjective: neutralSubjective(), objective: quietObjective() };
        expect(readiness.subjectiveBaseline).toBeUndefined();
        expect(() => evaluateReadinessAndSafetyEnvelope(readiness, baseContext())).not.toThrow();
    });

    it('evaluateReadinessAndSafetyEnvelope stays synchronous (D-SUBJPURE) -- no Promise, no async gap', () => {
        const readiness: DailyReadiness = { subjective: neutralSubjective(), objective: quietObjective(), subjectiveBaseline: fixtureSubjectiveBaseline() };
        const result = evaluateReadinessAndSafetyEnvelope(readiness, baseContext());
        expect(result).not.toBeInstanceOf(Promise);
        expect(typeof (result as unknown as { then?: unknown }).then).not.toBe('function');
    });
});

// --- Phase 9.3: the drift term, behind a default-off selector ----------------------------

const HIGHER_IS_BETTER: Record<SubjectiveBaselineMetric, boolean> = {
    readiness: true, sleepQuality: true, motivation: true,
    fatigue: false, soreness: false, mentalStress: false,
};

/** Every metric moved by exactly `gap` z-scores (variability fixed at 1, so gap == z) in
 *  the ADVERSE direction for positive `gap`, or favourably for negative `gap`. `today` is
 *  never part of this -- it is prior recent-vs-long history only (D-SUBJHIST). */
function uniformDriftBaseline(gap: number, variability = 1): SubjectiveBaseline {
    const metricFor = (higherIsBetter: boolean): SubjectiveMetricBaseline =>
        higherIsBetter ? { recentAvg: 5 - gap, longAvg: 5, variability } : { recentAvg: 5 + gap, longAvg: 5, variability };
    return {
        estimatorId: 'test-uniform-drift-v1',
        historyThroughDateExclusive: '2026-08-08',
        recentRecordedDays: 7,
        longRecordedDays: 28,
        lastObservationDate: '2026-08-07',
        metrics: {
            readiness: metricFor(HIGHER_IS_BETTER.readiness),
            sleepQuality: metricFor(HIGHER_IS_BETTER.sleepQuality),
            motivation: metricFor(HIGHER_IS_BETTER.motivation),
            fatigue: metricFor(HIGHER_IS_BETTER.fatigue),
            soreness: metricFor(HIGHER_IS_BETTER.soreness),
            mentalStress: metricFor(HIGHER_IS_BETTER.mentalStress),
        },
    };
}

/** A quiet-objective, exactly-neutral-subjective baseline that today sits at 'train' with
 *  zero margin to spare (overallFatigueScore is exactly 5, not > 5; soreness is exactly 6,
 *  not > 6) -- the most sensitive possible starting point for escalation tests. */
function trainModeReadiness(): DailyReadiness {
    return { subjective: neutralSubjective(), objective: quietObjective() };
}

const MODE_RANK = { train: 0, modify: 1, recover: 2 } as const;

describe('Phase 9.3: subjective drift term', () => {
    it('a "drift" policy with no attached baseline is identical to "off" -- no fabricated neutral signal', () => {
        const context = baseContext();
        const readiness = trainModeReadiness(); // subjectiveBaseline left undefined
        const off = evaluateReadinessAndSafetyEnvelope(readiness, context, undefined, undefined, 'off');
        const drift = evaluateReadinessAndSafetyEnvelope(readiness, context, undefined, undefined, 'drift');
        expect(drift).toEqual(off);
    });

    it('genuine adverse drift can escalate train -> modify', () => {
        const context = baseContext();
        const readiness: DailyReadiness = { ...trainModeReadiness(), subjectiveBaseline: uniformDriftBaseline(0.3) };
        const off = evaluateReadinessAndSafetyEnvelope(readiness, context, undefined, undefined, 'off');
        const drift = evaluateReadinessAndSafetyEnvelope(readiness, context, undefined, undefined, 'drift');
        expect(off.mode).toBe('train');
        expect(drift.mode).toBe('modify');
    });

    it('strong enough adverse drift can escalate all the way to recover', () => {
        const context = baseContext();
        const readiness: DailyReadiness = { ...trainModeReadiness(), subjectiveBaseline: uniformDriftBaseline(0.5) };
        const off = evaluateReadinessAndSafetyEnvelope(readiness, context, undefined, undefined, 'off');
        const drift = evaluateReadinessAndSafetyEnvelope(readiness, context, undefined, undefined, 'drift');
        expect(off.mode).toBe('train');
        expect(drift.mode).toBe('recover');
    });

    it('every existing absolute trigger acts as a hard floor under "drift" -- never relaxed, only possibly escalated (D-SUBJFLOOR)', () => {
        const context = baseContext();
        const absoluteFixtures: DailyReadiness[] = [
            { subjective: neutralSubjective({ soreness: 7 }), objective: quietObjective() }, // soreness > 6
            { subjective: neutralSubjective({ fatigue: 9, soreness: 9 }), objective: quietObjective() }, // overallFatigueScore > 7
            { subjective: neutralSubjective({ painFlag: true }), objective: quietObjective() }, // extremeFatigue via painFlag
        ];
        for (const base of absoluteFixtures) {
            const off = evaluateReadinessAndSafetyEnvelope(base, context, undefined, undefined, 'off');
            for (const gap of [-1, 0, 0.5, 3]) {
                const readiness = { ...base, subjectiveBaseline: uniformDriftBaseline(gap) };
                const drift = evaluateReadinessAndSafetyEnvelope(readiness, context, undefined, undefined, 'drift');
                // D-SUBJFLOOR: an absolute trigger is a floor, not a ceiling -- drift is free
                // to escalate past it (a large enough gap can push soreness>6's 'modify' floor
                // on to 'recover'), so the only universal guarantee is never-less-restrictive.
                expect(MODE_RANK[drift.mode], `gap=${gap}`).toBeGreaterThanOrEqual(MODE_RANK[off.mode]);
                // With no adverse movement at all, the drift term contributes exactly zero
                // (D-SUBJADD), so the floor holds byte-identically -- no escalation possible.
                if (gap <= 0) expect(drift.mode, `gap=${gap}`).toBe(off.mode);
            }
        }
    });

    it('a favourable baseline contributes exactly zero -- floored at zero, not merely small (D-SUBJADD)', () => {
        const context = baseContext();
        const readiness: DailyReadiness = { ...trainModeReadiness(), subjectiveBaseline: uniformDriftBaseline(-5) };
        const off = evaluateReadinessAndSafetyEnvelope(readiness, context, undefined, undefined, 'off');
        const drift = evaluateReadinessAndSafetyEnvelope(readiness, context, undefined, undefined, 'drift');
        expect(drift).toEqual(off);
    });

    it('a per-metric contribution is capped, so one extreme metric cannot dominate unboundedly', () => {
        const context = baseContext();
        // A single, wildly adverse metric (gap 100 with variability 1 -- an enormous z-score)
        // should contribute no more than the capped 2.0 total from that metric, not ~100.
        const extreme = uniformDriftBaseline(100);
        extreme.metrics.readiness = { recentAvg: -95, longAvg: 5, variability: 1 };
        for (const metric of ['sleepQuality', 'motivation', 'fatigue', 'soreness', 'mentalStress'] as const) {
            extreme.metrics[metric] = { recentAvg: 5, longAvg: 5, variability: 1 }; // neutral, no contribution
        }
        const readiness: DailyReadiness = { ...trainModeReadiness(), subjectiveBaseline: extreme };
        const drift = evaluateReadinessAndSafetyEnvelope(readiness, context, undefined, undefined, 'drift');
        // If uncapped, a z-score of 100 would trivially push to recover from any starting
        // point; capped at 2.0 it crosses modify (>=1.0) but not recover (<2.2).
        expect(drift.mode).toBe('modify');
    });

    it('a metric weighted to zero does not contribute, threaded end-to-end through the evaluator', () => {
        const context = baseContext();
        const readiness: DailyReadiness = { ...trainModeReadiness(), subjectiveBaseline: uniformDriftBaseline(0.3) };
        const allZero: SubjectiveDriftWeights = { readiness: 0, sleepQuality: 0, fatigue: 0, soreness: 0, mentalStress: 0, motivation: 0 };

        const withDefaultWeights = evaluateReadinessAndSafetyEnvelope(readiness, context, undefined, undefined, 'drift');
        const withZeroWeights = evaluateReadinessAndSafetyEnvelope(readiness, context, undefined, undefined, 'drift', allZero);

        // gap=0.3 escalates train -> modify with the reference weights (see the earlier
        // escalation test), but contributes nothing at all when every weight is zero.
        expect(withDefaultWeights.mode).toBe('modify');
        expect(withZeroWeights.mode).toBe('train');
    });

    it('a negative weight is clamped to zero rather than subtracting from the total (defense in depth for D-SUBJADD)', () => {
        const context = baseContext();
        const readiness: DailyReadiness = { ...trainModeReadiness(), subjectiveBaseline: uniformDriftBaseline(0.5) };
        const negativeReadinessWeight: SubjectiveDriftWeights = { ...REFERENCE_SUBJECTIVE_DRIFT_WEIGHTS, readiness: -100 };

        const withReferenceWeights = evaluateReadinessAndSafetyEnvelope(readiness, context, undefined, undefined, 'drift');
        const withNegativeWeight = evaluateReadinessAndSafetyEnvelope(readiness, context, undefined, undefined, 'drift', negativeReadinessWeight);

        // If a negative weight actually subtracted, a large-magnitude one would swing the
        // total drift negative and pull the mode back toward train. It must not: the
        // affected metric's contribution simply drops to zero, same as weighting it zero.
        expect(MODE_RANK[withNegativeWeight.mode]).toBeGreaterThanOrEqual(MODE_RANK[withReferenceWeights.mode] - 0);
        expect(subjectiveDriftStrain(readiness.subjectiveBaseline, 'drift', negativeReadinessWeight))
            .toBeCloseTo(subjectiveDriftStrain(readiness.subjectiveBaseline, 'drift', { ...REFERENCE_SUBJECTIVE_DRIFT_WEIGHTS, readiness: 0 }), 10);
    });
});

describe('Phase 9.7: subjective drift telemetry, decision-relevant counterfactual, rationale', () => {
    it("telemetry.subjectiveDrift is 0 and totalDecisionScore is unchanged under 'off', even with an adverse baseline attached", () => {
        const context = baseContext();
        const readiness: DailyReadiness = { ...trainModeReadiness(), subjectiveBaseline: uniformDriftBaseline(0.5) };
        const off = evaluateReadinessAndSafetyEnvelope(readiness, context, undefined, undefined, 'off');
        expect(off.telemetry.subjectiveDrift).toBe(0);
        expect(off.telemetry.totalDecisionScore).toBe(
            off.telemetry.metricStrain.totalMetricStrain
            + off.telemetry.contextPenalties.recentHardSessions
            + off.telemetry.contextPenalties.bodyBatteryDeficit
            + off.telemetry.contextPenalties.sleepFloorPenalty
            + off.telemetry.contextPenalties.conservativeBias,
        );
    });

    it("telemetry reconciles under 'drift': metricStrain + contextPenalties + subjectiveDrift === totalDecisionScore", () => {
        const context = baseContext();
        const readiness: DailyReadiness = { ...trainModeReadiness(), subjectiveBaseline: uniformDriftBaseline(0.3) };
        const drift = evaluateReadinessAndSafetyEnvelope(readiness, context, undefined, undefined, 'drift');
        expect(drift.telemetry.subjectiveDrift).toBeGreaterThan(0);
        const round2 = (value: number) => Math.round(value * 100) / 100;
        expect(drift.telemetry.totalDecisionScore).toBeCloseTo(round2(
            drift.telemetry.metricStrain.totalMetricStrain
            + drift.telemetry.contextPenalties.recentHardSessions
            + drift.telemetry.contextPenalties.bodyBatteryDeficit
            + drift.telemetry.contextPenalties.sleepFloorPenalty
            + drift.telemetry.contextPenalties.conservativeBias
            + drift.telemetry.subjectiveDrift!,
        ), 10);
    });

    it('subjectiveDriftIsDecisionRelevant is true only when subjective drift alone changed the mode', () => {
        const context = baseContext();
        // Escalating gap (0.3): train -> modify purely from the drift term (see the earlier
        // escalation test) -- relevant.
        const escalating: DailyReadiness = { ...trainModeReadiness(), subjectiveBaseline: uniformDriftBaseline(0.3) };
        const escalatingResult = evaluateReadinessAndSafetyEnvelope(escalating, context, undefined, undefined, 'drift');
        expect(escalatingResult.mode).toBe('modify');
        expect(escalatingResult.subjectiveDriftIsDecisionRelevant).toBe(true);

        // No baseline attached at all -- subjectiveDrift is 0, never relevant.
        const noBaseline = trainModeReadiness();
        const noBaselineResult = evaluateReadinessAndSafetyEnvelope(noBaseline, context, undefined, undefined, 'drift');
        expect(noBaselineResult.subjectiveDriftIsDecisionRelevant).toBe(false);

        // A favourable baseline contributes exactly zero -- never relevant.
        const favourable: DailyReadiness = { ...trainModeReadiness(), subjectiveBaseline: uniformDriftBaseline(-5) };
        const favourableResult = evaluateReadinessAndSafetyEnvelope(favourable, context, undefined, undefined, 'drift');
        expect(favourableResult.subjectiveDriftIsDecisionRelevant).toBe(false);

        // Already 'recover' via an absolute trigger regardless of drift -- mode !== 'train'
        // alone is not sufficient; the counterfactual-without-drift mode must also differ.
        const absoluteRecover: DailyReadiness = {
            subjective: neutralSubjective({ painFlag: true }), objective: quietObjective(),
            subjectiveBaseline: uniformDriftBaseline(0.3),
        };
        const absoluteRecoverResult = evaluateReadinessAndSafetyEnvelope(absoluteRecover, context, undefined, undefined, 'drift');
        expect(absoluteRecoverResult.mode).toBe('recover');
        expect(absoluteRecoverResult.subjectiveDriftIsDecisionRelevant).toBe(false);

        // 'off' never marks subjective drift as decision-relevant, regardless of baseline.
        const offResult = evaluateReadinessAndSafetyEnvelope(escalating, context, undefined, undefined, 'off');
        expect(offResult.subjectiveDriftIsDecisionRelevant).toBe(false);
    });

    it('the Path A rationale mentions subjective drift only when it is decision-relevant', () => {
        const context = baseContext();
        const escalating: DailyReadiness = { ...trainModeReadiness(), subjectiveBaseline: uniformDriftBaseline(0.3) };
        const withDrift = evaluateTraining(escalating, context, '2026-08-16', undefined,
            evaluateReadinessAndSafetyEnvelope(escalating, context, '2026-08-16', undefined, 'drift'));
        expect(withDrift.rationale).toContain('trending adverse relative to your own baseline');

        const withoutDrift = evaluateTraining(escalating, context, '2026-08-16', undefined,
            evaluateReadinessAndSafetyEnvelope(escalating, context, '2026-08-16', undefined, 'off'));
        expect(withoutDrift.rationale).not.toContain('trending adverse relative to your own baseline');
    });
});

describe('subjectiveDriftStrain (unit)', () => {
    it('returns exactly 0 for policy "off" regardless of baseline', () => {
        expect(subjectiveDriftStrain(uniformDriftBaseline(50), 'off')).toBe(0);
    });

    it('returns exactly 0 for a null/undefined baseline under "drift"', () => {
        expect(subjectiveDriftStrain(null, 'drift')).toBe(0);
        expect(subjectiveDriftStrain(undefined, 'drift')).toBe(0);
    });

    it('is signed correctly per metric: adverse movement is positive regardless of scale polarity', () => {
        // readiness declining (recentAvg < longAvg) is adverse; fatigue rising (recentAvg >
        // longAvg) is also adverse -- both must contribute the same magnitude here.
        const onlyReadinessAdverse = uniformDriftBaseline(0);
        onlyReadinessAdverse.metrics.readiness = { recentAvg: 3, longAvg: 5, variability: 1 };
        const onlyFatigueAdverse = uniformDriftBaseline(0);
        onlyFatigueAdverse.metrics.fatigue = { recentAvg: 7, longAvg: 5, variability: 1 };

        expect(subjectiveDriftStrain(onlyReadinessAdverse, 'drift')).toBeCloseTo(2, 10);
        expect(subjectiveDriftStrain(onlyFatigueAdverse, 'drift')).toBeCloseTo(2, 10);
    });

    it('floors favourable movement at zero per metric, not just in aggregate', () => {
        const mixed = uniformDriftBaseline(0);
        mixed.metrics.readiness = { recentAvg: 9, longAvg: 5, variability: 1 }; // favourable (readiness rose)
        mixed.metrics.fatigue = { recentAvg: 8, longAvg: 5, variability: 1 }; // adverse (fatigue rose), z=3 capped at 2
        expect(subjectiveDriftStrain(mixed, 'drift')).toBeCloseTo(2, 10); // only fatigue's capped contribution
    });

    it('caps each metric at STRAIN_Z_CAP (2.0) before weighting, so one metric cannot dominate unboundedly', () => {
        const extreme = uniformDriftBaseline(0);
        extreme.metrics.readiness = { recentAvg: -995, longAvg: 5, variability: 1 }; // z = 1000, capped to 2
        expect(subjectiveDriftStrain(extreme, 'drift')).toBeCloseTo(2, 10);
    });

    it('a zero-weighted metric contributes nothing even at an extreme z-score', () => {
        const extreme = uniformDriftBaseline(0);
        extreme.metrics.readiness = { recentAvg: -995, longAvg: 5, variability: 1 };
        const zeroReadiness: SubjectiveDriftWeights = { ...REFERENCE_SUBJECTIVE_DRIFT_WEIGHTS, readiness: 0 };
        expect(subjectiveDriftStrain(extreme, 'drift', zeroReadiness)).toBe(0);
    });

    it('a negative weight is clamped to zero (structural non-negativity, D-SUBJADD)', () => {
        const baseline = uniformDriftBaseline(1);
        const negative: SubjectiveDriftWeights = { ...REFERENCE_SUBJECTIVE_DRIFT_WEIGHTS, readiness: -50 };
        const zeroed: SubjectiveDriftWeights = { ...REFERENCE_SUBJECTIVE_DRIFT_WEIGHTS, readiness: 0 };
        expect(subjectiveDriftStrain(baseline, 'drift', negative)).toBeCloseTo(subjectiveDriftStrain(baseline, 'drift', zeroed), 10);
    });

    it('never returns a negative total, for any sign or magnitude of movement, weight, or variability', () => {
        const gaps = [-1000, -10, -3, -1, -0.001, 0, 0.001, 1, 3, 10, 1000];
        const variabilities = [0.001, 0.1, 1, 10, 1000];
        const weightSets: SubjectiveDriftWeights[] = [
            REFERENCE_SUBJECTIVE_DRIFT_WEIGHTS,
            { readiness: 0, sleepQuality: 0, fatigue: 0, soreness: 0, mentalStress: 0, motivation: 0 },
            { readiness: -5, sleepQuality: -5, fatigue: -5, soreness: -5, mentalStress: -5, motivation: -5 },
            { readiness: 100, sleepQuality: 0, fatigue: 0, soreness: 0, mentalStress: 0, motivation: 0 },
        ];
        let evaluated = 0;
        for (const gap of gaps) {
            for (const variability of variabilities) {
                const baseline = uniformDriftBaseline(gap, variability);
                for (const weights of weightSets) {
                    expect(subjectiveDriftStrain(baseline, 'drift', weights)).toBeGreaterThanOrEqual(0);
                    evaluated += 1;
                }
            }
        }
        expect(evaluated).toBe(gaps.length * variabilities.length * weightSets.length);
    });
});

describe('Phase 9.3: property -- "drift" is never less restrictive than "off"', () => {
    it('holds for every readiness fixture, baseline shape and weight configuration swept', () => {
        const context = baseContext();
        const readinessFixtures: DailyReadiness[] = [
            { subjective: greenSubjective(), objective: quietObjective() },
            trainModeReadiness(),
            { subjective: neutralSubjective({ soreness: 7 }), objective: quietObjective() },
            { subjective: neutralSubjective({ fatigue: 6, soreness: 6 }), objective: quietObjective() },
            { subjective: neutralSubjective({ fatigue: 9, soreness: 9 }), objective: quietObjective() },
            { subjective: neutralSubjective({ painFlag: true }), objective: quietObjective() },
            { subjective: neutralSubjective(), objective: quietObjective({ last_3_days_hard_sessions_count: 2 }) },
        ];
        const gaps = [-10, -3, -1, -0.5, 0, 0.001, 0.2, 0.5, 1, 2, 3, 10, 1000];
        const weightSets: SubjectiveDriftWeights[] = [
            REFERENCE_SUBJECTIVE_DRIFT_WEIGHTS,
            { readiness: 0, sleepQuality: 0, fatigue: 0, soreness: 0, mentalStress: 0, motivation: 0 },
            { readiness: 5, sleepQuality: 0, fatigue: 0, soreness: 0, mentalStress: 0, motivation: 0 },
            { readiness: -5, sleepQuality: -5, fatigue: -5, soreness: -5, mentalStress: -5, motivation: -5 }, // adversarial: attempts subtraction
            { readiness: 0.01, sleepQuality: 0.01, fatigue: 0.01, soreness: 0.01, mentalStress: 0.01, motivation: 0.01 },
        ];

        let comparisons = 0;
        for (const base of readinessFixtures) {
            const off = evaluateReadinessAndSafetyEnvelope(base, context, undefined, undefined, 'off');
            for (const gap of gaps) {
                for (const variability of [1, 0.1, 10]) {
                    const readiness = { ...base, subjectiveBaseline: uniformDriftBaseline(gap, variability) };
                    for (const weights of weightSets) {
                        const drift = evaluateReadinessAndSafetyEnvelope(readiness, context, undefined, undefined, 'drift', weights);
                        expect(MODE_RANK[drift.mode], `base=${JSON.stringify(base.subjective)} gap=${gap} variability=${variability} weights=${JSON.stringify(weights)}`)
                            .toBeGreaterThanOrEqual(MODE_RANK[off.mode]);
                        comparisons += 1;
                    }
                }
            }
        }
        expect(comparisons).toBe(readinessFixtures.length * gaps.length * 3 * weightSets.length);
        expect(comparisons).toBeGreaterThan(1000); // sanity: the sweep actually ran
    });
});

describe('Phase 9.3: no production call site passes subjectiveDriftPolicy "drift"', () => {
    // 'drift' is meant to be reachable only from a future 9.6 simulation comparison
    // harness. A plain source scan (not the AST import-graph scanner externalArchitecture.test.ts
    // uses -- that answers a different question, module reachability, not literal argument
    // values) catches the straightforward case: nobody writes the literal string today.
    const ENGINE_DIR = __dirname;

    function productionFiles(directory = ENGINE_DIR): string[] {
        return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
            const absolutePath = join(directory, entry.name);
            if (entry.isDirectory()) {
                // engine/simulation/ is where 9.6 will legitimately reference 'drift'.
                if (entry.name === 'simulation') return [];
                return productionFiles(absolutePath);
            }
            if (!entry.isFile() || !/\.ts$/.test(entry.name) || /\.test\.ts$/.test(entry.name)) return [];
            return [absolutePath];
        });
    }

    it('no non-test engine file outside simulation/ contains the literal \'drift\' as a value', () => {
        const offenders: string[] = [];
        for (const file of productionFiles()) {
            const source = readFileSync(file, 'utf8');
            // Matches a quoted 'drift' that is not immediately preceded by "'off' | " -- i.e.
            // not the SubjectiveDriftPolicy type declaration itself.
            const valueUsage = source.match(/(?<!'off' \| )'drift'/g);
            if (valueUsage) offenders.push(file);
        }
        expect(offenders).toEqual([]);
    });
});

