import { addDaysToLocalDateString } from '../../../utils/localDate.ts';
import { text } from '../markdownText.ts';
import type {
    ActivityCollection, ContextRecord, DerivedMetric, LedgerCollection, LedgerExport, LedgerRecord,
    LedgerValue, SourceState,
} from '../schema.ts';
import { PLACEMENT_FORWARD_DAYS } from '../window.ts';
import {
    collapsedLine,
    dominantSource,
    entryLines,
    type FieldEntry,
    formatNumber,
    formatValue,
    groupLabel,
    missingLine,
} from './compactLines.ts';
import { derivedMetricLines } from './derivedLines.ts';
import { flagsSection } from './flagLines.ts';
import {
    collectionOf,
    contextDelta,
    filterDelta,
    isCurrentFormat,
    morningKeptRevisionIds,
    type PreviousContext,
    unchangedLines,
    userContextCheckpoint,
    userContextStates,
} from './previousContext.ts';
import { renderTodaySections } from './todaySections.ts';

export { flagsSection };

export interface CompactRenderOptions {
    previousContext?: PreviousContext;
}

/**
 * Phase 4 refresh export: the `planning` export is the one used to start a new chat, so it
 * never abbreviates user context against a chat checkpoint. A new chat has seen nothing.
 */
export function purposeAlwaysRendersFullContext(purpose: LedgerExport['purpose']): boolean {
    return purpose === 'planning';
}

/** Ids already rendered by an earlier section; later sections skip them. */
export type SkipIds = ReadonlySet<string>;
const NO_SKIP: SkipIds = new Set();
const NO_BASELINED: ReadonlySet<'recovery' | 'checkins'> = new Set();
const NO_FIELDS: ReadonlySet<string> = new Set();

interface RecordRenderOptions {
    stripUnsupportedMeta?: boolean;
    omitPlanRevisionHeaderFields?: boolean;
}

function isDefaultUnsupportedMeta(key: string, value: LedgerValue<unknown>): boolean {
    return (key === 'since' || key === 'revisions')
        && (value.value === null || value.value === undefined)
        && value.state === 'not_yet_supported'
        && value.source === 'ledger';
}

function recordEntries(row: LedgerRecord, stripUnsupportedMeta = false): FieldEntry[] {
    const entries: FieldEntry[] = Object.entries(row.fields);
    if ('since' in row && 'revisions' in row) {
        const context = row as ContextRecord;
        entries.push(['since', context.since], ['revisions', context.revisions]);
    }
    return stripUnsupportedMeta
        ? entries.filter(([key, value]) => !isDefaultUnsupportedMeta(key, value))
        : entries;
}

function isRedundantHeaderField(
    key: string,
    value: LedgerValue<unknown>,
    row: LedgerRecord,
    group: string | undefined,
    options?: RecordRenderOptions,
): boolean {
    if (value.state !== 'measured' || value.source !== group) return false;
    if (key === 'date' && row.observedOn && value.value === row.observedOn) return true;
    if (options?.omitPlanRevisionHeaderFields && (key === 'planId' || key === 'revision')) {
        const planId = row.fields.planId;
        const revision = row.fields.revision;
        return planId?.state === 'measured' && planId.source === group
            && revision?.state === 'measured' && revision.source === group
            && row.id === `${planId.value}@${revision.value}`;
    }
    return false;
}

function recordLines(row: LedgerRecord, group: string | undefined, options?: RecordRenderOptions): string[] {
    const entries = recordEntries(row, options?.stripUnsupportedMeta);
    const collapsed = collapsedLine(row.id, entries, group, row.observedOn);
    if (collapsed) return [collapsed];
    const visible = entries.filter(([key, value]) => !isRedundantHeaderField(key, value, row, group, options));
    const date = row.observedOn ? ` (${text(row.observedOn)})` : '';
    return [`#### ${text(row.id)}${date}`, ...entryLines(visible, group)];
}

const fieldSourceOf = (rows: LedgerCollection<LedgerRecord>) => dominantSource(rows.items.flatMap(row => Object.entries(row.fields)));

function isActivityCollection<T extends LedgerRecord>(rows: LedgerCollection<T>): rows is ActivityCollection<T> {
    return 'truncated' in rows && 'totalInWindow' in rows;
}

function isEmptyMeasuredCollection(rows: LedgerCollection<LedgerRecord>): boolean {
    return rows.items.length === 0
        && rows.state === 'measured'
        && rows.droppedUndated === 0
        && (rows.droppedOutOfWindow ?? 0) === 0
        && !(isActivityCollection(rows) && rows.truncated);
}

function renderCollection<T extends LedgerRecord>(
    name: string,
    rows: LedgerCollection<T>,
    skipIds: SkipIds,
    skipped: string,
    renderBody: (items: T[], group: string | undefined) => string[],
    skippedLine?: string,
): string[] {
    const items = rows.items.filter(row => !skipIds.has(row.id));
    const group = fieldSourceOf(rows);
    const dropped = [
        rows.droppedUndated > 0 ? `droppedUndated: ${rows.droppedUndated}` : '',
        (rows.droppedOutOfWindow ?? 0) > 0 ? `${text(name)} outside window: ${rows.droppedOutOfWindow}` : '',
    ].filter(Boolean);
    const truncation = isActivityCollection(rows)
        ? [`truncated: ${rows.truncated}; totalInWindow: ${rows.totalInWindow}; exported: ${rows.items.length}`]
        : [];
    if (!rows.items.length) {
        const source = rows.state === 'measured' ? '' : ` (${text(rows.source)})`;
        return [`${[`${text(name)}: ${text(rows.state)}, no rows`, ...dropped, ...truncation].join(', ')}${source}`, ''];
    }
    const meta = [rows.state === 'measured' ? '' : `state: ${text(rows.state)}`, ...dropped, ...truncation].filter(Boolean);
    if (!items.length) return [[skippedLine ?? `${text(name)}: ${rows.items.length} ${skipped}`, ...meta].join('; '), ''];
    return [`### ${text(name)} (${groupLabel(rows.source, group)})`, ...meta, ...renderBody(items, group), ''];
}

