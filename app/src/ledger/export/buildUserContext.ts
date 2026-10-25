/**
 * Layer 4 (`userContext`, ADR-0052 D-USER). Items are forward-looking: they are bounded
 * below by the window start, never truncated at its end (travel next week matters to a plan).
 * Goals and constraints are the current active ones only. `since` and `revisions` stay
 * `not_yet_supported` wherever the backing record has no effective date or revision history;
 * `updatedAt` never stands in for either.
 */
import type { TrainingSettings, UserPreferences } from '../models.ts';
import { byDateThenId, collect, sourceState, type BuildContext } from './buildContext.ts';
import type { GoalInput, LedgerExportRecords } from './inputs.ts';
import {
    contextRecord,
    fact,
    fieldMap,
    notYetSupported,
    rangedFact,
    record,
    withSourceState,
    worstState,
} from './ledgerValue.ts';
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
    type LedgerCollection,
    type LedgerState,
    type LedgerUserContext,
    type LedgerValue,
} from './schema.ts';
import { isLocalDate } from './window.ts';

const SOURCE = 'athlete';
const ENDED_LIFECYCLES: readonly string[] = ['cancelled', 'completed'];

/** A settings-backed singleton; the source read state is honoured on every field. */
function singleton<F extends string>(
    context: BuildContext,
    spec: { key: 'training_settings' | 'preferences'; provided: boolean; id: string; keys: readonly F[] },
    read: (key: F) => LedgerValue<unknown>,
): ContextRecord<F> {
    const state = sourceState(context, spec.key, spec.provided);
    return contextRecord(record(spec.id, null, fieldMap(spec.keys, key => withSourceState(read(key), state))));
}

/** `undefined` = the settings source was not read; `null` = read, nothing stored. */
function absentState(settings: unknown): 'unavailable' | 'missing' {
    return settings === undefined ? 'unavailable' : 'missing';
}

function buildEquipment(records: LedgerExportRecords, context: BuildContext) {
    const settings = records.trainingSettings;
    const spec = { key: 'training_settings', provided: settings !== undefined, id: 'equipment', keys: EQUIPMENT_FIELDS } as const;
    return singleton(context, spec, key => fact(
        (settings?.equipment as Partial<Record<string, boolean>> | undefined)?.[key],
        { source: SOURCE, absent: absentState(settings) },
    ));
}

function buildEnvironment(records: LedgerExportRecords, context: BuildContext) {
    const settings = records.trainingSettings;
    const absent = absentState(settings);
    const spec = { key: 'training_settings', provided: settings !== undefined, id: 'environment', keys: ENVIRONMENT_FIELDS } as const;
    return singleton(context, spec, key => {
        const defaults = settings?.defaults;
        if (key === 'defaultEnvironment') return fact(defaults?.environment, { source: SOURCE, absent });
        const minutes = key === 'weekdayMaxMinutes' ? defaults?.weekdayMaxMinutes : defaults?.weekendMaxMinutes;
        return fact(minutes, { source: SOURCE, unit: 'min', absent: defaults ? 'not_recorded' : absent });
    });
}

function buildGuardrails(records: LedgerExportRecords, context: BuildContext) {
    const settings = records.trainingSettings;
    const spec = { key: 'training_settings', provided: settings !== undefined, id: 'guardrails', keys: GUARDRAIL_FIELDS } as const;
    return singleton(context, spec, key => fact(
        settings?.guardrails?.[key],
        { source: SOURCE, absent: absentState(settings) },
    ));
}

function buildPreferences(records: LedgerExportRecords, context: BuildContext) {
    const preferences: UserPreferences | null | undefined = records.preferences;
    const spec = { key: 'preferences', provided: preferences !== undefined, id: 'preferences', keys: PREFERENCE_FIELDS } as const;
    return singleton(context, spec, key => fact(preferences?.[key], { source: SOURCE, absent: absentState(preferences) }));
}

type InjuryRow = NonNullable<TrainingSettings['injuries']>[number];

function injuryValues(row: InjuryRow): Record<typeof INJURY_FIELDS[number], LedgerValue<unknown>> {
    const optional = { source: SOURCE, absent: 'not_recorded' as const };
    return {
        region: fact(row.region, optional),
        severity: fact(row.severity, { source: SOURCE }),
        reviewBy: fact(row.reviewBy, optional),
        note: fact(row.note, optional),
        restrictedModalities: fact(row.restrictedModalities, optional),
    };
}

