import { SUBJECTIVE_BASELINE_METRICS } from '../../../derived/baselines/subjectiveBaseline.ts';
import { CHECKIN_BASELINE_KEYS, deltaKeyOf, RECOVERY_BASELINE_KEYS } from '../baselineDeltas.ts';
import { text } from '../markdownText.ts';
import type { DerivedMetric, LedgerValue } from '../schema.ts';
import {
    entryLines,
    fieldProvenance,
    formatValue,
    groupLabel,
    missingLine,
    type FieldEntry,
} from './compactLines.ts';

interface BaselineTripletSpec {
    label: string;
    avg7d: string;
    avg28d: string;
    disp: string;
    dispTag: string;
}

const BIOMETRIC_TRIPLETS: readonly BaselineTripletSpec[] = [
    { label: 'sleepScore', avg7d: 'sleepScore7dAvg', avg28d: 'sleepScore28dAvg', disp: 'sleepScore28dStdev', dispTag: 'sd' },
    { label: 'restingHr', avg7d: 'restingHr7dAvg', avg28d: 'restingHr28dAvg', disp: 'restingHr28dStdev', dispTag: 'sd' },
    { label: 'hrv', avg7d: 'hrv7dAvg', avg28d: 'hrv28dAvg', disp: 'hrv28dStdev', dispTag: 'sd' },
    { label: 'respiration', avg7d: 'respiration7dAvg', avg28d: 'respiration28dAvg', disp: 'respiration28dMad', dispTag: 'mad' },
];

const SUBJECTIVE_TRIPLETS: readonly BaselineTripletSpec[] = SUBJECTIVE_BASELINE_METRICS.map(metric => ({
    label: metric,
    avg7d: `${metric}_recentAvg`,
    avg28d: `${metric}_longAvg`,
    disp: `${metric}_variability`,
    dispTag: 'var',
}));

const RECOVERY_DELTAS: ReadonlySet<string> = new Set(Object.keys(RECOVERY_BASELINE_KEYS).map(deltaKeyOf));
const CHECKIN_DELTAS: ReadonlySet<string> = new Set(Object.keys(CHECKIN_BASELINE_KEYS).map(deltaKeyOf));

function isPresent<T>(value: LedgerValue<T> | undefined): value is LedgerValue<T> & { value: NonNullable<T> } {
    return value !== undefined && value.value !== null && value.value !== undefined;
}

function formatTriplet(
    spec: BaselineTripletSpec,
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

function formatRecordedDays(
    metrics: Readonly<Record<string, LedgerValue<number>>>,
    group: string | undefined,
): string | null {
    const recent = metrics.recentRecordedDays;
    const long = metrics.longRecordedDays;
    const parts = [
        isPresent(recent) ? `7d ${formatValue(recent.value)}${fieldProvenance(recent, group)}` : '',
        isPresent(long) ? `28d ${formatValue(long.value)}${fieldProvenance(long, group)}` : '',
    ].filter(Boolean);
    return parts.length ? `recordedDays: ${parts.join(', ')}` : null;
}

/** Compact presentation for one derived metric, deduplicating 28d deltas already shown under Today. */
export function derivedMetricLines(
    metric: DerivedMetric,
    baselinedCollections: ReadonlySet<'recovery' | 'checkins'>,
): string[] {
    const group = metric.value.source;
    const omitContainerValue = metric.metrics !== undefined && !isPresent(metric.value) && metric.value.state === 'not_applicable';
    const dedupedDeltas = metric.id === 'biometric_baselines' && baselinedCollections.has('recovery') ? RECOVERY_DELTAS
        : metric.id === 'subjective_baselines' && baselinedCollections.has('checkins') ? CHECKIN_DELTAS
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
            const line = formatTriplet(spec, filteredMetrics, group);
            if (line) groupedLines.push(line);
        }
        if (metric.id === 'subjective_baselines' && ('recentRecordedDays' in filteredMetrics || 'longRecordedDays' in filteredMetrics)) {
            if ('recentRecordedDays' in filteredMetrics) consumedKeys.add('recentRecordedDays');
            if ('longRecordedDays' in filteredMetrics) consumedKeys.add('longRecordedDays');
            const daysLine = formatRecordedDays(filteredMetrics, group);
            if (daysLine) groupedLines.push(daysLine);
        }
    }

    const extraPresent = allEntries
        .filter(([key, value]) => !consumedKeys.has(key) && isPresent(value))
        .flatMap(([name, value]) => entryLines([[name, value]], group));
    const missing = missingLine(allEntries, group);
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
