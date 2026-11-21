import { CHECKIN_BASELINE_KEYS, deltaKeyOf, RECOVERY_BASELINE_KEYS } from '../baselineDeltas.ts';
import { text } from '../markdownText.ts';
import type { DerivedMetric, LedgerValue } from '../schema.ts';
import {
    type BaselineTripletKeys,
    CHECKIN_BASELINE_TRIPLETS,
    RECOVERY_BASELINE_TRIPLETS,
} from './baselineLines.ts';
import {
    entryLines,
    fieldProvenance,
    formatValue,
    groupLabel,
    missingLine,
    type FieldEntry,
} from './compactLines.ts';

interface DerivedTripletSpec extends BaselineTripletKeys {
    label: string;
    todayField: string;
}

const BIOMETRIC_DISPLAY_LABELS: Readonly<Record<string, string>> = {
    sleepScore: 'sleepScore',
    restingHr: 'restingHr',
    hrvOvernightAvg: 'hrv',
    respirationAvg: 'respiration',
};

const BIOMETRIC_TRIPLETS: readonly DerivedTripletSpec[] = Object.entries(RECOVERY_BASELINE_TRIPLETS).map(([todayField, spec]) => ({
    todayField,
    label: BIOMETRIC_DISPLAY_LABELS[todayField] ?? todayField,
    ...spec,
}));

const SUBJECTIVE_TRIPLETS: readonly DerivedTripletSpec[] = Object.entries(CHECKIN_BASELINE_TRIPLETS).map(([todayField, spec]) => ({
    todayField,
    label: todayField,
    ...spec,
}));

const RECOVERY_DELTAS: ReadonlySet<string> = new Set(Object.keys(RECOVERY_BASELINE_KEYS).map(deltaKeyOf));
const CHECKIN_DELTAS: ReadonlySet<string> = new Set(Object.keys(CHECKIN_BASELINE_KEYS).map(deltaKeyOf));
const NO_FIELDS: ReadonlySet<string> = new Set();

function isPresent<T>(value: LedgerValue<T> | undefined): value is LedgerValue<T> & { value: NonNullable<T> } {
    return value !== undefined && value.value !== null && value.value !== undefined;
}

function formatTriplet(
    spec: DerivedTripletSpec,
    metrics: Readonly<Record<string, LedgerValue<number>>>,
    group: string | undefined,
): string | null {
    const avg7d = metrics[spec.avg7d];
    const avg28d = metrics[spec.avg28d];
    const disp = metrics[spec.disp];
    const unitSource = [avg7d, avg28d, disp].find(isPresent);
    if (!unitSource) return null;

    const avgParts = [
        isPresent(avg7d) ? `7d ${formatValue(avg7d.value)}${fieldProvenance(avg7d, group)}` : '',
        isPresent(avg28d) ? `28d ${formatValue(avg28d.value)}${fieldProvenance(avg28d, group)}` : '',
    ].filter(Boolean).join(' · ');

    const dispText = isPresent(disp) ? `${spec.dispTag} ${formatValue(disp.value)}${fieldProvenance(disp, group)}` : '';
    const body = avgParts && dispText ? `${avgParts} (${dispText})` : avgParts || dispText;
    const unit = unitSource.unit ? ` ${text(unitSource.unit)}` : '';
    return `${text(spec.label)}: ${body}${unit}`;
}

function recordedDaysParts(
    metrics: Readonly<Record<string, LedgerValue<number>>>,
    group: string | undefined,
): string | null {
    const recent = metrics.recentRecordedDays;
    const long = metrics.longRecordedDays;
    const parts = [
        isPresent(recent) ? `7d ${formatValue(recent.value)}${fieldProvenance(recent, group)}` : '',
        isPresent(long) ? `28d ${formatValue(long.value)}${fieldProvenance(long, group)}` : '',
    ].filter(Boolean);
    return parts.length ? parts.join(', ') : null;
}