/** `skipped` names where skipped rows are: `shown above` for rows a Today section printed,
 * `unchanged (listed above)` for user-context rows named on the `unchanged since` line. */
export function collectionLines(
    name: string, rows: LedgerCollection<LedgerRecord>, skipIds: SkipIds = NO_SKIP, skipped = 'shown above',
    options?: RecordRenderOptions,
): string[] {
    return renderCollection(name, rows, skipIds, skipped,
        (items, group) => items.flatMap(row => recordLines(row, group, options)));
}

function sourceSection(sources: SourceState[]): string[] {
    const open = sources.filter(source => source.state !== 'measured');
    const body = open.length
        ? open.map(source => [
            `${text(source.source)}: ${text(source.state)}`,
            source.newestObservedOn ? `newestObservedOn ${text(source.newestObservedOn)}` : '',
            source.reason ? `reason ${text(source.reason)}` : '',
        ].filter(Boolean).join('; '))
        : ['sources: all measured'];
    return ['## Sources', ...body, ''];
}

const isPresentField = (leaf: LedgerValue<unknown> | undefined): leaf is LedgerValue<unknown> =>
    leaf !== undefined && leaf.value !== null && leaf.value !== undefined;

function finiteNumber(leaf: LedgerValue<unknown> | undefined): number | null {
    return isPresentField(leaf) && typeof leaf.value === 'number' && Number.isFinite(leaf.value) ? leaf.value : null;
}

const RECOVERY_CONSUMED_FIELDS: ReadonlySet<string> = new Set([
    'sleepScore', 'sleepDurationSec', 'restingHr', 'hrvOvernightAvg', 'hrvStatus',
    'respirationAvg', 'bodyBatteryWake', 'totalSteps', 'stressAvg',
]);

interface CompactRecoveryRow {
    line: string;
    missing: string | null;
}

function asCompactRecoveryRow(row: LedgerRecord, group: string | undefined): CompactRecoveryRow | null {
    if (!row.observedOn) return null;
    const yesterday = addDaysToLocalDateString(row.observedOn, -1);
    const entries = recordEntries(row);
    for (const [key, val] of entries) {
        if (!isPresentField(val)) continue;
        if (val.state !== 'measured' || val.source !== group) return null;
        if (val.observedOn !== undefined && val.observedOn !== null
            && val.observedOn !== row.observedOn
            && !(key === 'totalSteps' && val.observedOn === yesterday)) {
            return null;
        }
    }

    const {
        sleepScore, sleepDurationSec, restingHr, hrvOvernightAvg, hrvStatus,
        respirationAvg, bodyBatteryWake, totalSteps, stressAvg,
    } = row.fields;
    const parts: string[] = [];

    const score = finiteNumber(sleepScore);
    const durationSec = finiteNumber(sleepDurationSec);
    if (score !== null) {
        const hours = durationSec !== null ? ` (${formatNumber(durationSec / 3600)}h)` : '';
        parts.push(`sleep ${formatNumber(score)}${hours}`);
    } else if (durationSec !== null) {
        parts.push(`sleep ${formatNumber(durationSec / 3600)}h`);
    }
    const rhr = finiteNumber(restingHr);
    if (rhr !== null) parts.push(`rhr ${formatNumber(rhr)} bpm`);
    const hrv = finiteNumber(hrvOvernightAvg);
    if (hrv !== null) {
        const status = isPresentField(hrvStatus) ? ` (${text(hrvStatus.value)})` : '';
        parts.push(`hrv ${formatNumber(hrv)} ms${status}`);
    } else if (isPresentField(hrvStatus)) {
        parts.push(`hrvStatus ${text(hrvStatus.value)}`);
    }
    const resp = finiteNumber(respirationAvg);
    if (resp !== null) parts.push(`resp ${formatNumber(resp)}`);
    const bb = finiteNumber(bodyBatteryWake);
    if (bb !== null) parts.push(`bb ${formatNumber(bb)}`);
    const steps = finiteNumber(totalSteps);
    if (steps !== null) {
        const dMinus1 = totalSteps.observedOn === yesterday ? ' (D-1)' : '';
        parts.push(`steps ${formatNumber(steps)}${dMinus1}`);
    }
    const stress = finiteNumber(stressAvg);
    if (stress !== null) parts.push(`stress ${formatNumber(stress)}`);

    for (const [key, val] of entries) {
        if (!RECOVERY_CONSUMED_FIELDS.has(key) && isPresentField(val)) {
            parts.push(`${text(key)} ${formatValue(val.value)}${val.unit ? ` ${text(val.unit)}` : ''}`);
        }
    }
    if (!parts.length) return null;

    const idNote = row.id !== `recovery-${row.observedOn}` ? ` (${text(row.id)})` : '';
    const missing = missingLine(entries, group);
    return {
        line: `${text(row.observedOn)}${idNote}: ${parts.join(', ')}`,
        missing: missing ? missing.slice('missing: '.length) : null,
    };
}

