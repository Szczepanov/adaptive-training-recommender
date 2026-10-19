import { describe, expect, it } from 'vitest';
import type { UserGoal } from '../engine/models';
import type { AssessmentAttempt, MetricObservationHead, MetricObservationRevision } from './models';
import { BACK_SQUAT_1RM_PROTOCOL, BENCH_PRESS_1RM_PROTOCOL, BACK_SQUAT_FIXED_LOAD_VELOCITY_PROTOCOL, STANDING_BROAD_JUMP_PROTOCOL_V2 } from './physicalCapitalProtocols';
import {
    assessmentBriefBindingsForGoals,
    assessmentBriefBindingsForCompletedAttempts,
    deriveMeasuredBenchmarks,
    renderAssessmentBrief,
    selectSeriesBestRow,
    type AssessmentBriefInput,
    type AssessmentBriefSource,
} from './contextBriefAssessments';
import type { AssessmentHistorySeries } from './assessmentHistory';

const PROTOCOL = BACK_SQUAT_1RM_PROTOCOL;
const AS_OF = '2026-10-11';

function point(id: string, date: string, value: number, overrides: Partial<MetricObservationRevision> = {}) {
    const attempt: AssessmentAttempt = {
        id, protocolRef: { id: PROTOCOL.id, revision: PROTOCOL.revision },
        state: 'completed', purpose: id === 'baseline' ? 'baseline' : 'checkpoint', completedAt: date,
    };
    const revision: MetricObservationRevision = {
        observationKey: `${id}:strength_1rm_kg`, revision: 1, assessmentAttemptId: id,
        metricId: 'strength_1rm_kg', value, unit: 'kg', observedAt: date, source: 'manual',
        protocolRef: attempt.protocolRef, comparisonSeriesKey: 'setup-a',
        comparisonCanonicalizationVersion: 'ov-series-v1', validity: 'valid', context: {}, createdAt: date,
        ...overrides,
    };
    const head: MetricObservationHead = {
        observationKey: revision.observationKey, headRevision: revision.revision,
        assessmentAttemptId: id, metricId: revision.metricId, createdAt: date, updatedAt: date,
    };
    return { attempt, observation: { head, revision } };
}

function source(points = [point('baseline', '2026-08-01T10:00:00Z', 150)]): AssessmentBriefSource {
    return {
        binding: { protocolId: PROTOCOL.id, metricId: 'strength_1rm_kg' },
        attempts: points.map(p => p.attempt), observations: points.map(p => p.observation),
        unreadableCount: 0, truncated: false, unavailable: false,
    };
}

function render(sources = [source()], overrides: Partial<AssessmentBriefInput> = {}) {
    return renderAssessmentBrief({ sources, unsupportedCount: 0, omittedCount: 0, relevanceState: 'available', ...overrides }, AS_OF).join('\n');
}