/** Compact presentation for one derived metric, deduplicating baselines & deltas already shown under Today. */
export function derivedMetricLines(
    metric: DerivedMetric,
    baselinedCollections: ReadonlySet<'recovery' | 'checkins'>,
    baselinedFields: ReadonlySet<string> = NO_FIELDS,
): string[] {
    const group = metric.value.source;
    const omitContainerValue = metric.metrics !== undefined && !isPresent(metric.value) && metric.value.state === 'not_applicable';
    const collectionKey = metric.id === 'biometric_baselines' ? 'recovery'
        : metric.id === 'subjective_baselines' ? 'checkins'
            : null;
    const todayRenderedCollection = collectionKey !== null && baselinedCollections.has(collectionKey);
    const dedupedDeltas = collectionKey === 'recovery' && todayRenderedCollection ? RECOVERY_DELTAS
        : collectionKey === 'checkins' && todayRenderedCollection ? CHECKIN_DELTAS
            : null;
    const metricEntries = Object.entries(metric.metrics ?? {}).filter(([key]) => !dedupedDeltas?.has(key));
    const filteredMetrics = Object.fromEntries(metricEntries);
    const allEntries: FieldEntry[] = [
        ...(omitContainerValue ? [] : [['value', metric.value] as FieldEntry]),
        ...metricEntries,
    ];

    const consumedKeys = new Set<string>();
    const groupedLines: string[] = [];
    if (metric.metrics && (metric.id === 'biometric_baselines' || metric.id === 'subjective_baselines')) {
        const triplets = metric.id === 'biometric_baselines' ? BIOMETRIC_TRIPLETS : SUBJECTIVE_TRIPLETS;
        for (const spec of triplets) {
            const keys = [spec.avg7d, spec.avg28d, spec.disp].filter(key => key in filteredMetrics);
            if (!keys.length) continue;
            keys.forEach(key => consumedKeys.add(key));
            const allTripletLeavesMissing = keys.every(key => !isPresent(filteredMetrics[key]));
            const coveredByToday = todayRenderedCollection && (baselinedFields.has(spec.todayField) || allTripletLeavesMissing);
            if (!coveredByToday) {
                const line = formatTriplet(spec, filteredMetrics, group);
                if (line) groupedLines.push(line);
            }
        }
        if (metric.id === 'subjective_baselines' && ('recentRecordedDays' in filteredMetrics || 'longRecordedDays' in filteredMetrics)) {
            if ('recentRecordedDays' in filteredMetrics) consumedKeys.add('recentRecordedDays');
            if ('longRecordedDays' in filteredMetrics) consumedKeys.add('longRecordedDays');
            if (!todayRenderedCollection || groupedLines.length > 0) {
                const parts = recordedDaysParts(filteredMetrics, group);
                if (parts) groupedLines.push(`recordedDays: ${parts}`);
            }
        }
    }

    const extraPresent = allEntries
        .filter(([key, value]) => !consumedKeys.has(key) && isPresent(value))
        .flatMap(([name, value]) => entryLines([[name, value]], group));
    const missing = missingLine(allEntries, group);

    if (metric.metrics && todayRenderedCollection && (omitContainerValue || isPresent(metric.value))
        && groupedLines.length === 0 && extraPresent.length === 0) {
        const days = metric.id === 'subjective_baselines' ? recordedDaysParts(filteredMetrics, group) : null;
        const daysSuffix = days ? ` (recordedDays: ${days})` : '';
        const missingSuffix = missing ? `; ${missing}` : '';
        return [`${text(metric.id)}: shown in Today above${daysSuffix}${missingSuffix}`];
    }

    const hasPresentValue = allEntries.some(([, value]) => isPresent(value));
    return [
        `### ${text(metric.id)}${hasPresentValue ? ` (${groupLabel(undefined, group)})` : ''}`,
        `definition: ${text(metric.definition)}`,
        `window: ${text(metric.window)}${metric.inputs.length ? `; inputs: ${metric.inputs.map(text).join(', ')}` : ''}`,
        ...groupedLines,
        ...extraPresent,
        ...(missing ? [missing] : []),
    ];
}