function recoveryFactsLines(rows: LedgerCollection<LedgerRecord>, skipIds: SkipIds): string[] {
    return renderCollection('recovery', rows, skipIds, 'shown above', (items, group) => {
        const compact: CompactRecoveryRow[] = [];
        const rest: LedgerRecord[] = [];
        for (const row of items) {
            const entry = asCompactRecoveryRow(row, group);
            if (entry) compact.push(entry);
            else rest.push(row);
        }

        const missingSummaries = compact.map(entry => entry.missing).filter((m): m is string => m !== null);
        const distinctMissing = new Set(missingSummaries);
        const sharedMissing = compact.length > 0 && distinctMissing.size === 1 && missingSummaries.length === compact.length
            ? missingSummaries[0]
            : null;

        const compactLines = compact.flatMap(entry => (
            sharedMissing === null && entry.missing ? [entry.line, `missing: ${entry.missing}`] : [entry.line]
        ));
        if (sharedMissing) compactLines.push(`recovery missing: ${sharedMissing}`);
        return [...compactLines, ...rest.flatMap(row => recordLines(row, group))];
    });
}

export function factsSection(ledger: LedgerExport, skipIds: SkipIds = NO_SKIP): string[] {
    const emptyMeasured: string[] = [];
    const lines: string[] = [];
    for (const [name, rows] of Object.entries(ledger.facts)) {
        if (isEmptyMeasuredCollection(rows)) emptyMeasured.push(name);
        else if (name === 'recovery') lines.push(...recoveryFactsLines(rows, skipIds));
        else lines.push(...collectionLines(name, rows, skipIds));
    }
    if (emptyMeasured.length) lines.push(`no rows (measured): ${emptyMeasured.map(text).join(', ')}`, '');
    return ['## Facts', ...lines];
}

function isNotYetSupportedDerived(metric: DerivedMetric): boolean {
    return metric.metrics === undefined
        && (metric.value.value === null || metric.value.value === undefined)
        && metric.value.state === 'not_yet_supported'
        && metric.inputs.length === 0;
}

export function derivedSection(
    ledger: LedgerExport,
    baselinedCollections: ReadonlySet<'recovery' | 'checkins'> = NO_BASELINED,
    baselinedFields: ReadonlySet<string> = NO_FIELDS,
): string[] {
    if (!ledger.derived.length) return ['## Derived', 'derived: none', ''];
    const unsupported = ledger.derived.filter(isNotYetSupportedDerived);
    const rendered = ledger.derived
        .filter(metric => !isNotYetSupportedDerived(metric))
        .flatMap(metric => derivedMetricLines(metric, baselinedCollections, baselinedFields));
    if (unsupported.length) rendered.push(`not_yet_supported: ${unsupported.map(metric => text(metric.id)).join(', ')}`);
    return ['## Derived', ...rendered, ''];
}

const MODALITY_FIELDS: readonly (readonly [string, string])[] = [
    ['preferredModalities', 'preferred'],
    ['deprioritizedModalities', 'deprioritized'],
    ['avoidedModalities', 'avoided'],
    ['unavailableModalities', 'unavailable'],
];
const MODALITY_LABELS = new Map(MODALITY_FIELDS);

function isStringArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.every(item => typeof item === 'string');
}

function booleanSingletonBody(name: 'equipment' | 'guardrails', entries: readonly FieldEntry[], group: string | undefined): string[] | null {
    const present = entries.filter(([, value]) => value.value !== null && value.value !== undefined);
    if (!present.length) return null;
    const allMeasuredBooleans = present.every(([key, value]) =>
        key !== 'since' && key !== 'revisions'
        && value.state === 'measured' && value.source === group && typeof value.value === 'boolean');
    if (!allMeasuredBooleans) return null;
    const missing = missingLine(entries, group);
    if (name === 'equipment') {
        const yes = present.filter(([, v]) => v.value === true).map(([k]) => text(k));
        const no = present.filter(([, v]) => v.value === false).map(([k]) => text(k));
        const summary = [yes.length ? `yes: ${yes.join(', ')}` : '', no.length ? `no: ${no.join(', ')}` : ''].filter(Boolean).join(' · ');
        return [summary, ...(missing ? [missing] : [])];
    }
    const active = present.filter(([, v]) => v.value === true).map(([k]) => text(k));
    const inactiveCount = present.length - active.length;
    const line = active.length === 0
        ? 'none active'
        : inactiveCount > 0 ? `active: ${active.join(', ')} (others false)` : `active: ${active.join(', ')}`;
    return [line, ...(missing ? [missing] : [])];
}

const ENVIRONMENT_COMPACT_FIELDS: ReadonlySet<string> = new Set([
    'defaultEnvironment',
    'weekdayMaxMinutes',
    'weekendMaxMinutes',
]);

function environmentBody(entries: readonly FieldEntry[], group: string | undefined): string[] | null {
    const present = entries.filter(([, value]) => isPresentField(value));
    if (!present.length) return null;
    const eligible = present.every(([key, value]) =>
        ENVIRONMENT_COMPACT_FIELDS.has(key) && value.state === 'measured' && value.source === group);
    if (!eligible) return null;

    const byKey = new Map(present);
    const defaultEnv = byKey.get('defaultEnvironment');
    const weekday = byKey.get('weekdayMaxMinutes');
    const weekend = byKey.get('weekendMaxMinutes');
    const maxParts = [
        weekday ? `${formatValue(weekday.value)} min weekday` : '',
        weekend ? `${formatValue(weekend.value)} min weekend` : '',
    ].filter(Boolean);
    const summary = [
        defaultEnv ? `default: ${formatValue(defaultEnv.value)}` : '',
        maxParts.length ? `max: ${maxParts.join(', ')}` : '',
    ].filter(Boolean).join(' · ');
    const missing = missingLine(entries, group);
    return [summary, ...(missing ? [missing] : [])];
}

