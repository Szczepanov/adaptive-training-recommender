/** Layer 1 (`facts`): what was recorded, with no interpretation. */
import { addDaysToLocalDateString } from '../../utils/localDate.ts';
import type { DailyRecoverySnapshot, DailySubjectiveCheckin } from '../models.ts';
import { buildActivities } from './buildActivities.ts';
import { byIdThenDate, collect, type BuildContext } from './buildContext.ts';
import type { LedgerExportRecords, OccurrenceInput } from './inputs.ts';
import { fact, fieldMap, record } from './ledgerValue.ts';
import {
    ASSESSMENT_FIELDS,
    BODY_COMPOSITION_FIELDS,
    CHECKIN_FIELDS,
    NUTRITION_FIELDS,
    OUTCOME_FIELDS,
    PERFORMED_TRAINING_FIELDS,
    RECOVERY_FIELDS,
    SESSION_RESPONSE_FIELDS,
    type LedgerFacts,
    type LedgerValue,
} from './schema.ts';
import { inWindow, warsawDateOf } from './window.ts';

type RecoveryField = typeof RECOVERY_FIELDS[number];
type MetricDateKey = keyof NonNullable<DailyRecoverySnapshot['source']['metricDates']>;

interface RecoverySpec {
    read: (raw: DailyRecoverySnapshot['raw']) => string | number | null | undefined;
    unit?: string;
    metricDate?: MetricDateKey;
    /** I3: `totalSteps` describes D-1, not the snapshot date. */
    dayOffset?: number;
}

const RECOVERY_SPECS: Record<RecoveryField, RecoverySpec> = {
    sleepScore: { read: r => r.sleepScore, unit: 'score', metricDate: 'sleep' },
    sleepDurationSec: { read: r => r.sleepDurationSec, unit: 's', metricDate: 'sleep' },
    restingHr: { read: r => r.restingHr, unit: 'bpm', metricDate: 'restingHr' },
    hrvOvernightAvg: { read: r => r.hrvOvernightAvg, unit: 'ms', metricDate: 'hrv' },
    hrvStatus: { read: r => r.hrvStatus, metricDate: 'hrv' },
    respirationAvg: { read: r => r.respirationAvg, unit: 'breaths/min' },
    bodyBatteryWake: { read: r => r.bodyBatteryWake, unit: 'score', metricDate: 'bodyBatteryWake' },
    totalSteps: { read: r => r.totalSteps, unit: 'steps', metricDate: 'steps', dayOffset: -1 },
    stressAvg: { read: r => r.stress?.avg, unit: 'score', metricDate: 'stress' },
    weightKg: { read: r => r.weightKg, unit: 'kg', metricDate: 'weight' },
    bodyFatPct: { read: r => r.bodyFatPct, unit: '%', metricDate: 'weight' },
};

function recoveryValue(snapshot: DailyRecoverySnapshot, spec: RecoverySpec): LedgerValue<unknown> {
    const expected = addDaysToLocalDateString(snapshot.date, spec.dayOffset ?? 0);
    const reported = spec.metricDate ? snapshot.source.metricDates?.[spec.metricDate] : undefined;
    const observedOn = reported ?? expected;
    return fact(spec.read(snapshot.raw), {
        source: 'garmin',
        unit: spec.unit,
        observedOn,
        present: observedOn < expected ? 'stale' : 'measured',
    });
}

function buildRecovery(records: LedgerExportRecords, context: BuildContext): LedgerFacts['recovery'] {
    return collect(context, 'daily_recovery_snapshots', records.recovery, rows => byIdThenDate(rows
        .filter(row => inWindow(row.date, context.window))
        .map(row => record(row.date, row.date, fieldMap(RECOVERY_FIELDS, key => recoveryValue(row, RECOVERY_SPECS[key]))))));
}

const CHECKIN_SCORES = ['readiness', 'sleepQuality', 'fatigue', 'soreness', 'mentalStress', 'motivation'] as const;
const CHECKIN_FLAGS = ['painOrInjury', 'illnessSymptoms', 'unusuallyLimitedTime', 'alreadyTrainedToday'] as const;

function checkinValue(row: DailySubjectiveCheckin, key: typeof CHECKIN_FIELDS[number]): LedgerValue<unknown> {
    const common = { source: 'athlete', observedOn: row.date, absent: 'not_recorded' as const };
    if ((CHECKIN_SCORES as readonly string[]).includes(key)) {
        return fact(row[key as typeof CHECKIN_SCORES[number]], { ...common, unit: 'score_1_10' });
    }
    if ((CHECKIN_FLAGS as readonly string[]).includes(key)) {
        return fact(row[key as typeof CHECKIN_FLAGS[number]], common);
    }
    return fact(row.notes, common);
}

function buildCheckins(records: LedgerExportRecords, context: BuildContext): LedgerFacts['checkins'] {
    return collect(context, 'daily_subjective_checkins', records.checkins, rows => byIdThenDate(rows
        .filter(row => inWindow(row.date, context.window))
        .map(row => record(row.date, row.date, fieldMap(CHECKIN_FIELDS, key => checkinValue(row, key))))));
}

function occurrenceDate(row: OccurrenceInput): string | null {
    return row.localDate ?? warsawDateOf(row.startedAt);
}

/** Unknown duration stays missing; it is never summed as zero. */
function occurrenceDurationMin(row: OccurrenceInput): number | null {
    if (!row.startedAt || !row.endedAt) return null;
    const minutes = (Date.parse(row.endedAt) - Date.parse(row.startedAt)) / 60000;
    return Number.isFinite(minutes) && minutes >= 0 ? Math.round(minutes * 10) / 10 : null;
}

