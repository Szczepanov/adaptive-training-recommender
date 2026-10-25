/**
 * Layer 4 (`userContext`, ADR-0052 D-USER). Items are forward-looking: they are bounded
 * below by the window start, never truncated at its end (travel next week matters to a plan).
 * `since` and `revisions` stay `not_yet_supported` wherever the backing record has no effective
 * date or revision history; `updatedAt` never stands in for either.
 */
import type { TrainingSettings, UserPreferences } from '../models.ts';
import { byIdThenDate, collect, type BuildContext } from './buildContext.ts';
import type { FixedActivityInput, GoalInput, LedgerExportRecords } from './inputs.ts';
import { contextRecord, fact, fieldMap, notYetSupported, record } from './ledgerValue.ts';
import {
    AVAILABILITY_FIELDS,
    CONSTRAINT_FIELDS,
    ENVIRONMENT_FIELDS,
    EQUIPMENT_FIELDS,
    GOAL_FIELDS,
    GUARDRAIL_FIELDS,
    INJURY_FIELDS,
    PREFERENCE_FIELDS,
    TRAVEL_FIELDS,
    USER_EVENT_FIELDS,
    VENUE_RESTRICTION_FIELDS,
    type ContextRecord,
    type LedgerUserContext,
    type LedgerValue,
} from './schema.ts';

const SOURCE = 'athlete';

function singleton<F extends string>(
    id: string,
    keys: readonly F[],
    read: (key: F) => LedgerValue<unknown>,
): ContextRecord<F> {
    return contextRecord(record(id, null, fieldMap(keys, read)));
}

/** `undefined` = the settings source was not read; `null` = read, nothing stored. */
function absentState(settings: unknown): 'unavailable' | 'missing' {
    return settings === undefined ? 'unavailable' : 'missing';
}

function buildEquipment(settings: TrainingSettings | null | undefined) {
    return singleton('equipment', EQUIPMENT_FIELDS, key => fact(
        (settings?.equipment as Partial<Record<string, boolean>> | undefined)?.[key],
        { source: SOURCE, absent: absentState(settings) },
    ));
}

function buildEnvironment(settings: TrainingSettings | null | undefined) {
    const absent = absentState(settings);
    return singleton('environment', ENVIRONMENT_FIELDS, key => {
        const defaults = settings?.defaults;
        if (key === 'defaultEnvironment') return fact(defaults?.environment, { source: SOURCE, absent });
        const minutes = key === 'weekdayMaxMinutes' ? defaults?.weekdayMaxMinutes : defaults?.weekendMaxMinutes;
        return fact(minutes, { source: SOURCE, unit: 'min', absent: defaults ? 'not_recorded' : absent });
    });
}

function buildGuardrails(settings: TrainingSettings | null | undefined) {
    return singleton('guardrails', GUARDRAIL_FIELDS, key => fact(
        settings?.guardrails?.[key],
        { source: SOURCE, absent: absentState(settings) },
    ));
}

function buildInjuries(records: LedgerExportRecords, context: BuildContext): LedgerUserContext['injuries'] {
    const injuries = records.trainingSettings === undefined ? undefined : (records.trainingSettings?.injuries ?? []);
    return collect(context, 'training_settings', injuries, rows => rows.map((row, index) => {
        const base = { source: SOURCE };
        const values: Record<typeof INJURY_FIELDS[number], LedgerValue<unknown>> = {
            region: fact(row.region, { ...base, absent: 'not_recorded' }),
            severity: fact(row.severity, base),
            reviewBy: fact(row.reviewBy, { ...base, absent: 'not_recorded' }),
            note: fact(row.note, { ...base, absent: 'not_recorded' }),
            restrictedModalities: fact(row.restrictedModalities, { ...base, absent: 'not_recorded' }),
        };
        return contextRecord(record(`injury-${index + 1}`, null, values));
    }));
}