const SCALAR_PREFERENCE_FIELDS: ReadonlySet<string> = new Set([
    'preferredRecoveryStyle',
    'preferredTimeOfDay',
    'defaultWeekdayTimeMin',
    'defaultWeekendTimeMin',
]);

function preferencesBody(entries: readonly FieldEntry[], group: string | undefined): string[] | null {
    const folded = new Set<string>();
    const byKey = new Map<string, LedgerValue<unknown>>();
    const nonEmpty: string[] = [];
    const emptyLabels: string[] = [];
    let hasModalities = false;

    for (const [key, value] of entries) {
        const label = MODALITY_LABELS.get(key);
        if (label && value.state === 'measured' && value.source === group && isStringArray(value.value)) {
            folded.add(key);
            hasModalities = true;
            if (value.value.length) nonEmpty.push(`${label}: ${value.value.map(item => text(item)).join(', ')}`);
            else emptyLabels.push(label);
            continue;
        }
        if (SCALAR_PREFERENCE_FIELDS.has(key) && isPresentField(value) && value.state === 'measured' && value.source === group) {
            folded.add(key);
            byKey.set(key, value);
        }
    }
    if (!folded.size) return null;

    const recovery = byKey.get('preferredRecoveryStyle');
    const timeOfDay = byKey.get('preferredTimeOfDay');
    const weekday = byKey.get('defaultWeekdayTimeMin');
    const weekend = byKey.get('defaultWeekendTimeMin');
    const defaultTimeParts = [
        weekday ? `${formatValue(weekday.value)} min weekday` : '',
        weekend ? `${formatValue(weekend.value)} min weekend` : '',
    ].filter(Boolean);
    const scalarLine = [
        recovery ? `recovery: ${formatValue(recovery.value)}` : '',
        timeOfDay ? `timeOfDay: ${formatValue(timeOfDay.value)}` : '',
        defaultTimeParts.length ? `defaultTime: ${defaultTimeParts.join(', ')}` : '',
    ].filter(Boolean).join(' · ');

    const restPresent = entries
        .filter(([key, value]) => !folded.has(key) && isPresentField(value));
    const presentLines = entryLines(restPresent, group);
    const main = nonEmpty.join(' · ');
    const noneNote = emptyLabels.length ? `none ${emptyLabels.join('/')}` : '';
    const modalitiesLine = !hasModalities ? null
        : main && noneNote ? `modalities: ${main} (${noneNote})`
            : main ? `modalities: ${main}`
                : `modalities: ${noneNote}`;
    const missing = missingLine(entries, group);
    return [
        ...(scalarLine ? [scalarLine] : []),
        ...presentLines,
        ...(modalitiesLine ? [modalitiesLine] : []),
        ...(missing ? [missing] : []),
    ];
}

function singletonLines(name: string, row: ContextRecord, stripUnsupportedMeta: boolean): string[] {
    const entries = recordEntries(row, stripUnsupportedMeta);
    const group = dominantSource(Object.entries(row.fields));
    const collapsed = collapsedLine(name, entries, group);
    // The heading names the group source even when the record collapses (source per group).
    const heading = `### ${text(name)} (${groupLabel(undefined, group)})`;
    if (collapsed) return [heading, collapsed];
    if (name === 'equipment' || name === 'guardrails') {
        const compact = booleanSingletonBody(name, entries, group);
        if (compact) return [heading, ...compact];
    }
    if (name === 'environment') {
        const compact = environmentBody(entries, group);
        if (compact) return [heading, ...compact];
    }
    if (name === 'preferences') {
        const compact = preferencesBody(entries, group);
        if (compact) return [heading, ...compact];
    }
    return [heading, ...entryLines(entries, group)];
}

const codeUnitCompare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

interface CompactWindow {
    date: string;
    start: string;
    end: string;
    missing: string | null;
}

const STANDARD_WINDOW_KEYS: ReadonlySet<string> = new Set(['date', 'kind', 'startLocal', 'endLocal']);

function asCompactScheduleWindow(row: ContextRecord, group: string | undefined, stripUnsupportedMeta: boolean): CompactWindow | null {
    if (!row.observedOn) return null;
    const { date, kind, startLocal, endLocal } = row.fields;
    if (kind?.state !== 'measured' || kind.source !== group || kind.value !== 'schedule_window') return null;
    if (startLocal?.state !== 'measured' || startLocal.source !== group || typeof startLocal.value !== 'string' || !startLocal.value) return null;
    if (endLocal?.state !== 'measured' || endLocal.source !== group || typeof endLocal.value !== 'string' || !endLocal.value) return null;
    if (date && (date.state !== 'measured' || date.source !== group || date.value !== row.observedOn)) return null;
    const entries = recordEntries(row, stripUnsupportedMeta);
    const hasExtraValue = entries.some(([key, value]) => !STANDARD_WINDOW_KEYS.has(key) && value.value !== null && value.value !== undefined);
    if (hasExtraValue) return null;
    const missing = missingLine(entries, group);
    return {
        date: row.observedOn,
        start: startLocal.value,
        end: endLocal.value,
        missing: missing ? missing.slice('missing: '.length) : null,
    };
}