/** No settings document, or no `injuries` field, is "not recorded", never an empty "none". */
function buildInjuries(records: LedgerExportRecords, context: BuildContext): LedgerUserContext['injuries'] {
    const settings = records.trainingSettings;
    const rows = settings === undefined ? undefined : (settings?.injuries ?? []);
    const base = collect(context, {
        key: 'training_settings',
        records: rows?.map((row, index) => ({ row, id: `injury-${String(index + 1).padStart(3, '0')}` })),
        toItem: ({ row, id }) => contextRecord(record(id, null, injuryValues(row))),
    });
    const ownState: LedgerState = settings?.injuries === undefined ? 'not_recorded' : 'measured';
    return { ...base, state: worstState([base.state, ownState]) };
}

function buildTravel(records: LedgerExportRecords, context: BuildContext): LedgerUserContext['travel'] {
    return collect(context, {
        key: 'plan_blocks',
        records: records.planBlocks,
        include: row => row.phase === 'travel',
        dateOf: row => row.endDate,
        bounds: { from: context.window.startDate },
        toItem: row => {
            const base = { source: SOURCE, observedOn: row.startDate };
            const values: Record<typeof TRAVEL_FIELDS[number], LedgerValue<unknown>> = {
                startDate: fact(row.startDate, base),
                endDate: fact(row.endDate, base),
                volumeScale: fact(row.volumeScale, base),
                intensityScale: fact(row.intensityScale, base),
            };
            // The block's own start date is its effective date.
            return contextRecord(record(row.id, row.startDate, values), fact(row.startDate, base));
        },
    });
}

function buildVenueRestrictions(records: LedgerExportRecords, context: BuildContext): LedgerUserContext['venueRestrictions'] {
    return collect(context, {
        key: 'fixed_activities',
        records: records.fixedActivities,
        include: row => row.availabilityContextOverride !== undefined,
        dateOf: row => row.date,
        bounds: { from: context.window.startDate },
        toItem: row => {
            const override = row.availabilityContextOverride;
            const base = { source: SOURCE, observedOn: row.date };
            const values: Record<typeof VENUE_RESTRICTION_FIELDS[number], LedgerValue<unknown>> = {
                date: fact(row.date, base),
                title: fact(row.title, base),
                environment: fact(override?.environment, { ...base, absent: 'not_applicable' }),
                equipment: fact(override?.equipment, { ...base, absent: 'not_applicable' }),
            };
            return contextRecord(record(row.id, row.date, values));
        },
    });
}

/** Merges collections read from different sources; the worst source state wins. */
function combine<T extends { id: string; observedOn: string | null }>(
    source: string,
    parts: readonly LedgerCollection<T>[],
): LedgerCollection<T> {
    return {
        state: worstState(parts.map(part => part.state)),
        source,
        items: byDateThenId(parts.flatMap(part => part.items)),
        droppedUndated: parts.reduce((sum, part) => sum + part.droppedUndated, 0),
    };
}

function buildAvailability(records: LedgerExportRecords, context: BuildContext): LedgerUserContext['availability'] {
    const fixed = collect(context, {
        key: 'fixed_activities',
        records: records.fixedActivities,
        dateOf: row => row.date,
        bounds: { from: context.window.startDate },
        toItem: row => {
            const base = { source: SOURCE, observedOn: row.date };
            const values: Record<typeof AVAILABILITY_FIELDS[number], LedgerValue<unknown>> = {
                date: fact(row.date, base),
                kind: fact('fixed_activity', base),
                startLocal: fact(row.startTime, base),
                endLocal: fact(undefined, { ...base, absent: 'not_applicable' }),
                durationMin: fact(row.durationMin, { ...base, unit: 'min' }),
                title: fact(row.title, base),
                fixed: fact(row.fixed, base),
                availabilityContextOverride: fact(row.availabilityContextOverride, { ...base, absent: 'not_applicable' }),
            };
            return contextRecord(record(`fixed-${row.id}`, row.date, values));
        },
    });
    const windows = collect(context, {
        key: 'schedule_windows',
        records: records.scheduleWindows,
        dateOf: row => row.date,
        bounds: { from: context.window.startDate },
        toItem: row => {
            const base = { source: SOURCE, observedOn: row.date };
            const na = { ...base, absent: 'not_applicable' as const };
            const values: Record<typeof AVAILABILITY_FIELDS[number], LedgerValue<unknown>> = {
                date: fact(row.date, base),
                kind: fact('schedule_window', base),
                startLocal: fact(row.startLocal, base),
                endLocal: fact(row.endLocal, base),
                durationMin: fact(undefined, na),
                title: fact(row.label, { ...base, absent: 'not_recorded' }),
                fixed: fact(undefined, na),
                availabilityContextOverride: fact(undefined, na),
            };
            return contextRecord(record(`window-${row.id}`, row.date, values));
        },
    });
    return combine('fixed_activities+schedule_windows', [fixed, windows]);
}