describe('planning assessment benchmarks (#897 WP8.3)', () => {
    it('renders an older measured baseline with no comparable repeat, date and protocol/source identity', () => {
        const text = render();
        expect(text).toContain('measured benchmark 150 kg (2026-08-01)');
        expect(text).toContain('no comparable repeat');
        expect(text).toContain('insufficient_evidence');
        expect(text).toContain(`${PROTOCOL.id} r${PROTOCOL.revision}`);
        expect(text).toContain('source manual');
        expect(text).not.toContain('e1RM');
    });

    it('renders compatible raw changes without upgrading reliability-free progress', () => {
        const text = render([source([point('baseline', '2026-08-01T10:00:00Z', 150), point('repeat', '2026-10-10T10:00:00Z', 155)])]);
        expect(text).toContain('measured benchmark 155 kg (2026-10-10)');
        expect(text).toContain('baseline 150 kg (2026-08-01)');
        expect(text).toContain('+5 kg');
        expect(text).toContain('+3.3%');
        expect(text).toContain('insufficient_evidence');
        expect(text).not.toContain('improvement');
    });

    it('preserves measured velocity precision and History change formatting', () => {
        const protocol = BACK_SQUAT_FIXED_LOAD_VELOCITY_PROTOCOL;
        const metricId = 'strength_fixed_load_mean_velocity_mps';
        const evidence = source([
            point('baseline', '2026-08-01T10:00:00Z', 0.45),
            point('repeat', '2026-10-10T10:00:00Z', 0.5),
        ]);
        evidence.binding = { protocolId: protocol.id, metricId, protocolRevision: protocol.revision };
        for (const attempt of evidence.attempts) attempt.protocolRef = { id: protocol.id, revision: protocol.revision };
        for (const observation of evidence.observations) {
            observation.head.metricId = metricId;
            Object.assign(observation.revision, { protocolRef: { id: protocol.id, revision: protocol.revision }, metricId, unit: 'm/s' });
        }
        const text = render([evidence]);
        expect(text).toContain('measured benchmark 0.5 m/s');
        expect(text).toContain('baseline 0.45 m/s');
        expect(text).toContain('comparable raw change +0.05 m/s (+11.1%)');
        expect(text).toContain('insufficient_evidence');
    });

    it.each(['context', 'revision'] as const)('does not compare incompatible %s numerically', kind => {
        const repeat = point('repeat', '2026-10-10T10:00:00Z', 155, kind === 'context'
            ? { comparisonSeriesKey: 'setup-b' }
            : { protocolRef: { id: PROTOCOL.id, revision: PROTOCOL.revision + 1 } });
        repeat.attempt.protocolRef = repeat.observation.revision.protocolRef;
        const text = render([source([point('baseline', '2026-08-01T10:00:00Z', 150), repeat])]);
        expect(text).toContain('non-comparable');
        expect(text).not.toContain('+5 kg');
        expect(text).not.toContain('+3.3%');
    });

    it('excludes familiarization, abandoned, incomplete, invalid, unknown-parent and future observations', () => {
        const baseline = point('baseline', '2026-08-01T10:00:00Z', 150);
        const extras = Array.from({ length: 6 }, (_, i) => point(`bad-${i}`, '2026-10-10T10:00:00Z', 999));
        extras[0].attempt.purpose = 'familiarization';
        extras[1].attempt.state = 'abandoned';
        extras[2].attempt.state = 'in_progress';
        extras[3].observation.revision.validity = 'invalid';
        extras[4].observation.revision.assessmentAttemptId = 'unknown';
        // UTC D0 is already D+1 in Warsaw.
        extras[5].observation.revision.observedAt = '2026-10-11T22:30:00Z';
        const text = render([source([baseline, ...extras])]);
        expect(text).toContain('150 kg');
        expect(text).not.toContain('999');
        expect(text).toContain('no comparable repeat');
    });

    it('uses only corrected current revisions and excludes invalidated current heads', () => {
        const current = point('repeat', '2026-10-10T10:00:00Z', 152, { revision: 2 });
        const stale = point('repeat', '2026-10-10T10:00:00Z', 190);
        stale.observation.head.headRevision = 2;
        const evidence = source([point('baseline', '2026-08-01T10:00:00Z', 150), stale, current]);
        expect(render([evidence])).toContain('152 kg');
        expect(render([evidence])).not.toContain('190 kg');
        current.observation.revision.validity = 'invalid';
        expect(render([evidence])).toContain('no comparable repeat');
    });

    it('distinguishes missing, unreadable and unsupported evidence and withholds partial-read comparisons', () => {
        const empty = { ...source(), attempts: [], observations: [] };
        expect(render([empty])).toContain('missing');
        expect(render([{ ...empty, unavailable: true }])).toContain('unavailable');
        const incomplete = source([point('baseline', '2026-08-01T10:00:00Z', 150), point('repeat', '2026-10-10T10:00:00Z', 155)]);
        for (const partial of [{ ...incomplete, unreadableCount: 1 }, { ...incomplete, truncated: true }]) {
            expect(render([partial])).toContain('incomplete');
            expect(render([partial])).not.toContain('+5 kg');
            expect(render([partial])).not.toContain('no comparable repeat');
        }
        expect(render([], { unsupportedCount: 1 })).toContain('unsupported');
    });

    it('selects exact active exercise/test targets and keeps squat and bench separate', () => {
        const goal = (exerciseId: string, status = 'active') => ({ status, performanceTarget: {
            kind: 'performance_metric', metricId: 'strength_1rm_kg', subjectRef: { kind: 'exercise', exerciseId }, targetValue: 180,
        } }) as UserGoal;
        const result = assessmentBriefBindingsForGoals([
            goal('back_squat'), goal('bench_press'), goal('back_squat', 'completed'),
            goal('conventional_deadlift'), { status: 'active', title: 'squat power' } as UserGoal,
        ]);
        expect(result.bindings).toEqual([
            { protocolId: PROTOCOL.id, metricId: 'strength_1rm_kg' },
            { protocolId: BENCH_PRESS_1RM_PROTOCOL.id, metricId: 'strength_1rm_kg' },
        ]);
        expect(result.unsupportedCount).toBe(1);
    });

    it('orders deterministically, bounds rows and long source identifiers, and counts omissions', () => {
        const sources = Array.from({ length: 15 }, (_, i) => {
            const data = source();
            data.binding = { ...data.binding, protocolRevision: i + 1 };
            data.observations[0].revision.device = { provider: 'x'.repeat(5000) };
            return data;
        });
        const text = render(sources);
        expect(text).toBe(render([...sources].reverse()));
        expect(text).toContain('3');
        expect(text.length).toBeLessThan(12000);
        expect(text).not.toContain('x'.repeat(97));
    });

    it('formats best PR when repeat is higher for higher_is_better metrics and preserves tie-break to earliest', () => {
        const text = render([source([
            point('baseline', '2026-08-01T10:00:00Z', 150),
            point('repeat1', '2026-09-01T10:00:00Z', 165),
            point('repeat2', '2026-10-10T10:00:00Z', 160),
        ])]);
        expect(text).toContain('measured benchmark 160 kg (2026-10-10)');
        expect(text).toContain('best 165 kg (2026-09-01)');
        expect(text).toContain('baseline 150 kg (2026-08-01)');
    });

    it('auto-discovers completed benchmark-eligible attempts on or before asOfDate', () => {
        const attempts: AssessmentAttempt[] = [
            {
                id: 'att-broad-jump',
                protocolRef: { id: STANDING_BROAD_JUMP_PROTOCOL_V2.id, revision: STANDING_BROAD_JUMP_PROTOCOL_V2.revision },
                state: 'completed',
                purpose: 'baseline',
                completedAt: '2026-10-10T09:00:00Z',
            },
            {
                id: 'att-future',
                protocolRef: { id: PROTOCOL.id, revision: PROTOCOL.revision },
                state: 'completed',
                purpose: 'checkpoint',
                completedAt: '2026-10-15T09:00:00Z', // After AS_OF 2026-10-11
            },
            {
                id: 'att-abandoned',
                protocolRef: { id: BENCH_PRESS_1RM_PROTOCOL.id, revision: BENCH_PRESS_1RM_PROTOCOL.revision },
                state: 'abandoned',
                purpose: 'checkpoint',
                completedAt: '2026-10-09T09:00:00Z',
            },
            {
                id: 'att-familiarization',
                protocolRef: { id: BENCH_PRESS_1RM_PROTOCOL.id, revision: BENCH_PRESS_1RM_PROTOCOL.revision },
                state: 'completed',
                purpose: 'familiarization',
                completedAt: '2026-10-09T09:00:00Z',
            },
        ];
        const discovered = assessmentBriefBindingsForCompletedAttempts(attempts, AS_OF);
        expect(discovered).toEqual([
            {
                protocolId: STANDING_BROAD_JUMP_PROTOCOL_V2.id,
                metricId: 'standing_broad_jump_distance_cm',
            },
        ]);
    });

    it('derives structured measuredBenchmarks for JSON export and omits partial or unavailable sources', () => {
        const validSource = source([
            point('baseline', '2026-08-01T10:00:00Z', 150),
            point('repeat', '2026-10-10T10:00:00Z', 160),
        ]);
        const partialSource: AssessmentBriefSource = {
            ...source([point('p-base', '2026-08-01T10:00:00Z', 100)]),
            binding: { protocolId: BENCH_PRESS_1RM_PROTOCOL.id, metricId: 'strength_1rm_kg' },
            unreadableCount: 1,
        };
        const benchmarks = deriveMeasuredBenchmarks({
            sources: [validSource, partialSource],
            unsupportedCount: 0,
            omittedCount: 0,
            relevanceState: 'available',
        }, AS_OF);

        expect(benchmarks).toHaveLength(1);
        expect(benchmarks[0]).toEqual({
            protocolId: PROTOCOL.id,
            protocolRevision: PROTOCOL.revision,
            metricId: 'strength_1rm_kg',
            title: PROTOCOL.title,
            comparisonSeriesKey: 'setup-a',
            status: 'insufficient_evidence',
            current: { value: 160, unit: 'kg', date: '2026-10-10' },
            best: { value: 160, unit: 'kg', date: '2026-10-10' },
            baseline: { value: 150, unit: 'kg', date: '2026-08-01' },
        });
    });

    it('selects peak best row respecting metric direction and preserves earliest on tie', () => {
        const rows = [
            { observationKey: 'row-1', value: 150, unit: 'kg', observedAt: '2026-08-01T10:00:00Z', localDate: '2026-08-01', attemptPurpose: 'baseline' as const, validity: 'valid' as const },
            { observationKey: 'row-2', value: 165, unit: 'kg', observedAt: '2026-09-01T10:00:00Z', localDate: '2026-09-01', attemptPurpose: 'checkpoint' as const, validity: 'valid' as const },
            { observationKey: 'row-3', value: 165, unit: 'kg', observedAt: '2026-10-01T10:00:00Z', localDate: '2026-10-01', attemptPurpose: 'checkpoint' as const, validity: 'valid' as const },
            { observationKey: 'row-4', value: 170, unit: 'kg', observedAt: '2026-10-05T10:00:00Z', localDate: '2026-10-05', attemptPurpose: 'familiarization' as const, validity: 'valid' as const },
            { observationKey: 'row-5', value: 180, unit: 'kg', observedAt: '2026-10-06T10:00:00Z', localDate: '2026-10-06', attemptPurpose: 'checkpoint' as const, validity: 'invalid' as const },
        ];
        const series = {
            metricId: 'strength_1rm_kg', // higher_is_better
            protocolRevision: 1,
            comparisonSeriesKey: 'setup-a',
            resolvedContext: {},
            observations: rows,
            baseline: rows[0],
            latest: rows[1],
            progress: { status: 'improving' as const },
        } as unknown as AssessmentHistorySeries;
        const best = selectSeriesBestRow(series);
        expect(best?.observationKey).toBe('row-2');
        expect(best?.value).toBe(165);
    });
});