function availabilityLines(rows: LedgerCollection<ContextRecord>, skipIds: SkipIds, stripUnsupportedMeta: boolean): string[] {
    return renderCollection('availability', rows, skipIds, 'unchanged (listed above)', (items, group) => {
        const compact: CompactWindow[] = [];
        const rest: ContextRecord[] = [];
        for (const row of items) {
            const win = asCompactScheduleWindow(row, group, stripUnsupportedMeta);
            if (win) compact.push(win);
            else rest.push(row);
        }

        const byDate = new Map<string, CompactWindow[]>();
        const missingGroups = new Map<string, CompactWindow[]>();
        for (const win of compact) {
            byDate.set(win.date, [...(byDate.get(win.date) ?? []), win]);
            if (win.missing) missingGroups.set(win.missing, [...(missingGroups.get(win.missing) ?? []), win]);
        }

        interface WindowRun {
            startDate: string;
            endDate: string;
            slots: string;
        }
        const runs: WindowRun[] = [];
        for (const date of [...byDate.keys()].sort(codeUnitCompare)) {
            const windows = byDate.get(date)!.sort((a, b) => codeUnitCompare(a.start, b.start) || codeUnitCompare(a.end, b.end));
            const slots = windows.map(win => `${text(win.start)}–${text(win.end)}`).join(', ');
            const last = runs[runs.length - 1];
            if (last && last.slots === slots && addDaysToLocalDateString(last.endDate, 1) === date) {
                last.endDate = date;
            } else {
                runs.push({ startDate: date, endDate: date, slots });
            }
        }
        const compactLines = runs.map(run => (
            run.startDate === run.endDate
                ? `${text(run.startDate)}: ${run.slots}`
                : `${text(run.startDate)}…${text(run.endDate)}: ${run.slots}`
        ));
        const [[onlySummary, onlyWindows]] = missingGroups.size === 1 ? [...missingGroups] : [['', []]];
        if (missingGroups.size === 1 && onlyWindows.length === compact.length) {
            compactLines.push(`schedule_window missing: ${onlySummary}`);
        } else if (missingGroups.size >= 1) {
            const datesPerSummary = new Map<string, number>();
            for (const wins of missingGroups.values()) {
                for (const date of new Set(wins.map(w => w.date))) {
                    datesPerSummary.set(date, (datesPerSummary.get(date) ?? 0) + 1);
                }
            }
            const conflictingDates = new Set(
                [...datesPerSummary].filter(([, count]) => count > 1).map(([date]) => date),
            );
            for (const [summary, wins] of missingGroups) {
                const labels = [...new Set(wins.map(w => (
                    conflictingDates.has(w.date) ? `${text(w.date)} ${text(w.start)}–${text(w.end)}` : text(w.date)
                )))].sort(codeUnitCompare);
                compactLines.push(`schedule_window missing (${labels.join(', ')}): ${summary}`);
            }
        }
        return [...compactLines, ...rest.flatMap(row => recordLines(row, group, { stripUnsupportedMeta }))];
    });
}

const CONSTRAINT_COMPACT_KEYS: ReadonlySet<string> = new Set(['label', 'value', 'severity', 'isActive', 'category', 'description']);

function compactConstraintLines(row: ContextRecord, group: string | undefined, stripUnsupportedMeta: boolean): string[] | null {
    const entries = recordEntries(row, stripUnsupportedMeta);
    const { label, value, severity, isActive, category, description } = row.fields;
    if (![label, value, severity, isActive, category].every(f => f?.state === 'measured' && f.source === group && f.value !== null && f.value !== undefined)) {
        return null;
    }
    if (isActive.value !== true) return null;
    if (description && description.value !== null && description.value !== undefined
        && (description.state !== 'measured' || description.source !== group)) {
        return null;
    }
    const hasUnexpectedPresent = entries.some(([key, val]) => !CONSTRAINT_COMPACT_KEYS.has(key) && val.value !== null && val.value !== undefined);
    if (hasUnexpectedPresent) return null;
    const descSuffix = description?.value !== null && description?.value !== undefined && description.value !== label.value
        ? `; ${formatValue(description.value)}`
        : '';
    const line = `${text(row.id)}: ${formatValue(value.value)} [${text(severity.value)}, ${text(category.value)}] — ${formatValue(label.value)}${descSuffix}`;
    const missing = missingLine(entries, group);
    return missing ? [line, missing] : [line];
}

type EquipmentField = keyof LedgerExport['userContext']['equipment']['fields'];

const LEGACY_EQUIPMENT_CONSTRAINT_TO_FIELD: Readonly<Record<string, EquipmentField>> = {
    has_free_weights: 'free_weights',
    has_pull_up_bar: 'pullup_bar',
    has_stationary_bike: 'indoor_bike',
    has_indoor_bike: 'indoor_bike',
    has_treadmill: 'treadmill',
    has_outdoor_bike: 'outdoor_bike',
    has_swim_access: 'swim_access',
    no_cable_machine: 'cable_machine',
    has_cable_machine: 'cable_machine',
};

function isSupersededLegacyEquipmentConstraint(
    row: ContextRecord,
    equipment: LedgerExport['userContext']['equipment'],
): boolean {
    if (!(row.id in LEGACY_EQUIPMENT_CONSTRAINT_TO_FIELD)) return false;
    const mappedField = LEGACY_EQUIPMENT_CONSTRAINT_TO_FIELD[row.id];
    const category = row.fields.category;
    if (category?.state !== 'measured' || category.value !== 'equipment') return false;
    const eqField = equipment.fields[mappedField];
    return eqField?.state === 'measured' && typeof eqField.value === 'boolean';
}

