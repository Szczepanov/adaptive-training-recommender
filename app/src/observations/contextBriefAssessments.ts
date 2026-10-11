import type { UserGoal } from '../engine/models';
import type { AssessmentAttempt, MetricObservationHead, MetricObservationRevision } from './models';
import { buildAssessmentHistory } from './assessmentHistory';
import { isBenchmarkEligibleAttempt } from './assessmentEvidenceEligibility';
import { getAssessmentProtocolForExercise } from './exerciseAssessmentBridge';
import { PERFORMANCE_TEST_DEFINITIONS } from './performanceTestingCatalog';
import { PHYSICAL_CAPITAL_PROTOCOL_REVISIONS } from './physicalCapitalProtocols';
import { compareCodeUnits } from '../utils/canonicalJson';
import { getLocalDateString } from '../utils/localDate';

export const ASSESSMENT_BRIEF_MAX_BINDINGS = 12;
export const ASSESSMENT_BRIEF_MAX_ATTEMPTS = 100;

export interface AssessmentBriefBinding {
    protocolId: string;
    metricId: string;
    protocolRevision?: number;
}

export interface AssessmentBriefSource {
    binding: AssessmentBriefBinding;
    attempts: readonly AssessmentAttempt[];
    observations: readonly { head: MetricObservationHead; revision: MetricObservationRevision }[];
    unreadableCount: number;
    truncated: boolean;
    unavailable: boolean;
}

export interface AssessmentBriefInput {
    sources: readonly AssessmentBriefSource[];
    unsupportedCount: number;
    omittedCount: number;
    relevanceState: 'available' | 'incomplete' | 'unavailable';
    relevanceNotes?: readonly string[];
}

export function assessmentBriefBindingKey(binding: AssessmentBriefBinding): string {
    return `${binding.protocolId}|${binding.metricId}|${binding.protocolRevision ?? '*'}`;
}

export function assessmentBriefDefinition(binding: AssessmentBriefBinding) {
    const definition = PERFORMANCE_TEST_DEFINITIONS.find(d => d.protocol.id === binding.protocolId);
    if (!definition) return null;
    const protocol = binding.protocolRevision === undefined || binding.protocolRevision === definition.protocol.revision
        ? definition.protocol
        : PHYSICAL_CAPITAL_PROTOCOL_REVISIONS.find(p => p.id === binding.protocolId && p.revision === binding.protocolRevision);
    return protocol?.metricIds.includes(binding.metricId) ? { ...definition, protocol } : null;
}

export function assessmentBriefBindingsForGoals(goals: readonly UserGoal[]): { bindings: AssessmentBriefBinding[]; unsupportedCount: number } {
    const bindings = new Map<string, AssessmentBriefBinding>();
    let unsupportedCount = 0;
    for (const goal of goals) {
        const target = goal.performanceTarget;
        if (goal.status !== 'active' || target?.kind !== 'performance_metric') continue;
        let binding: AssessmentBriefBinding | null = null;
        if (target.subjectRef.kind === 'exercise') {
            const protocolId = getAssessmentProtocolForExercise(target.subjectRef.exerciseId, target.metricId);
            if (protocolId) binding = { protocolId, metricId: target.metricId };
        } else {
            const testId = target.subjectRef.performanceTestId;
            const definition = PERFORMANCE_TEST_DEFINITIONS.find(d => d.id === testId);
            if (definition?.protocol.metricIds.includes(target.metricId)) {
                binding = { protocolId: definition.protocol.id, protocolRevision: definition.protocol.revision, metricId: target.metricId };
            }
        }
        if (binding) bindings.set(assessmentBriefBindingKey(binding), binding);
        else unsupportedCount++;
    }
    return {
        bindings: [...bindings.values()].sort((a, b) => compareCodeUnits(assessmentBriefBindingKey(a), assessmentBriefBindingKey(b))),
        unsupportedCount,
    };
}

