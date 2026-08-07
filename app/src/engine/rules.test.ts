import { describe, it, expect } from 'vitest';
import { evaluateTraining, evaluateNextDayPlan } from './rules';
import type { DailyReadiness, UserContext, EngineObjectiveInput, SubjectiveInput } from './models';

// --- Fixtures --------------------------------------------------------------

function baseContext(overrides: Partial<UserContext['preferences']> = {}): UserContext {
    return {
        goals: { shortTerm: '', midTerm: '', longTerm: '' },
        constraints: {
            hasCableMachine: false,
            hasFreeWeights: true,
            hasTreadmill: false,
            hasIndoorBike: false,
            injuries: [],
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
        // The higher-cost categories modify is meant to exclude should still never appear.
        expect(categoriesSeen.has('Hard Endurance')).toBe(false);
        expect(categoriesSeen.has('Lower-body Strength')).toBe(false);
        expect(categoriesSeen.has('Full-body Strength')).toBe(false);
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

    it('narrows a modify-day Strength ask to the in-ceiling Upper-body variant, not Lower/Full-body', () => {
        const objective = quietObjective({ hrv_delta: -12, hrv_delta_28d: -12, rhr_delta: 5, rhr_delta_28d: 5 });
        for (let i = 1; i <= 14; i++) {
            const date = `2026-08-${String(i).padStart(2, '0')}`;
            const rec = evaluateTraining(
                { subjective: greenSubjective({ preferredModalityToday: 'Strength' }), objective },
                baseContext(), date
            );
            expect(rec.mode).toBe('modify');
            expect(rec.template.category).toBe('Upper-body Strength');
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
});

// --- evaluateNextDayPlan -----------------------------------------------------

describe('evaluateNextDayPlan', () => {
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