function constraintsLines(
    rows: LedgerCollection<ContextRecord>,
    skipIds: SkipIds,
    stripUnsupportedMeta: boolean,
    equipment: LedgerExport['userContext']['equipment'],
): string[] {
    const nonSkipped = rows.items.filter(row => !skipIds.has(row.id));
    const superseded = nonSkipped.filter(row => isSupersededLegacyEquipmentConstraint(row, equipment));
    const kept = nonSkipped.filter(row => !isSupersededLegacyEquipmentConstraint(row, equipment));
    const formatConstraint = (row: ContextRecord, group: string | undefined) =>
        compactConstraintLines(row, group, stripUnsupportedMeta) ?? recordLines(row, group, { stripUnsupportedMeta });

    if (!rows.items.length || !nonSkipped.length || !superseded.length) {
        return renderCollection('constraints', rows, skipIds, 'unchanged (listed above)', (items, group) =>
            items.flatMap(row => formatConstraint(row, group)));
    }

    const legacyNote = `${superseded.length} legacy equipment toggle${superseded.length === 1 ? '' : 's'} superseded by equipment above`;
    if (!kept.length) {
        const meta = [
            rows.state === 'measured' ? '' : `state: ${text(rows.state)}`,
            rows.droppedUndated > 0 ? `droppedUndated: ${rows.droppedUndated}` : '',
            (rows.droppedOutOfWindow ?? 0) > 0 ? `constraints outside window: ${rows.droppedOutOfWindow}` : '',
        ].filter(Boolean);
        const unchangedNote = skipIds.size > 0 ? `${skipIds.size} unchanged (listed above); ` : '';
        return [[`constraints: ${unchangedNote}${legacyNote}`, ...meta].join('; '), ''];
    }

    const combinedSkip = new Set([...skipIds, ...superseded.map(row => row.id)]);
    const note = `superseded by equipment above: ${superseded.length} legacy toggle${superseded.length === 1 ? '' : 's'}`;
    return renderCollection('constraints', rows, combinedSkip, 'unchanged (listed above)', (items, group) => [
        ...items.flatMap(row => formatConstraint(row, group)),
        note,
    ]);
}

interface CompactGoal {
    lines: string[];
    missing: string | null;
}

function asCompactGoal(row: ContextRecord, group: string | undefined, stripUnsupportedMeta: boolean): CompactGoal | null {
    const { title, domain, status, priority, targetDate, eventCategory, eventLifecycle } = row.fields;
    if (![title, domain, status, priority, targetDate].every(f => f?.state === 'measured' && f.source === group && f.value !== null && f.value !== undefined)) {
        return null;
    }
    if (status.value !== 'active') return null;
    if (row.observedOn !== null && row.observedOn !== targetDate.value) return null;

    const ec = eventCategory?.state === 'measured' && eventCategory.source === group && eventCategory.value !== null && eventCategory.value !== undefined
        ? formatValue(eventCategory.value) : '';
    const el = eventLifecycle?.state === 'measured' && eventLifecycle.source === group && eventLifecycle.value !== null && eventLifecycle.value !== undefined
        ? formatValue(eventLifecycle.value) : '';
    const tags = [`P${formatValue(priority.value)}`, ec, el, formatValue(domain.value)].filter(Boolean).join(', ');
    const head = `${text(row.id)} (${text(targetDate.value)}): ${formatValue(title.value)} [${tags}]`;

    const consumed = new Set(['title', 'domain', 'status', 'priority', 'targetDate',
        ...(ec ? ['eventCategory'] : []), ...(el ? ['eventLifecycle'] : [])]);
    const entries = recordEntries(row, stripUnsupportedMeta);
    const extraPresent = entries
        .filter(([key, val]) => !consumed.has(key) && val.value !== null && val.value !== undefined)
        .flatMap(([key, val]) => entryLines([[key, val]], group));
    const missing = missingLine(entries, group);
    return {
        lines: [head, ...extraPresent],
        missing: missing ? missing.slice('missing: '.length) : null,
    };
}

function goalsLines(rows: LedgerCollection<ContextRecord>, skipIds: SkipIds, stripUnsupportedMeta: boolean): string[] {
    return renderCollection('goals', rows, skipIds, 'unchanged (listed above)', (items, group) => {
        const compact: CompactGoal[] = [];
        const rest: ContextRecord[] = [];
        for (const row of items) {
            const goal = asCompactGoal(row, group, stripUnsupportedMeta);
            if (goal) compact.push(goal);
            else rest.push(row);
        }

        const missingSummaries = compact.map(goal => goal.missing).filter((m): m is string => m !== null);
        const distinctMissing = new Set(missingSummaries);
        const sharedMissing = distinctMissing.size === 1 && missingSummaries.length === compact.length
            ? missingSummaries[0]
            : null;

        const compactLines = compact.flatMap(goal => (
            sharedMissing === null && goal.missing ? [...goal.lines, `missing: ${goal.missing}`] : goal.lines
        ));
        if (sharedMissing) compactLines.push(`goals missing: ${sharedMissing}`);
        return [...compactLines, ...rest.flatMap(row => recordLines(row, group, { stripUnsupportedMeta }))];
    });
}

