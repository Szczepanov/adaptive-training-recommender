/** Layer 1 (`facts`): what was recorded, with no interpretation. */
import { addDaysToLocalDateString } from '../../utils/localDate.ts';
import type { NutritionDay } from '../../nutrition/models.ts';
import type { MetricObservationRevision } from '../../observations/models.ts';
import type { DailyRecoverySnapshot, DailySubjectiveCheckin } from '../models.ts';
import { buildActivities } from './buildActivities.ts';
import { collect, sourceState, type BuildContext } from './buildContext.ts';
import type { LedgerExportRecords, OccurrenceInput } from './inputs.ts';
import { fact, fieldMap, notYetSupported, rangedFact, record, withSourceState, type ValueRange } from './ledgerValue.ts';
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
    type LedgerState,
    type LedgerValue,
} from './schema.ts';
import { warsawDateOf } from './window.ts';

type RecoveryField = typeof RECOVERY_FIELDS[number];
type MetricDateKey = keyof NonNullable<DailyRecoverySnapshot['source']['metricDates']>;

interface RecoverySpec {
    read: (raw: DailyRecoverySnapshot['raw']) => string | number | null | undefined;
    unit?: string;
    range?: ValueRange;
    metricDate?: MetricDateKey;
    /** I3: `totalSteps` describes D-1, not the snapshot date. */
    dayOffset?: number;
}

const PERCENT: ValueRange = { min: 0, max: 100 };

const RECOVERY_SPECS: Record<RecoveryField, RecoverySpec> = {
    sleepScore: { read: r => r.sleepScore, unit: 'score', range: PERCENT, metricDate: 'sleep' },
    sleepDurationSec: { read: r => r.sleepDurationSec, unit: 's', range: { min: 0, max: 86400 }, metricDate: 'sleep' },
    restingHr: { read: r => r.restingHr, unit: 'bpm', range: { min: 0, max: 250, minExclusive: true }, metricDate: 'restingHr' },
    hrvOvernightAvg: { read: r => r.hrvOvernightAvg, unit: 'ms', range: { min: 0, max: 500, minExclusive: true }, metricDate: 'hrv' },
    hrvStatus: { read: r => r.hrvStatus, metricDate: 'hrv' },
    respirationAvg: { read: r => r.respirationAvg, unit: 'breaths/min', range: { min: 0, max: 80, minExclusive: true } },
    bodyBatteryWake: { read: r => r.bodyBatteryWake, unit: 'score', range: PERCENT, metricDate: 'bodyBatteryWake' },
    totalSteps: { read: r => r.totalSteps, unit: 'steps', range: { min: 0, max: 200000 }, metricDate: 'steps', dayOffset: -1 },
    stressAvg: { read: r => r.stress?.avg, unit: 'score', range: PERCENT, metricDate: 'stress' },
    weightKg: { read: r => r.weightKg, unit: 'kg', range: { min: 0, max: 500, minExclusive: true }, metricDate: 'weight' },
    bodyFatPct: { read: r => r.bodyFatPct, unit: '%', range: { min: 0, max: 100, minExclusive: true }, metricDate: 'weight' },
};

function recoveryValue(snapshot: DailyRecoverySnapshot, spec: RecoverySpec): LedgerValue<unknown> {
    const expected = addDaysToLocalDateString(snapshot.date, spec.dayOffset ?? 0);
    const reported = spec.metricDate ? snapshot.source.metricDates?.[spec.metricDate] : undefined;
    const observedOn = reported ?? expected;
    const options = {
        source: 'garmin',
        unit: spec.unit,
        observedOn,
        present: observedOn < expected ? ('stale' as const) : ('measured' as const),
    };
    const value = spec.read(snapshot.raw);
    return typeof value === 'number' && spec.range ? rangedFact(value, spec.range, options) : fact(value, options);
}

function buildRecovery(records: LedgerExportRecords, context: BuildContext): LedgerFacts['recovery'] {
    return collect(context, {
        key: 'daily_recovery_snapshots',
        records: records.recovery,
        dateOf: row => row.date,
        toItem: row => record(`recovery-${row.date}`, row.date,
            fieldMap(RECOVERY_FIELDS, key => recoveryValue(row, RECOVERY_SPECS[key]))),
    });
}

const CHECKIN_SCORES = ['readiness', 'sleepQuality', 'fatigue', 'soreness', 'mentalStress', 'motivation'] as const;
const CHECKIN_FLAGS = ['painOrInjury', 'illnessSymptoms', 'unusuallyLimitedTime', 'alreadyTrainedToday'] as const;
const SCORE_RANGE: ValueRange = { min: 1, max: 10 };