function buildTravel(records: LedgerExportRecords, context: BuildContext): LedgerUserContext['travel'] {
    return collect(context, 'plan_blocks', records.planBlocks, rows => byIdThenDate(rows
        .filter(row => row.phase === 'travel' && row.endDate >= context.window.startDate)
        .map(row => {
            const base = { source: SOURCE, observedOn: row.startDate };
            const values: Record<typeof TRAVEL_FIELDS[number], LedgerValue<unknown>> = {
                startDate: fact(row.startDate, base),
                endDate: fact(row.endDate, base),
                volumeScale: fact(row.volumeScale, base),
                intensityScale: fact(row.intensityScale, base),
            };
            // The block's own start date is its effective date.
            return contextRecord(record(row.id, row.startDate, values), fact(row.startDate, base));
        })));
}

function venueItems(rows: readonly FixedActivityInput[], context: BuildContext) {
    return byIdThenDate(rows
        .filter(row => row.availabilityContextOverride && row.date >= context.window.startDate)
        .map(row => {
            const override = row.availabilityContextOverride;
            const base = { source: SOURCE, observedOn: row.date };
            const values: Record<typeof VENUE_RESTRICTION_FIELDS[number], LedgerValue<unknown>> = {
                date: fact(row.date, base),
                title: fact(row.title, base),
                environment: fact(override?.environment, { ...base, absent: 'not_applicable' }),
                equipment: fact(override?.equipment, { ...base, absent: 'not_applicable' }),
            };
            return contextRecord(record(row.id, row.date, values));
        }));
}

function buildVenueRestrictions(records: LedgerExportRecords, context: BuildContext) {
    return collect(context, 'fixed_activities', records.fixedActivities, rows => venueItems(rows, context));
}

function buildAvailability(records: LedgerExportRecords, context: BuildContext): LedgerUserContext['availability'] {
    const fixed = collect(context, 'fixed_activities', records.fixedActivities, rows => rows
        .filter(row => row.date >= context.window.startDate)
        .map(row => {
            const base = { source: SOURCE, observedOn: row.date };
            const values: Record<typeof AVAILABILITY_FIELDS[number], LedgerValue<unknown>> = {
                date: fact(row.date, base),
                kind: fact('fixed_activity', base),
                startLocal: fact(row.startTime, base),
                endLocal: fact(undefined, { ...base, absent: 'not_applicable' }),
                durationMin: fact(row.durationMin, { ...base, unit: 'min' }),
                title: fact(row.title, base),
                fixed: fact(row.fixed, base),
            };
            return contextRecord(record(`fixed-${row.id}`, row.date, values));
        }));
    const windows = collect(context, 'schedule_windows', records.scheduleWindows, rows => rows
        .filter(row => row.date >= context.window.startDate)
        .map(row => {
            const base = { source: SOURCE, observedOn: row.date };
            const values: Record<typeof AVAILABILITY_FIELDS[number], LedgerValue<unknown>> = {
                date: fact(row.date, base),
                kind: fact('schedule_window', base),
                startLocal: fact(row.startLocal, base),
                endLocal: fact(row.endLocal, base),
                durationMin: fact(undefined, { ...base, absent: 'not_applicable' }),
                title: fact(row.label, { ...base, absent: 'not_recorded' }),
                fixed: fact(undefined, { ...base, absent: 'not_applicable' }),
            };
            return contextRecord(record(`window-${row.id}`, row.date, values));
        }));
    const worst = [fixed.state, windows.state].find(state => state !== 'measured') ?? 'measured';
    return { state: worst, source: 'fixed_activities+schedule_windows', items: byIdThenDate([...fixed.items, ...windows.items]) };
}

function buildPreferences(preferences: UserPreferences | null | undefined) {
    return singleton('preferences', PREFERENCE_FIELDS, key => {
        const value = preferences?.[key];
        return fact(value, { source: SOURCE, absent: preferences === undefined ? 'unavailable' : 'missing' });
    });
}

