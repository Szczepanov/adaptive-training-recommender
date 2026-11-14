/** Layer 2 (`derived`): baselines over the recorded facts, plus their state-bearing deltas. */
import { addDaysToLocalDateString } from '../../utils/localDate.ts';
import { computeSubjectiveBaseline, REFERENCE_SUBJECTIVE_BASELINE_POLICY, SUBJECTIVE_BASELINE_METRICS } from '../../derived/baselines/subjectiveBaseline.ts';
import { baselineDeltas, CHECKIN_BASELINE_KEYS, RECOVERY_BASELINE_KEYS } from './baselineDeltas.ts';
import type { BuildLedgerExportInput, SourceKey } from './inputs.ts';
import { fact, notYetSupported, rangedFact } from './ledgerValue.ts';
import { DERIVED_METRIC_IDS, type DerivedMetric, type DerivedMetricId, type LedgerFacts, type LedgerState, type LedgerValue } from './schema.ts';

const DERIVED_DEFINITIONS: Record<DerivedMetricId, { definition: string; window: string }> = {
    subjective_baselines: { definition: 'Subjective baseline averages and variability', window: '7d,28d' },
    biometric_baselines: { definition: 'Rolling biometric baselines (ADR-0024)', window: '7d,28d' },
    d_minus_1_step_normalization: { definition: 'D-1 step normalization (I3, ADR-0003)', window: '7d,28d' },
    rolling_performed_training_load: { definition: 'Rolling performed-training load and exposure ledgers (#813)', window: '7d,28d' },
};

const BIOMETRIC_KEYS = [
    'sleepScore7dAvg', 'sleepScore28dAvg', 'sleepScore28dStdev',
    'restingHr7dAvg', 'restingHr28dAvg', 'restingHr28dStdev',
    'hrv7dAvg', 'hrv28dAvg', 'hrv28dStdev',
    'respiration7dAvg', 'respiration28dAvg', 'respiration28dMad',
] as const;

type Metrics = Record<string, LedgerValue<number>>;

function biometricMetrics(input: BuildLedgerExportInput, recoveryState: LedgerState): Metrics {
    const snapshot = input.records.recovery?.find(row => row.date === input.asOfDate);
    return Object.fromEntries(BIOMETRIC_KEYS.map(key => {
        const ready = key.includes('7d') ? snapshot?.dataQuality.baseline7dReady : snapshot?.dataQuality.baseline28dReady;
        const absent = recoveryState === 'measured' ? 'missing' : recoveryState;
        const unit = key.startsWith('sleep') ? 'score' : key.startsWith('restingHr') ? 'bpm'
            : key.startsWith('hrv') ? 'ms' : 'breaths/min';
        const value = recoveryState === 'measured' && ready ? snapshot?.derived[key] : null;
        return [key, rangedFact(value, {}, {
            source: 'daily_recovery_snapshots', unit, observedOn: input.asOfDate, absent,
        })];
    }));
}

function subjectiveMetrics(input: BuildLedgerExportInput, checkinState: LedgerState): Metrics {
    const baseline = checkinState === 'measured'
        ? computeSubjectiveBaseline(input.records.checkins ?? [], input.asOfDate, REFERENCE_SUBJECTIVE_BASELINE_POLICY)
        : null;
    const subjective: Metrics = {};
    for (const metric of SUBJECTIVE_BASELINE_METRICS) {
        for (const field of ['recentAvg', 'longAvg', 'variability'] as const) {
            subjective[`${metric}_${field}`] = fact(baseline?.metrics[metric][field], {
                source: 'daily_subjective_checkins', unit: '1-10', observedOn: input.asOfDate,
                absent: checkinState === 'measured' ? 'missing' : checkinState,
            });
        }
    }
    const completeDates = new Set((input.records.checkins ?? []).filter(row =>
        row.date < input.asOfDate && SUBJECTIVE_BASELINE_METRICS.every(metric => {
            const value = row[metric];
            return typeof value === 'number' && Number.isFinite(value) && value >= 1 && value <= 10;
        }),
    ).map(row => row.date));
    for (const [field, days] of [['recentRecordedDays', 7], ['longRecordedDays', 28]] as const) {
        const start = addDaysToLocalDateString(input.asOfDate, -days);
        const count = [...completeDates].filter(date => date >= start).length;
        subjective[field] = fact(checkinState === 'measured' ? count : null, {
            source: 'daily_subjective_checkins', unit: 'days', observedOn: input.asOfDate, absent: checkinState,
        });
    }
    return subjective;
}

export function buildDerived(input: BuildLedgerExportInput, facts: LedgerFacts): DerivedMetric[] {
    const sourceState = (key: SourceKey, present: boolean) =>
        present ? input.sources?.[key]?.state ?? 'measured' : 'unavailable';
    const recoveryState = sourceState('daily_recovery_snapshots', input.records.recovery !== undefined);
    const checkinState = sourceState('daily_subjective_checkins', input.records.checkins !== undefined);
    const hasSnapshot = input.records.recovery?.some(row => row.date === input.asOfDate) ?? false;
    const biometricBase = biometricMetrics(input, recoveryState);
    const subjectiveBase = subjectiveMetrics(input, checkinState);
    const common = { asOfDate: input.asOfDate };
    const biometric: Metrics = { ...biometricBase, ...baselineDeltas({ ...common, collection: facts.recovery,
        absentRow: 'missing', baselines: RECOVERY_BASELINE_KEYS, metrics: biometricBase, source: 'daily_recovery_snapshots' }) };
    const subjective: Metrics = { ...subjectiveBase, ...baselineDeltas({ ...common, collection: facts.checkins,
        absentRow: 'not_recorded', baselines: CHECKIN_BASELINE_KEYS, metrics: subjectiveBase, source: 'daily_subjective_checkins' }) };
    return DERIVED_METRIC_IDS.map(id => {
        const metrics = id === 'biometric_baselines' ? biometric : id === 'subjective_baselines' ? subjective : undefined;
        const state = id === 'biometric_baselines' ? recoveryState : checkinState;
        const aggregateState = state !== 'measured' ? state
            : id === 'biometric_baselines' && !hasSnapshot ? 'missing' : 'not_applicable';
        return {
            id,
            ...DERIVED_DEFINITIONS[id],
            value: metrics ? fact<number>(null, {
                source: id === 'biometric_baselines' ? 'daily_recovery_snapshots' : 'daily_subjective_checkins',
                absent: aggregateState,
            }) : notYetSupported<number>(),
            inputs: [],
            ...(metrics ? { metrics } : {}),
        };
    });
}