function checkinValue(row: DailySubjectiveCheckin, key: typeof CHECKIN_FIELDS[number]): LedgerValue<unknown> {
    const common = { source: 'athlete', observedOn: row.date, absent: 'not_recorded' as const };
    if ((CHECKIN_SCORES as readonly string[]).includes(key)) {
        return rangedFact(row[key as typeof CHECKIN_SCORES[number]], SCORE_RANGE, { ...common, unit: 'score_1_10' });
    }
    if ((CHECKIN_FLAGS as readonly string[]).includes(key)) {
        return fact(row[key as typeof CHECKIN_FLAGS[number]], common);
    }
    switch (key) {
        case 'tissueResponses': return fact(row.tissueResponses, common);
        case 'redFlags': return fact(row.redFlags, common);
        case 'timeAvailableMin': return rangedFact(row.availability?.timeAvailableMin, { min: 0, max: 1440 }, { ...common, unit: 'min' });
        case 'indoorOnly': return fact(row.availability?.indoorOnly, common);
        case 'preferredModalityToday': return fact(row.availability?.preferredModalityToday, common);
        default: return fact(row.notes, common);
    }
}

function buildCheckins(records: LedgerExportRecords, context: BuildContext): LedgerFacts['checkins'] {
    return collect(context, {
        key: 'daily_subjective_checkins',
        records: records.checkins,
        dateOf: row => row.date,
        toItem: row => record(`checkin-${row.date}`, row.date, fieldMap(CHECKIN_FIELDS, key => checkinValue(row, key))),
    });
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
    return collect(context, {
        key: 'performed_training_occurrences',
        records: records.performedOccurrences,
        include: row => row.status !== 'merged',
        dateOf: occurrenceDate,
        toItem: row => {
            const observedOn = occurrenceDate(row) ?? undefined;
            const base = { source: 'adaptive', observedOn };
            const values: Record<typeof PERFORMED_TRAINING_FIELDS[number], LedgerValue<unknown>> = {
                status: fact(row.status, base),
                modality: fact(row.modality, base),
                startedAt: fact(row.startedAt, base),
                endedAt: fact(row.endedAt, base),
                durationMin: fact(occurrenceDurationMin(row), { ...base, unit: 'min' }),
                executedDefinitions: fact(row.executedDefinitions, { ...base, absent: 'unavailable' }),
                structuredEntries: row.structuredEntries
                    ? fact(row.structuredEntries, base)
                    : notYetSupported('adaptive'),
            };
            return record(row.performedOccurrenceId, observedOn ?? null, values);
        },
    });
}

function buildSessionResponses(records: LedgerExportRecords, context: BuildContext): LedgerFacts['sessionResponses'] {
    return collect(context, {
        key: 'session_responses',
        records: records.sessionResponses,
        dateOf: row => row.date,
        toItem: row => {
            const base = { source: 'athlete', observedOn: row.date, absent: 'not_recorded' as const };
            const values: Record<typeof SESSION_RESPONSE_FIELDS[number], LedgerValue<unknown>> = {
                window: fact(row.window, base),
                sourceSession: fact(row.sourceSession, base),
                occurrenceId: fact(row.occurrenceId, { ...base, absent: 'not_applicable' }),
                sessionRpe: rangedFact(row.sessionRpe, { min: 0, max: 10 }, { ...base, unit: 'rpe_0_10' }),
                completedFraction: rangedFact(row.completedFraction, { min: 0, max: 1 }, { ...base, unit: 'fraction_0_1' }),
                unexpectedFatigue: fact(row.unexpectedFatigue, base),
                techniqueNote: fact(row.techniqueNote, base),
                note: fact(row.note, base),
            };
            return record(row.responseId, row.date, values);
        },
    });
}

function assessmentValues(
    row: MetricObservationRevision,
    attempts: LedgerExportRecords['assessmentAttempts'],
    date: string | null,
): Record<typeof ASSESSMENT_FIELDS[number], LedgerValue<unknown>> {
    const base = { source: row.source, ...(date ? { observedOn: date } : {}) };
    const attempt = attempts?.find(candidate => candidate.id === row.assessmentAttemptId);
    const unknownAttempt = attempts === undefined ? 'unavailable' : 'missing';
    return {
        metricId: fact(row.metricId, base),
        value: row.validity === 'invalid'
            ? fact<number>(null, { ...base, unit: row.unit, absent: 'invalid' })
            : fact(row.value, { ...base, unit: row.unit }),
        validity: fact(row.validity, base),
        invalidReason: fact(row.invalidReason, { ...base, absent: 'not_applicable' }),
        assessmentAttemptId: fact(row.assessmentAttemptId, base),
        attemptState: fact(attempt?.state, { ...base, absent: unknownAttempt }),
        attemptPurpose: fact(attempt?.purpose, { ...base, absent: unknownAttempt }),
    };
}

/** A correction supersedes its earlier revisions: only the highest revision per key is a current fact. */
function currentRevisions(rows: readonly MetricObservationRevision[] | undefined): MetricObservationRevision[] | undefined {
    if (!rows) return undefined;
    const highest = new Map<string, number>();
    for (const row of rows) highest.set(row.observationKey, Math.max(highest.get(row.observationKey) ?? row.revision, row.revision));
    return rows.filter(row => highest.get(row.observationKey) === row.revision);
}

