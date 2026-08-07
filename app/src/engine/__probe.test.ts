import { describe, it } from 'vitest';
import { evaluateNextDayPlan, evaluateTraining } from './rules';
import { generateWeekAheadPlan, prepareWeekAheadPlanSeed } from './planner';
import { generateWeeklyObjectives, updateMicrocycleProgress } from './microcycle';
import { evaluatePeriodizationPhase } from './periodization';
import { ENRICHED_TEMPLATES } from './templates';
import type { DailyReadiness, EngineObjectiveInput, SubjectiveInput, UserContext, UserEvent } from './models';

function baseContext(overrides: Partial<UserContext['constraints']> = {}): UserContext {
    return {
        goals: { shortTerm: '', midTerm: '', longTerm: '' },
        constraints: {
            hasCableMachine: false, hasFreeWeights: true, hasTreadmill: false, hasIndoorBike: true,
            injuries: [], maxTimeMinutes: 90, ...overrides,
        },
        preferences: { avoidedModalities: [], deprioritizedModalities: [], preferredModalities: [], conservativeBias: false },
    };
}
const subj = (o: Partial<SubjectiveInput> = {}): SubjectiveInput => ({
    readiness: 6, sleepQuality: 6, fatigue: 4, soreness: 4, stress: 4, motivation: 6,
    timeAvailable: 60, painFlag: false, alreadyTrainedToday: false, preferredModalityToday: null, ...o,
});
const obj = (o: Partial<EngineObjectiveInput> = {}): EngineObjectiveInput => ({
    total_steps: 8000, sleep_score: 82, sleep_duration_min: 450, rhr: 50, rhr_7d_avg: 50, rhr_delta: 0,
    hrv_weekly_avg: 50, hrv_last_night: 50, hrv_delta: 0, respiration: 14, body_battery_wake: 82,
    last_3_days_hard_sessions_count: 0, yesterday_training: null, today_training: null,
    sleep_score_delta_7d: 0, rhr_delta_28d: 0, hrv_delta_28d: 0, sleep_score_delta_28d: 0,
    hrv_stdev_28d: 8.5, rhr_stdev_28d: 3.5, sleep_score_stdev_28d: 7.8, ...o,
});

describe('PROBE', () => {
    it('A) credit-string coverage: which objectives can each template EVER resolve?', () => {
        // Force a phase where ALL FOUR objectives are generated, so coverage is real.
        const phase = {
            ...evaluatePeriodizationPhase([], '2026-08-07').phase,
            targetDemandVector: {
                aerobicEndurance: 0.8, thresholdPower: 0.8, vo2MaxPower: 0.8, repeatedSurges: 0.8,
                sprintPower: 0.5, fatigueResistance: 0.8, neuromuscular: 0.5,
            },
        };
        const rows = ENRICHED_TEMPLATES.map(t => {
            const creditString = `${t.modality} ${t.category}`;
            const before = generateWeeklyObjectives(phase, '2026-08-01');
            const after = updateMicrocycleProgress(before, {
                type: creditString, duration_min: t.durationMin, training_effect: 0, intensity_tag: '',
            });
            const credited = after.objectives
                .filter((o, i) => o.completedExposures > before.objectives[i].completedExposures)
                .map(o => o.key);
            return { title: t.title, creditString, credited: credited.join(',') || '*** NONE ***' };
        });
        console.log('\n=== CREDIT STRING -> OBJECTIVES RESOLVED ===');
        rows.forEach(r => console.log(`${r.title.padEnd(34)} | "${r.creditString}"`.padEnd(72) + ` -> ${r.credited}`));
    });

    it('B) 7-day forecast under a priority-A cycling event', () => {
        const context = baseContext();
        const readiness: DailyReadiness = { subjective: subj(), objective: obj() };
        const date = '2026-08-07';
        const event: UserEvent = {
            id: 'e1', title: 'Gran Fondo', date: '2026-09-20', priority: 'A', lifecycle: 'scheduled', category: 'cycling_event',
            demandProfile: { aerobicEndurance: 0.8, thresholdPower: 0.75, vo2MaxPower: 0.7, repeatedSurges: 0.7, sprintPower: 0.3, fatigueResistance: 0.8, neuromuscular: 0.3 },
        };
        const todayRec = evaluateTraining(readiness, context, date);
        const tomorrowRec = evaluateNextDayPlan(readiness, context, date, todayRec).branches.yellow.recommendation;
        const plan = generateWeekAheadPlan(
            readiness, context, null, date, todayRec, tomorrowRec,
            prepareWeekAheadPlanSeed(readiness, [event], date, []),
            { days: 7, events: [event] },
        );
        console.log('\n=== 7-DAY FORECAST (priority-A cycling event) ===');
        plan.days.forEach(d => console.log(
            `${d.date} off=${d.dayOffset} [${d.confidence.padEnd(11)}] ${d.location.padEnd(6)} ${d.template.modality.padEnd(8)} ${d.template.title.padEnd(32)} (${d.template.category})`
        ));
        console.log('\n=== FINAL OBJECTIVE LEDGER ===');
        plan.microcycleObjectives.forEach(o => console.log(`${o.key.padEnd(22)} ${o.completedExposures}/${o.targetExposures}`));
    });

    it('C) same forecast with NO event (Base phase)', () => {
        const context = baseContext();
        const readiness: DailyReadiness = { subjective: subj(), objective: obj() };
        const date = '2026-08-07';
        const todayRec = evaluateTraining(readiness, context, date);
        const tomorrowRec = evaluateNextDayPlan(readiness, context, date, todayRec).branches.yellow.recommendation;
        const plan = generateWeekAheadPlan(
            readiness, context, null, date, todayRec, tomorrowRec,
            prepareWeekAheadPlanSeed(readiness, [], date, []), { days: 7 },
        );
        console.log('\n=== 7-DAY FORECAST (no event, Base) ===');
        plan.days.forEach(d => console.log(
            `${d.date} off=${d.dayOffset} [${d.confidence.padEnd(11)}] ${d.location.padEnd(6)} ${d.template.modality.padEnd(8)} ${d.template.title.padEnd(32)} (${d.template.category})`
        ));
        console.log('\n=== FINAL OBJECTIVE LEDGER ===');
        plan.microcycleObjectives.forEach(o => console.log(`${o.key.padEnd(22)} ${o.completedExposures}/${o.targetExposures}`));
    });
});