function goalValues(row: GoalInput): Record<typeof GOAL_FIELDS[number], LedgerValue<unknown>> {
    const base = { source: SOURCE };
    const optional = { ...base, absent: 'not_recorded' as const };
    return {
        title: fact(row.title, base),
        domain: fact(row.domain, base),
        status: fact(row.status, base),
        priority: fact(row.priority, base),
        targetDate: fact(row.targetDate, optional),
        targetOutcome: fact(row.targetOutcome, optional),
        eventCategory: fact(row.eventCategory, optional),
        eventLifecycle: fact(row.eventLifecycle, optional),
    };
}

function buildGoals(records: LedgerExportRecords, context: BuildContext): LedgerUserContext['goals'] {
    return collect(context, 'goals', records.goals, rows => byIdThenDate(rows
        .map(row => contextRecord(record(row.id, row.targetDate ?? null, goalValues(row))))));
}

function eventValues(title: string | undefined, startDate: string, endDate: string) {
    const base = { source: SOURCE, observedOn: startDate };
    const values: Record<typeof USER_EVENT_FIELDS[number], LedgerValue<unknown>> = {
        title: fact(title, { ...base, absent: 'not_recorded' }),
        startDate: fact(startDate, base),
        endDate: fact(endDate, base),
    };
    return values;
}

/** Events are goal-embedded target events (ADR-0041/0048-0050) and intent-block date ranges. */
function buildEvents(records: LedgerExportRecords, context: BuildContext): LedgerUserContext['events'] {
    const fromGoals = collect(context, 'goals', records.goals, rows => rows
        .filter(row => row.eventCategory && row.targetDate && row.targetDate >= context.window.startDate)
        .map(row => contextRecord(record(`goal-${row.id}`, row.targetDate ?? null,
            eventValues(row.title, row.targetDate as string, row.targetDate as string)))));
    const fromBlocks = collect(context, 'intent_blocks', records.intentBlocks, rows => rows
        .filter(row => row.dateRange.endDate >= context.window.startDate)
        .map(row => contextRecord(record(`block-${row.id}`, row.dateRange.startDate,
            eventValues(row.title, row.dateRange.startDate, row.dateRange.endDate)))));
    const worst = [fromGoals.state, fromBlocks.state].find(state => state !== 'measured') ?? 'measured';
    return { state: worst, source: 'goals+intent_blocks', items: byIdThenDate([...fromGoals.items, ...fromBlocks.items]) };
}

function buildConstraints(records: LedgerExportRecords, context: BuildContext): LedgerUserContext['constraints'] {
    return collect(context, 'constraints', records.constraints, rows => rows.map(row => {
        const base = { source: SOURCE };
        const values: Record<typeof CONSTRAINT_FIELDS[number], LedgerValue<unknown>> = {
            label: fact(row.label, base),
            value: fact(row.value, base),
            severity: fact(row.severity, base),
            isActive: fact(row.isActive, base),
            category: fact(row.category, base),
            description: fact(row.description, { ...base, absent: 'not_recorded' }),
        };
        return contextRecord(record(row.key, null, values));
    }).sort((a, b) => a.id.localeCompare(b.id)));
}

export function buildUserContext(records: LedgerExportRecords, context: BuildContext): LedgerUserContext {
    return {
        injuries: buildInjuries(records, context),
        equipment: buildEquipment(records.trainingSettings),
        environment: buildEnvironment(records.trainingSettings),
        guardrails: buildGuardrails(records.trainingSettings),
        travel: buildTravel(records, context),
        venueRestrictions: buildVenueRestrictions(records, context),
        availability: buildAvailability(records, context),
        preferences: buildPreferences(records.preferences),
        goals: buildGoals(records, context),
        events: buildEvents(records, context),
        constraints: buildConstraints(records, context),
        trainingDislikes: notYetSupported<string[]>(SOURCE),
    };
}