function metaMatches(a: LedgerValue<unknown>, b: LedgerValue<unknown>): boolean {
    return a.state === b.state && a.source === b.source && a.value === b.value;
}

function isDuplicateGoalEvent(goal: ContextRecord, event: ContextRecord, eventsGroup: string | undefined): boolean {
    const { title, startDate, endDate, lifecycle } = event.fields;
    if (![title, startDate, endDate, lifecycle].every(field => field?.state === 'measured' && field.source === eventsGroup)) {
        return false;
    }
    const goalTitle = goal.fields.title;
    const goalDate = goal.fields.targetDate;
    const goalLifecycle = goal.fields.eventLifecycle;
    if (goalTitle?.state !== 'measured' || goalTitle.value !== title.value) return false;
    if (goalDate?.state !== 'measured' || goalDate.value !== startDate.value || goalDate.value !== endDate.value) return false;
    if (event.observedOn !== goalDate.value) return false;
    if (goalLifecycle?.state !== 'measured' || goalLifecycle.value === null || lifecycle.value !== goalLifecycle.value) {
        return false;
    }
    return metaMatches(goal.since, event.since) && metaMatches(goal.revisions, event.revisions);
}

function eventsLines(
    rows: LedgerCollection<ContextRecord>,
    unchangedSkip: SkipIds,
    dedupedGoalEventIds: SkipIds,
    stripUnsupportedMeta: boolean,
): string[] {
    if (!dedupedGoalEventIds.size) {
        return collectionLines('events', rows, unchangedSkip, 'unchanged (listed above)', { stripUnsupportedMeta });
    }
    const combinedSkip = new Set([...unchangedSkip, ...dedupedGoalEventIds]);
    const summary = unchangedSkip.size > 0
        ? `${unchangedSkip.size} unchanged (listed above); ${dedupedGoalEventIds.size} shown in goals above`
        : `${dedupedGoalEventIds.size} shown in goals above`;
    return renderCollection(
        'events',
        rows,
        combinedSkip,
        summary,
        (items, group) => [
            `${dedupedGoalEventIds.size} goal event${dedupedGoalEventIds.size === 1 ? '' : 's'} shown in goals above`,
            ...items.flatMap(row => recordLines(row, group, { stripUnsupportedMeta })),
        ],
        `events: ${summary}`,
    );
}

function hasRecordDefaultUnsupportedMeta(row: ContextRecord): boolean {
    return isDefaultUnsupportedMeta('since', row.since) || isDefaultUnsupportedMeta('revisions', row.revisions);
}

/** A checkpoint of another (or no) format version means full context. */
export function userContextSection(ledger: LedgerExport, checkpoint?: PreviousContext): string[] {
    const previous = isCurrentFormat(checkpoint) ? checkpoint : undefined;
    const fullDelta = previous ? contextDelta(userContextCheckpoint(ledger), previous, userContextStates(ledger)) : null;
    const delta = fullDelta ? filterDelta(fullDelta, key => collectionOf(key) !== 'planRevisions') : null;
    const isUnchanged = (key: string) => delta?.unchangedKeys.has(key) ?? false;

    const renderedGoals = new Map(
        ledger.userContext.goals.items.filter(row => !isUnchanged(`goals/${row.id}`)).map(row => [row.id, row]),
    );
    const eventsGroup = fieldSourceOf(ledger.userContext.events);
    const dedupedGoalEventIds = new Set<string>();
    for (const event of ledger.userContext.events.items) {
        if (isUnchanged(`events/${event.id}`) || !event.id.startsWith('goal-')) continue;
        const goal = renderedGoals.get(event.id.slice('goal-'.length));
        if (goal && isDuplicateGoalEvent(goal, event, eventsGroup)) dedupedGoalEventIds.add(event.id);
    }

    const liftUnsupportedMeta = Object.entries(ledger.userContext).some(([name, context]) => {
        if ('items' in context) {
            return (context as LedgerCollection<ContextRecord>).items.some(row =>
                !isUnchanged(`${name}/${row.id}`)
                && !(name === 'events' && dedupedGoalEventIds.has(row.id))
                && hasRecordDefaultUnsupportedMeta(row));
        }
        if ('fields' in context) return !isUnchanged(name) && hasRecordDefaultUnsupportedMeta(context);
        return false;
    });

    const emptyMeasured: string[] = [];
    const lines: string[] = [];
    let trailingDislikes: string[] = [];

    for (const [name, context] of Object.entries(ledger.userContext)) {
        if ('items' in context) {
            const rows = context as LedgerCollection<ContextRecord>;
            if (isEmptyMeasuredCollection(rows)) {
                emptyMeasured.push(name);
                continue;
            }
            const skip = new Set(rows.items.filter(row => isUnchanged(`${name}/${row.id}`)).map(row => row.id));
            if (name === 'availability') lines.push(...availabilityLines(rows, skip, liftUnsupportedMeta));
            else if (name === 'events') lines.push(...eventsLines(rows, skip, dedupedGoalEventIds, liftUnsupportedMeta));
            else if (name === 'goals') lines.push(...goalsLines(rows, skip, liftUnsupportedMeta));
            else if (name === 'constraints') lines.push(...constraintsLines(rows, skip, liftUnsupportedMeta, ledger.userContext.equipment));
            else lines.push(...collectionLines(name, rows, skip, 'unchanged (listed above)', { stripUnsupportedMeta: liftUnsupportedMeta }));
            continue;
        }
        if (isUnchanged(name)) continue;
        if ('fields' in context) lines.push(...singletonLines(name, context, liftUnsupportedMeta));
        else trailingDislikes = entryLines([[name, context as LedgerValue<unknown>]]);
    }

    if (emptyMeasured.length) lines.push(`no rows (measured): ${emptyMeasured.map(text).join(', ')}`, '');
    lines.push(...trailingDislikes);

    const head = delta && previous ? unchangedLines(delta, previous) : [];
    const metaNote = liftUnsupportedMeta ? ['note: since, revisions are not_yet_supported (ledger) unless noted'] : [];
    return ['## User context', ...head, ...metaNote, ...lines, ''];
}