function token(value: string): string {
    const normalized = value.replace(/[\r\n\t]+/g, ' ').replace(/[<>`*|]/g, '').trim();
    return normalized.length > 96 ? `${normalized.slice(0, 47)}…${normalized.slice(-48)}` : normalized;
}

function signed(value: number, digits: number): string {
    return `${value >= 0 ? '+' : ''}${Number(value.toFixed(digits))}`;
}

/** Pure, observational projection. History owns active-series selection and progress semantics. */
export function renderAssessmentBrief(input: AssessmentBriefInput, asOfDate: string): string[] {
    const sources = [...input.sources].sort((a, b) => compareCodeUnits(assessmentBriefBindingKey(a.binding), assessmentBriefBindingKey(b.binding)));
    const lines = ['## Measured performance evidence', '',
        'Assessment benchmarks only; observational evidence, with no recommendation authority. Dates are Europe/Warsaw.'];
    if (input.relevanceState !== 'available') {
        lines.push(`Relevance ${input.relevanceState}: goal/block bindings could not be read completely; the section may omit relevant evidence.`);
    }
    lines.push(...(input.relevanceNotes ?? []).slice(0, 3));
    if (sources.length === 0 && input.relevanceState === 'available') {
        lines.push('No supported assessment binding in active typed goals or explicitly bound block objectives.');
    }
    for (const source of sources.slice(0, ASSESSMENT_BRIEF_MAX_BINDINGS)) {
        const definition = assessmentBriefDefinition(source.binding);
        const label = token(definition?.protocol.title ?? source.binding.protocolId);
        const identity = `${token(source.binding.protocolId)}${source.binding.protocolRevision === undefined ? '' : ` r${source.binding.protocolRevision}`}; ${token(source.binding.metricId)}`;
        if (!definition) {
            lines.push(`- ${label}: unsupported assessment binding (${identity}).`);
            continue;
        }
        if (source.unavailable) {
            lines.push(`- ${label}: unavailable (assessment source read failed); status insufficient_evidence; ${identity}.`);
            continue;
        }
        const attempts = source.attempts.filter(a => isBenchmarkEligibleAttempt(a));
        const attemptsById = new Map(attempts.map(a => [a.id, a]));
        const observations = source.observations.filter(({ head, revision: r }) => {
            const attempt = attemptsById.get(r.assessmentAttemptId);
            return attempt && r.validity === 'valid' && head.headRevision === r.revision
                && head.observationKey === r.observationKey && head.assessmentAttemptId === r.assessmentAttemptId
                && head.metricId === r.metricId && r.metricId === source.binding.metricId
                && r.protocolRef.id === source.binding.protocolId
                && r.protocolRef.id === attempt.protocolRef.id && r.protocolRef.revision === attempt.protocolRef.revision
                && (source.binding.protocolRevision === undefined || r.protocolRef.revision === source.binding.protocolRevision)
                && Number.isFinite(Date.parse(r.observedAt)) && getLocalDateString(new Date(r.observedAt)) <= asOfDate;
        });
        const metric = buildAssessmentHistory({ definitions: [definition], attempts, observations }).tests[0]?.metrics
            .find(m => m.metricId === source.binding.metricId);
        const series = metric?.activeSeries;
        const benchmark = series?.latest ?? series?.baseline;
        const incomplete = source.unreadableCount > 0 || source.truncated;
        const partial = incomplete
            ? `incomplete (${source.unreadableCount} unreadable record(s)${source.truncated ? '; attempt read truncated' : ''}); `
            : '';
        if (!benchmark || !series) {
            lines.push(`- ${label}: ${partial || 'missing — '}no eligible valid measured benchmark${incomplete ? ' in the read sample' : ''}; status insufficient_evidence; ${identity}.`);
            continue;
        }
        const value = `${benchmark.value} ${token(benchmark.unit)} (${benchmark.localDate})`;
        const provenance = `${token(source.binding.protocolId)} r${series.protocolRevision}; ${token(source.binding.metricId)}; series ${token(series.comparisonSeriesKey)}; source ${token(benchmark.revision.source)}${benchmark.revision.device ? `/${token(benchmark.revision.device.provider)}${benchmark.revision.device.deviceId ? `/${token(benchmark.revision.device.deviceId)}` : ''}` : ''}`;
        if (incomplete) {
            lines.push(`- ${label}: ${partial}measured benchmark in read sample ${value}; baseline/latest and comparison unavailable (incomplete read); status insufficient_evidence; ${provenance}.`);
            continue;
        }
        const baseline = series.baseline!;
        const comparison = series.progress.absoluteChange === undefined
            ? 'no comparable repeat yet'
            : `comparable raw change ${signed(series.progress.absoluteChange, 2)} ${token(benchmark.unit)}${series.progress.percentChange === undefined ? '' : ` (${signed(series.progress.percentChange, 1)}%)`}`;
        const incompatible = metric.otherSeries.filter(s => s.baseline !== null).length;
        lines.push(`- ${label}: measured benchmark ${value}; baseline ${baseline.value} ${token(baseline.unit)} (${baseline.localDate}); ${comparison}; status ${series.progress.status}; ${provenance}${incompatible ? `; ${incompatible} other non-comparable series (no cross-series delta)` : ''}.`);
    }
    const omitted = input.omittedCount + Math.max(0, sources.length - ASSESSMENT_BRIEF_MAX_BINDINGS);
    if (omitted) lines.push(`- ${omitted} relevant binding(s) omitted from this bounded section.`);
    if (input.unsupportedCount) lines.push(`- ${input.unsupportedCount} explicit target/binding(s) unsupported for measured assessment evidence; no profile estimate is promoted to a measurement.`);
    return lines;
}