function buildPerformedTraining(records: LedgerExportRecords, context: BuildContext): LedgerFacts['performedTraining'] {
    return collect(context, 'performed_training_occurrences', records.performedOccurrences, rows => byIdThenDate(rows
        .filter(row => row.status !== 'merged' && inWindow(occurrenceDate(row), context.window))
        .map(row => {
            const observedOn = occurrenceDate(row);
            const base = { source: 'adaptive', ...(observedOn ? { observedOn } : {}) };
            const values: Record<typeof PERFORMED_TRAINING_FIELDS[number], LedgerValue<unknown>> = {
                status: fact(row.status, base),
                modality: fact(row.modality, base),
                startedAt: fact(row.startedAt, base),
                endedAt: fact(row.endedAt, base),
                durationMin: fact(occurrenceDurationMin(row), { ...base, unit: 'min' }),
                structuredEntries: fact(row.structuredEntries, base),
            };
            return record(row.performedOccurrenceId, observedOn, values);
        })));
}

function buildSessionResponses(records: LedgerExportRecords, context: BuildContext): LedgerFacts['sessionResponses'] {
    return collect(context, 'session_responses', records.sessionResponses, rows => byIdThenDate(rows
        .filter(row => inWindow(row.date, context.window))
        .map(row => {
            const base = { source: 'athlete', observedOn: row.date, absent: 'not_recorded' as const };
            const values: Record<typeof SESSION_RESPONSE_FIELDS[number], LedgerValue<unknown>> = {
                window: fact(row.window, base),
                sessionRpe: fact(row.sessionRpe, { ...base, unit: 'rpe_0_10' }),
                completedFraction: fact(row.completedFraction, { ...base, unit: 'fraction_0_1' }),
                unexpectedFatigue: fact(row.unexpectedFatigue, base),
                techniqueNote: fact(row.techniqueNote, base),
                note: fact(row.note, base),
            };
            return record(row.responseId, row.date, values);
        })));
}

function buildAssessments(records: LedgerExportRecords, context: BuildContext): LedgerFacts['assessments'] {
    return collect(context, 'assessments', records.assessments, rows => byIdThenDate(rows
        .filter(row => inWindow(row.date, context.window))
        .map(row => {
            const base = { source: 'athlete', observedOn: row.date };
            const values: Record<typeof ASSESSMENT_FIELDS[number], LedgerValue<unknown>> = {
                kind: fact(row.kind, base),
                metric: fact(row.metric, base),
                value: fact(row.value, { ...base, unit: row.unit }),
            };
            return record(row.id, row.date, values);
        })));
}

function buildBodyComposition(records: LedgerExportRecords, context: BuildContext): LedgerFacts['bodyComposition'] {
    return collect(context, 'body_composition', records.bodyComposition, rows => byIdThenDate(rows
        .filter(row => inWindow(row.date, context.window))
        .map(row => {
            const base = { source: 'athlete', observedOn: row.date };
            const values: Record<typeof BODY_COMPOSITION_FIELDS[number], LedgerValue<unknown>> = {
                weightKg: fact(row.weightKg, { ...base, unit: 'kg' }),
                bodyFatPct: fact(row.bodyFatPct, { ...base, unit: '%' }),
            };
            return record(row.date, row.date, values);
        })));
}

function buildNutrition(records: LedgerExportRecords, context: BuildContext): LedgerFacts['nutrition'] {
    return collect(context, 'nutrition_days', records.nutritionDays, rows => byIdThenDate(rows
        .filter(row => inWindow(row.date, context.window))
        .map(row => {
            const base = { source: 'athlete', observedOn: row.date };
            const values: Record<typeof NUTRITION_FIELDS[number], LedgerValue<unknown>> = {
                energyKcal: fact(row.energyKcal, { ...base, unit: 'kcal' }),
                proteinG: fact(row.proteinG, { ...base, unit: 'g' }),
                carbsG: fact(row.carbsG, { ...base, unit: 'g' }),
                fatG: fact(row.fatG, { ...base, unit: 'g' }),
                adherence: fact(row.adherence, { ...base, absent: 'not_recorded' }),
            };
            return record(row.date, row.date, values);
        })));
}

function buildOutcomes(records: LedgerExportRecords, context: BuildContext): LedgerFacts['events'] {
    return collect(context, 'competition_outcomes', records.competitionOutcomes, rows => byIdThenDate(rows
        .map(row => ({ row, date: warsawDateOf(row.occurredAt) }))
        .filter(({ date }) => inWindow(date, context.window))
        .map(({ row, date }) => {
            const base = { source: 'athlete', ...(date ? { observedOn: date } : {}) };
            const result = row.result;
            const values: Record<typeof OUTCOME_FIELDS[number], LedgerValue<unknown>> = {
                sport: fact(row.sport, base),
                completed: fact(result.completed, base),
                placing: fact(result.placing, { ...base, absent: 'not_recorded' }),
                fieldSize: fact(result.fieldSize, { ...base, absent: 'not_recorded' }),
                elapsedSeconds: fact(result.elapsedSeconds, { ...base, unit: 's', absent: 'not_recorded' }),
                distanceM: fact(result.distanceM, { ...base, unit: 'm', absent: 'not_recorded' }),
                summary: fact(result.summary, { ...base, absent: 'not_recorded' }),
            };
            return record(row.id, date, values);
        })));
}

export function buildFacts(records: LedgerExportRecords, context: BuildContext): LedgerFacts {
    return {
        recovery: buildRecovery(records, context),
        checkins: buildCheckins(records, context),
        performedTraining: buildPerformedTraining(records, context),
        sessionResponses: buildSessionResponses(records, context),
        assessments: buildAssessments(records, context),
        bodyComposition: buildBodyComposition(records, context),
        nutrition: buildNutrition(records, context),
        activities: buildActivities(records, context),
        events: buildOutcomes(records, context),
    };
}