function goalValues(row: GoalInput): Record<typeof GOAL_FIELDS[number], LedgerValue<unknown>> {
    const base = { source: SOURCE };
    const optional = { ...base, absent: 'not_recorded' as const };
    return {
        title: fact(row.title, base),
        description: fact(row.description, optional),
        domain: fact(row.domain, base),
        status: fact(row.status, base),
        priority: rangedFact(row.priority, { min: 1, max: 5 }, base),
        performanceTarget: fact(row.performanceTarget, optional),
        targetMetric: fact(row.targetMetric, optional),
        targetValue: fact(row.targetValue, optional),
        targetUnit: fact(row.targetUnit, optional),
        targetDate: fact(row.targetDate, optional),
        targetOutcome: fact(row.targetOutcome, optional),
        eventCategory: fact(row.eventCategory, optional),
        eventLifecycle: fact(row.eventLifecycle, optional),
        timing: fact(row.timing, optional),
    };
}

function buildGoals(records: LedgerExportRecords, context: BuildContext): LedgerUserContext['goals'] {
    return collect(context, {
        key: 'goals',
        records: records.goals,
        include: row => row.status === 'active',
        toItem: row => contextRecord(record(
            row.id,
            isLocalDate(row.targetDate) ? row.targetDate : null,
            goalValues(row),
        )),
    });
}

function eventValues(
    title: string | undefined,
    startDate: string,
    endDate: string,
    lifecycle: LedgerValue<unknown>,
): Record<typeof USER_EVENT_FIELDS[number], LedgerValue<unknown>> {
    const base = { source: SOURCE, observedOn: startDate };
    return {
        title: fact(title, { ...base, absent: 'not_recorded' }),
        startDate: fact(startDate, base),
        endDate: fact(endDate, base),
        lifecycle,
    };
}

/**
 * Events are active goal-embedded target events (ADR-0041/0048-0050) that are not cancelled or
 * completed, plus intent-block date ranges. A goal event with no stored lifecycle is
 * `scheduled`, as the model documents.
 */
function buildEvents(records: LedgerExportRecords, context: BuildContext): LedgerUserContext['events'] {
    const forward = { from: context.window.startDate };
    const fromGoals = collect(context, {
        key: 'goals',
        records: records.goals,
        include: row => row.status === 'active' && Boolean(row.eventCategory) && !ENDED_LIFECYCLES.includes(row.eventLifecycle ?? ''),
        dateOf: row => row.targetDate,
        bounds: forward,
        toItem: row => {
            const date = row.targetDate as string;
            const lifecycle = fact(row.eventLifecycle ?? 'scheduled', { source: SOURCE, observedOn: date });
            return contextRecord(record(`goal-${row.id}`, date, eventValues(row.title, date, date, lifecycle)));
        },
    });
    const fromBlocks = collect(context, {
        key: 'intent_blocks',
        records: records.intentBlocks,
        dateOf: row => row.dateRange.endDate,
        bounds: forward,
        toItem: row => {
            const { startDate, endDate } = row.dateRange;
            const lifecycle = fact(undefined, { source: SOURCE, observedOn: startDate, absent: 'not_applicable' });
            return contextRecord(record(`block-${row.id}`, startDate, eventValues(row.title, startDate, endDate, lifecycle)));
        },
    });
    return combine('goals+intent_blocks', [fromGoals, fromBlocks]);
}

function buildConstraints(records: LedgerExportRecords, context: BuildContext): LedgerUserContext['constraints'] {
    return collect(context, {
        key: 'constraints',
        records: records.constraints,
        include: row => row.isActive,
        toItem: row => {
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
        },
    });
}

export function buildUserContext(records: LedgerExportRecords, context: BuildContext): LedgerUserContext {
    return {
        injuries: buildInjuries(records, context),
        equipment: buildEquipment(records, context),
        environment: buildEnvironment(records, context),
        guardrails: buildGuardrails(records, context),
        travel: buildTravel(records, context),
        venueRestrictions: buildVenueRestrictions(records, context),
        availability: buildAvailability(records, context),
        preferences: buildPreferences(records, context),
        goals: buildGoals(records, context),
        events: buildEvents(records, context),
        constraints: buildConstraints(records, context),
        trainingDislikes: notYetSupported<string[]>(SOURCE),
    };
}