function buildAssessments(records: LedgerExportRecords, context: BuildContext): LedgerFacts['assessments'] {
    return collect(context, {
        key: 'metric_observations',
        records: currentRevisions(records.metricObservations),
        dateOf: row => warsawDateOf(row.observedAt),
        toItem: row => {
            const date = warsawDateOf(row.observedAt);
            return record(`${row.observationKey}@${row.revision}`, date, assessmentValues(row, records.assessmentAttempts, date));
        },
    });
}

function buildBodyComposition(records: LedgerExportRecords, context: BuildContext): LedgerFacts['bodyComposition'] {
    return collect(context, {
        key: 'anthropometry_entries',
        records: records.anthropometry,
        dateOf: row => row.date,
        toItem: row => {
            const mass = row.measurements.find(measurement => measurement.metricId === 'body_mass_kg');
            const values: Record<typeof BODY_COMPOSITION_FIELDS[number], LedgerValue<unknown>> = {
                weightKg: rangedFact(mass?.value, { min: 0, max: 500, minExclusive: true }, {
                    source: row.protocol, unit: 'kg', observedOn: row.date, absent: 'not_recorded',
                }),
            };
            return record(row.id, row.date, values);
        },
    });
}

/** `nutritionAdherenceYesterday` on the check-in of D+1 describes nutrition day D. */
function adherenceByNutritionDate(checkins: LedgerExportRecords['checkins']): Map<string, string> {
    const entries = (checkins ?? []).flatMap(row => row.nutritionAdherenceYesterday
        ? [[addDaysToLocalDateString(row.date, -1), row.nutritionAdherenceYesterday] as const]
        : []);
    return new Map(entries);
}

function intakeFact(
    day: NutritionDay,
    value: number | null | undefined,
    range: ValueRange,
    unit: string,
): LedgerValue<number> {
    const options = { source: day.source.provider, unit, observedOn: day.date, absent: 'not_recorded' as const };
    // An explicit "nothing logged" flag wins over a stored zero: unlogged is not zero intake.
    return day.hasIntakeData === false ? fact<number>(null, options) : rangedFact(value, range, options);
}

function nutritionValues(
    day: NutritionDay,
    adherence: Map<string, string>,
    checkinState: LedgerState,
): Record<typeof NUTRITION_FIELDS[number], LedgerValue<unknown>> {
    const macros = day.macronutrients;
    const grams: ValueRange = { min: 0, max: 5000 };
    return {
        energyIntakeKcal: intakeFact(day, day.energyIntakeKcal, { min: 0, max: 30000 }, 'kcal'),
        proteinGrams: intakeFact(day, macros?.proteinGrams, grams, 'g'),
        carbsGrams: intakeFact(day, macros?.carbsGrams, grams, 'g'),
        fatGrams: intakeFact(day, macros?.fatGrams, grams, 'g'),
        hasIntakeData: fact(day.hasIntakeData, { source: day.source.provider, observedOn: day.date }),
        adherence: withSourceState(fact(adherence.get(day.date), {
            source: 'athlete', observedOn: day.date, absent: 'not_recorded',
        }), checkinState),
    };
}

function buildNutrition(records: LedgerExportRecords, context: BuildContext): LedgerFacts['nutrition'] {
    const adherence = adherenceByNutritionDate(records.checkins);
    return collect(context, {
        key: 'nutrition_days',
        records: records.nutritionDays,
        dateOf: row => row.date,
        toItem: row => record(`nutrition-${row.date}`, row.date,
            nutritionValues(row, adherence, sourceState(context, 'daily_subjective_checkins', records.checkins !== undefined))),
    });
}

function buildOutcomes(records: LedgerExportRecords, context: BuildContext): LedgerFacts['events'] {
    return collect(context, {
        key: 'competition_outcomes',
        records: records.competitionOutcomes,
        dateOf: row => warsawDateOf(row.occurredAt),
        toItem: row => {
            const date = warsawDateOf(row.occurredAt);
            const base = { source: row.source, ...(date ? { observedOn: date } : {}) };
            const optional = { ...base, absent: 'not_recorded' as const };
            const result = row.result;
            const values: Record<typeof OUTCOME_FIELDS[number], LedgerValue<unknown>> = {
                sport: fact(row.sport, base),
                completed: fact(result.completed, base),
                placing: fact(result.placing, optional),
                fieldSize: fact(result.fieldSize, optional),
                elapsedSeconds: fact(result.elapsedSeconds, { ...optional, unit: 's' }),
                distanceM: fact(result.distanceM, { ...optional, unit: 'm' }),
                summary: fact(result.summary, optional),
            };
            return record(row.id, date, values);
        },
    });
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