function planRevisionsLines(
    ledger: LedgerExport,
    skipIds: SkipIds,
    skippedLabel = 'shown above',
    unchangedNote?: string,
): string[] {
    const rows = ledger.coachingHistory.planRevisions;
    const options: RecordRenderOptions = { omitPlanRevisionHeaderFields: true };
    const keptIds = ledger.purpose === 'morning' ? morningKeptRevisionIds(ledger) : null;
    return renderCollection('planRevisions', rows, skipIds, skippedLabel, (items, group) => {
        const extra = unchangedNote ? [unchangedNote] : [];
        if (!keptIds) {
            return [...items.flatMap(row => recordLines(row, group, options)), ...extra];
        }

        const kept: LedgerRecord[] = [];
        const older: LedgerRecord[] = [];
        for (const row of items) {
            if (keptIds.has(row.id)) kept.push(row);
            else older.push(row);
        }

        const olderLines = older.length
            ? [`older revisions: ${older.length} omitted in morning export (use planning for full history)`]
            : [];

        return [...kept.flatMap(row => recordLines(row, group, options)), ...olderLines, ...extra];
    });
}

export function coachingHistorySection(
    ledger: LedgerExport,
    skipIds: SkipIds = NO_SKIP,
    checkpoint?: PreviousContext,
): string[] {
    const previous = ledger.purpose === 'morning' && isCurrentFormat(checkpoint) ? checkpoint : undefined;
    const revDelta = previous
        ? filterDelta(contextDelta(userContextCheckpoint(ledger), previous, userContextStates(ledger)), key => collectionOf(key) === 'planRevisions')
        : null;
    const revUnchangedIds = new Set(
        ledger.coachingHistory.planRevisions.items
            .filter(row => revDelta?.unchangedKeys.has(`planRevisions/${row.id}`))
            .map(row => row.id),
    );
    const revHead = revDelta && previous
        ? [
            ...revDelta.removed.map(key => `removed: ${text(key)}`),
            ...revDelta.unreadable.map(({ key, reason }) => `not readable now: ${text(key)} (${text(reason)})`),
        ]
        : [];
    const revSkippedLabel = previous && revUnchangedIds.size > 0
        ? `unchanged since ${text(previous.exportedOn)}`
        : 'shown above';
    const revUnchangedNote = previous && revUnchangedIds.size > 0
        ? `unchanged since ${text(previous.exportedOn)}: ${revUnchangedIds.size} revision${revUnchangedIds.size === 1 ? '' : 's'}`
        : undefined;

    const emptyMeasured: string[] = [];
    const lines: string[] = [];
    for (const [name, rows] of Object.entries(ledger.coachingHistory)) {
        if (isEmptyMeasuredCollection(rows)) emptyMeasured.push(name);
        else if (name === 'planRevisions') {
            const combinedSkip = new Set([...skipIds, ...revUnchangedIds]);
            lines.push(...planRevisionsLines(ledger, combinedSkip, revSkippedLabel, revUnchangedNote));
        } else lines.push(...collectionLines(name, rows, skipIds));
    }
    if (emptyMeasured.length) lines.push(`no rows (measured): ${emptyMeasured.map(text).join(', ')}`, '');
    return ['## Coaching history', ...revHead, ...lines];
}

function header(ledger: LedgerExport): string[] {
    return [
        `# Ledger update — ${text(ledger.asOfDate)} (${text(ledger.purpose)})`,
        `schema: ${text(ledger.schemaVersion)} · exportedAt ${text(ledger.exportedAt)}`,
        'states: measured unless noted; source shown per group',
        `window: ${text(ledger.window.startDate)}…${text(ledger.window.endDate)}`,
        ...(purposeAlwaysRendersFullContext(ledger.purpose)
            ? [`use: refresh export for starting a new chat — full user context, upcoming sessions for the next ${PLACEMENT_FORWARD_DAYS[ledger.purpose]} days`]
            : []),
        '',
    ];
}

/** Pure presentation of recorded ledger data, compact for pasting into a long-lived chat. */
export function renderLedgerExportCompact(ledger: LedgerExport, options?: CompactRenderOptions): string {
    const today = renderTodaySections(ledger);
    const consumed = today.consumedIds;
    const checkpoint = purposeAlwaysRendersFullContext(ledger.purpose) ? undefined : options?.previousContext;
    const lines = [
        ...header(ledger),
        ...today.lines,
        ...sourceSection(ledger.sources),
        ...flagsSection(ledger),
        ...factsSection(ledger, consumed),
        ...derivedSection(ledger, today.baselinedCollections, today.baselinedFields),
        ...userContextSection(ledger, checkpoint),
        ...coachingHistorySection(ledger, consumed, ledger.purpose === 'morning' ? checkpoint : undefined),
    ];
    if (ledger.legacyEngine !== null) lines.push('', '## Legacy engine (opt-in opinions)', text(ledger.legacyEngine));
    return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}
