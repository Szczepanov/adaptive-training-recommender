import type { DailyRecommendation } from '../engine/models';
import type { DailyRecommendationWithVerdict, ShadowVerdict } from '../engine/models';
import { getCanonicalRestTemplate } from '../engine/rules';
import { externalTemplateId } from '../engine/externalSessionProfiles';
import type { ExternalPlanSessionOccurrence, ManualSessionOccurrence, SessionEntry, SessionExecution } from '../sessions/models';
import type { PerformedTrainingOccurrence } from './models';
import { projectPlannedExecutionStatus, renderPlannedExecutionStatuses, type PlannedExecutionStatus, type PlannedExecutionStatusInput } from './plannedExecutionStatus';
import { describe, expect, it } from 'vitest';

const source = { planId: 'plan-a', revision: 2, sessionId: 'ride-1', contentHash: 'a'.repeat(64) };
const occurrence: ExternalPlanSessionOccurrence = {
    userId: 'u1', occurrenceId: 'occ-1', date: '2026-09-20', authority: 'external_plan', state: 'scheduled',
    externalPlanRef: source, createdAt: '2026-09-19T00:00:00.000Z', updatedAt: '2026-09-19T00:00:00.000Z',
};
const execution: SessionExecution = {
    userId: 'u1', executionId: 'exec-1', occurrenceId: 'occ-1',
    sessionSource: { kind: 'external_plan', ...source }, prescriptionHash: 'p'.repeat(64),
    date: occurrence.date, startedAt: '2026-09-20T06:00:00.000Z', completedAt: '2026-09-20T06:45:00.000Z',
    updatedAt: '2026-09-20T06:45:00.000Z', state: 'completed', schemaVersion: 1,
};
const performed: PerformedTrainingOccurrence = {
    schemaVersion: 1, performedOccurrenceId: 'performed-1', userId: 'u1', status: 'active',
    localDate: occurrence.date,
    sourceRefs: [{ kind: 'structured_execution', executionId: 'exec-1', sessionOccurrenceId: 'occ-1', prescriptionHash: execution.prescriptionHash }],
    reconciliation: { state: 'single_source' }, createdAt: '2026-09-20T06:00:00.000Z', updatedAt: '2026-09-20T06:45:00.000Z',
};

function input(overrides: Partial<PlannedExecutionStatusInput> = {}): PlannedExecutionStatusInput {
    return {
        date: occurrence.date, authored: { kind: 'session', source }, authoredDate: occurrence.date,
        occurrenceId: occurrence.occurrenceId, occurrencesReadable: true, executionsReadable: true, performedReadable: true,
        occurrences: [occurrence], recommendations: [], executions: [], performedOccurrences: [],
        ...overrides,
    };
}

describe('projectPlannedExecutionStatus', () => {
    it('joins completed performance through exact occurrence and execution identity', () => {
        const result = projectPlannedExecutionStatus(input({
            executions: [{ execution, entries: [] }],
            recommendations: [{ date: occurrence.date, recommendationAudit: {
                externalPlan: source,
                primarySession: { sessionSource: execution.sessionSource, occurrenceId: occurrence.occurrenceId, prescriptionHash: execution.prescriptionHash },
                plannedDose: { volume: 1, intensity: 1 }, executionDose: { volume: 1, intensity: 1 },
            } } as DailyRecommendation],
            performedOccurrences: [performed],
        }));
        expect(result).toMatchObject({
            placement: 'as_authored', performance: 'completed',
            executionId: 'exec-1', performedOccurrenceId: 'performed-1', prescriptionHash: execution.prescriptionHash,
        });
    });

    it('does not infer a miss from a recent scheduled occurrence without execution', () => {
        expect(projectPlannedExecutionStatus(input()).performance).toBe('unknown');
    });

    it('uses only an explicit missed occurrence as evidence of no performance', () => {
        expect(projectPlannedExecutionStatus(input({ occurrences: [{ ...occurrence, state: 'missed' }] })).performance)
            .toBe('none_observed');
    });

    it('does not join same-day records with a different immutable plan source', () => {
        const otherOccurrence = { ...occurrence, externalPlanRef: { ...source, sessionId: 'ride-2' } };
        const result = projectPlannedExecutionStatus(input({ occurrences: [otherOccurrence], executions: [{ execution, entries: [] }] }));
        expect(result.executionId).toBeUndefined();
        expect(result.performance).toBe('unknown');
    });

    it('does not join an occurrence from another local date', () => {
        const result = projectPlannedExecutionStatus(input({
            date: '2026-09-21',
            occurrences: [occurrence],
            executions: [{ execution, entries: [] }],
        }));
        expect(result.occurrenceId).toBeUndefined();
        expect(result.executionId).toBeUndefined();
        expect(result.performance).toBe('unknown');
    });

    it('renders source read failures as unknown', () => {
        const result = projectPlannedExecutionStatus(input({
            occurrencesReadable: false, recommendations: [{ date: occurrence.date } as DailyRecommendation],
        }));
        expect(result.adjudication).toBe('unknown');
        expect(result.performance).toBe('unknown');
    });

    it('keeps authored rest distinct while reporting unexpected performed work', () => {
        const result = projectPlannedExecutionStatus(input({
            authored: { kind: 'rest', planId: 'plan-a', revision: 2, restDirectiveId: 'rest-1' },
            occurrences: [], recommendations: [], executions: [], performedOccurrences: [performed],
        }));
        expect(result.authored).toMatchObject({ kind: 'rest', restDirectiveId: 'rest-1' });
        expect(result.performance).toBe('not_applicable');
        expect(result.evidence).toContain('observed-work:performed-1');
    });
    it('renders round-trip rows chronologically with deterministic tie-breakers', () => {
        const status = (date: string, sessionId: string, occurrenceId: string): PlannedExecutionStatus => ({
            date,
            authored: { kind: 'session', source: { ...source, sessionId } },
            placement: 'as_authored',
            adjudication: 'as_authored',
            athleteDisposition: 'accepted',
            performance: 'completed',
            occurrenceId,
            evidence: [],
        });
        const rows = renderPlannedExecutionStatuses([
            status('2026-09-21', 'ride-a', 'occ-2'),
            status('2026-09-19', 'ride-z', 'occ-9'),
            status('2026-09-21', 'ride-b', 'occ-3'),
            status('2026-09-21', 'ride-a', 'occ-1'),
        ]).filter(line => line.startsWith('- '));

        expect(rows[0]).toContain('2026-09-19');
        expect(rows[0]).toContain('/ride-z');
        expect(rows[1]).toContain('/ride-a');
        expect(rows[1]).toContain('occurrence occ-1');
        expect(rows[2]).toContain('/ride-a');
        expect(rows[2]).toContain('occurrence occ-2');
        expect(rows[3]).toContain('/ride-b');
    });

    describe('renderPlannedExecutionStatuses provenance and bounds (PR-D D0)', () => {
        const rowStatus = (overrides: Partial<PlannedExecutionStatus> = {}): PlannedExecutionStatus => ({
            date: '2026-09-20',
            authored: { kind: 'session', source },
            placement: 'unknown',
            adjudication: 'unknown',
            athleteDisposition: 'unknown',
            performance: 'unknown',
            evidence: [],
            ...overrides,
        });

        it('renders replacement provenance from replaced-by evidence', () => {
            const rows = renderPlannedExecutionStatuses([rowStatus({
                athleteDisposition: 'manually_replaced',
                evidence: ['recommendation:2026-09-20', 'replaced-by:occ-manual-1'],
            })]).filter(line => line.startsWith('- '));

            expect(rows).toEqual([
                '- 2026-09-20 plan-a r2/ride-1: placement unknown; adjudication unknown; athlete manually replaced; performance unknown; replaced by occurrence occ-manual-1.',
            ]);
        });

        it('renders a row-level archive failure distinctly from non-determinable unknown', () => {
            const rows = renderPlannedExecutionStatuses([rowStatus({
                evidence: ['replace-archive-unavailable'],
            })]).filter(line => line.startsWith('- '));

            expect(rows).toEqual([
                '- 2026-09-20 plan-a r2/ride-1: placement unknown; adjudication unknown; athlete unknown; performance unknown; replacement source unavailable (archive read failed).',
            ]);
        });

        it('keeps the newest 20 rows in chronological order with a directional omission line', () => {
            const day = (index: number): string => `2026-09-${String(index).padStart(2, '0')}`;
            const statuses = Array.from({ length: 22 }, (_, offset) => rowStatus({
                date: day(offset + 1),
                occurrenceId: `occ-${String(offset + 1).padStart(2, '0')}`,
                evidence: [],
            }));
            const rows = renderPlannedExecutionStatuses(statuses).filter(line => line.startsWith('- '));

            expect(rows).toHaveLength(21);
            expect(rows[0]).toContain('2026-09-03');
            expect(rows[0]).toContain('occurrence occ-03');
            expect(rows[19]).toContain('2026-09-22');
            expect(rows[19]).toContain('occurrence occ-22');
            expect(rows[20]).toBe('- 2 earlier records omitted from this bounded section.');
            expect(rows.join('\n')).not.toContain('2026-09-01');
            expect(rows.join('\n')).not.toContain('2026-09-02');
        });

        it('uses full authored identity as a deterministic tie-breaker', () => {
            const planA = rowStatus({
                authored: { kind: 'session', source: { ...source, planId: 'plan-a', revision: 3, sessionId: 'same-session' } },
                occurrenceId: undefined,
            });
            const planB = rowStatus({
                authored: { kind: 'session', source: { ...source, planId: 'plan-b', revision: 2, sessionId: 'same-session' } },
                occurrenceId: undefined,
            });

            const forward = renderPlannedExecutionStatuses([planA, planB]).filter(line => line.startsWith('- '));
            const reverse = renderPlannedExecutionStatuses([planB, planA]).filter(line => line.startsWith('- '));

            expect(reverse).toEqual(forward);
            expect(forward[0]).toContain('plan-a r3/same-session');
            expect(forward[1]).toContain('plan-b r2/same-session');
        });

        it('bounds and sanitizes rendered identifiers and provenance lists', () => {
            const longSessionId = `ride-${'x'.repeat(140)}\ncontinued`;
            const sessionRows = renderPlannedExecutionStatuses([rowStatus({
                authored: { kind: 'session', source: { ...source, sessionId: longSessionId } },
            })]).filter(line => line.startsWith('- '));

            expect(sessionRows).toHaveLength(1);
            expect(sessionRows[0]).not.toContain('\n');
            expect(sessionRows[0]).not.toContain(longSessionId);
            expect(sessionRows[0]).toContain('…');
            expect(sessionRows[0]).not.toContain('Authored rest/no session');

            const longRestId = `rest-${'r'.repeat(140)}\ncontinued`;
            const evidence = [
                ...Array.from({ length: 7 }, (_, index) => `observed-work:work-${7 - index}`),
                'observed-work:work-3',
                `replaced-by:${'replacement-a-'.repeat(12)}`,
                `replaced-by:${'replacement-b-'.repeat(12)}`,
            ];
            const restRows = renderPlannedExecutionStatuses([rowStatus({
                authored: { kind: 'rest', planId: 'plan-a', revision: 2, restDirectiveId: longRestId },
                evidence,
            })]).filter(line => line.startsWith('- '));

            expect(restRows).toHaveLength(1);
            expect(restRows[0]).not.toContain('\n');
            expect(restRows[0]).not.toContain(longRestId);
            expect(restRows[0]).toContain('…');
            expect(restRows[0]).toContain('observed work: work-1, work-2, work-3, work-4, work-5; 2 additional observed-work ids omitted');
            expect(restRows[0]).toContain('1 additional replacement id omitted');
            expect(restRows[0].length).toBeLessThan(1_200);
        });
    });

});

const REST_TEMPLATE_ID = getCanonicalRestTemplate().id;
const SYNTHETIC_TEMPLATE_ID = externalTemplateId('plan-a', 2, 'ride-1');

function gatedRecommendation(verdict: ShadowVerdict | undefined, templateId: string): DailyRecommendationWithVerdict {
    return {
        date: occurrence.date,
        templateId,
        mode: 'recover',
        ...(verdict !== undefined ? { engineVerdict: verdict } : {}),
        recommendationAudit: {
            externalPlan: source,
        },
    } as DailyRecommendationWithVerdict;
}

function replaceRecommendation(): DailyRecommendationWithVerdict {
    return {
        date: occurrence.date,
        templateId: 'authored-replacement-template',
        mode: 'train',
        engineVerdict: 'proceed',
        recommendationAudit: {
            authoredOccurrence: { occurrenceId: 'occ-manual-1', decision: 'proceed' },
        },
    } as DailyRecommendationWithVerdict;
}

const manualOccurrence: ManualSessionOccurrence = {
    userId: 'u1',
    occurrenceId: 'occ-manual-1',
    date: occurrence.date,
    authority: 'replace_recommendation',
    state: 'scheduled',
    definitionRef: { definitionId: 'def-1', revision: 1, contentHash: 'm'.repeat(64) },
    createdAt: '2026-09-19T00:00:00.000Z',
    updatedAt: '2026-09-19T00:00:00.000Z',
};

const manualExecution: SessionExecution = {
    userId: 'u1',
    executionId: 'exec-manual-1',
    occurrenceId: 'occ-manual-1',
    sessionSource: { kind: 'manual', definitionId: 'def-1', revision: 1, contentHash: 'm'.repeat(64) },
    prescriptionHash: 'q'.repeat(64),
    date: occurrence.date,
    startedAt: '2026-09-20T06:00:00.000Z',
    completedAt: '2026-09-20T06:45:00.000Z',
    updatedAt: '2026-09-20T06:45:00.000Z',
    state: 'completed',
    schemaVersion: 1,
};

describe('projectPlannedExecutionStatus gate replacement (PR-C C1)', () => {
    it('pins the canonical rest template id so a template rename forces derivation review', () => {
        // Tripwire for G-1's consistency check: if this literal changes, the
        // gate derivation must be re-examined, not silently carried over.
        expect(REST_TEMPLATE_ID).toBe('rest_01');
    });

    it('labels a defer-gated day gate_replaced with unknown performance when nothing executed', () => {
        const result = projectPlannedExecutionStatus(input({
            occurrenceId: undefined,
            occurrences: [],
            recommendations: [gatedRecommendation('defer', REST_TEMPLATE_ID)],
        }));
        expect(result.adjudication).toBe('gate_replaced');
        expect(result.performance).toBe('unknown');
        expect(result.performance).not.toBe('none_observed');
    });

    it('labels a skip-gated day gate_replaced', () => {
        const result = projectPlannedExecutionStatus(input({
            occurrenceId: undefined,
            occurrences: [],
            recommendations: [gatedRecommendation('skip', REST_TEMPLATE_ID)],
        }));
        expect(result.adjudication).toBe('gate_replaced');
    });

    it('never labels an advisory event day gate_replaced', () => {
        const result = projectPlannedExecutionStatus(input({
            occurrenceId: undefined,
            occurrences: [],
            recommendations: [gatedRecommendation('advisory', REST_TEMPLATE_ID)],
        }));
        expect(result.adjudication).toBe('unknown');
        expect(result.adjudication).not.toBe('gate_replaced');
    });

    it('fails closed on advisory even when an exact external primary binding exists', () => {
        const advisory = {
            ...gatedRecommendation('advisory', SYNTHETIC_TEMPLATE_ID),
            recommendationAudit: {
                externalPlan: source,
                primarySession: {
                    sessionSource: execution.sessionSource,
                    occurrenceId: occurrence.occurrenceId,
                    prescriptionHash: execution.prescriptionHash,
                },
                plannedDose: { volume: 1, intensity: 1 },
                executionDose: { volume: 1, intensity: 1 },
            },
        } as DailyRecommendationWithVerdict;
        const result = projectPlannedExecutionStatus(input({
            executions: [{ execution, entries: [] }],
            recommendations: [advisory],
        }));
        expect(result.adjudication).toBe('unknown');
        expect(result.adjudication).not.toBe('as_authored');
    });

    it('yields unknown for a verdict-less legacy document instead of applying the mode fallback', () => {
        const result = projectPlannedExecutionStatus(input({
            occurrenceId: undefined,
            occurrences: [],
            recommendations: [gatedRecommendation(undefined, REST_TEMPLATE_ID)],
        }));
        expect(result.adjudication).toBe('unknown');
    });

    it('yields unknown on verdict/template disagreement instead of gate_replaced', () => {
        const result = projectPlannedExecutionStatus(input({
            occurrenceId: undefined,
            occurrences: [],
            recommendations: [gatedRecommendation('defer', SYNTHETIC_TEMPLATE_ID)],
        }));
        expect(result.adjudication).toBe('unknown');
    });

    it('keeps a legacy proceed day without verdict on the as_authored path', () => {
        const result = projectPlannedExecutionStatus(input({
            executions: [{ execution, entries: [] }],
            recommendations: [{ date: occurrence.date, recommendationAudit: {
                externalPlan: source,
                primarySession: { sessionSource: execution.sessionSource, occurrenceId: occurrence.occurrenceId, prescriptionHash: execution.prescriptionHash },
                plannedDose: { volume: 1, intensity: 1 }, executionDose: { volume: 1, intensity: 1 },
            } } as DailyRecommendation],
            performedOccurrences: [performed],
        }));
        expect(result.adjudication).toBe('as_authored');
    });

    it('reads a gated-but-trained day as gate_replaced without claiming the athlete overrode the gate', () => {
        const result = projectPlannedExecutionStatus(input({
            executions: [{ execution, entries: [] }],
            recommendations: [gatedRecommendation('defer', REST_TEMPLATE_ID)],
            performedOccurrences: [performed],
        }));
        expect(result).toMatchObject({
            adjudication: 'gate_replaced',
            athleteDisposition: 'accepted',
            performance: 'completed',
            executionId: 'exec-1',
            performedOccurrenceId: 'performed-1',
        });
    });
});

describe('projectPlannedExecutionStatus manual replacement (PR-C C2)', () => {
    it('labels a single-session replace day manually_replaced with auditable evidence', () => {
        const result = projectPlannedExecutionStatus(input({
            occurrenceId: undefined,
            occurrences: [],
            recommendations: [replaceRecommendation()],
            authoredSessionCountOnDate: 1,
            replacedByOccurrenceId: 'occ-manual-1',
        }));
        expect(result).toMatchObject({
            adjudication: 'unknown',
            athleteDisposition: 'manually_replaced',
            performance: 'unknown',
        });
        expect(result.adjudication).not.toBe('not_adjudicated');
        expect(result.evidence).toContain(`recommendation:${occurrence.date}`);
        expect(result.evidence).toContain('replaced-by:occ-manual-1');
    });

    it('stays unknown on multi-session days where the saved record cannot name the primary', () => {
        const result = projectPlannedExecutionStatus(input({
            occurrenceId: undefined,
            occurrences: [],
            recommendations: [replaceRecommendation()],
            authoredSessionCountOnDate: 2,
            replacedByOccurrenceId: 'occ-manual-1',
        }));
        expect(result.athleteDisposition).toBe('unknown');
        expect(result.athleteDisposition).not.toBe('manually_replaced');
    });

    it('stays unknown when no session count was computed rather than treating it as one', () => {
        const result = projectPlannedExecutionStatus(input({
            occurrenceId: undefined,
            occurrences: [],
            recommendations: [replaceRecommendation()],
            replacedByOccurrenceId: 'occ-manual-1',
        }));
        expect(result.athleteDisposition).toBe('unknown');
        expect(result.athleteDisposition).not.toBe('manually_replaced');
    });

    it('never infers a replacement from the recommendations array alone; hydration owns attribution', () => {
        const result = projectPlannedExecutionStatus(input({
            occurrenceId: undefined,
            occurrences: [],
            recommendations: [replaceRecommendation()],
        }));
        expect(result.adjudication).toBe('not_adjudicated');
        expect(result.athleteDisposition).not.toBe('manually_replaced');
    });

    it('reports none_observed only on an explicit terminal no-performance state of the authored occurrence', () => {
        const result = projectPlannedExecutionStatus(input({
            occurrences: [{ ...occurrence, state: 'missed' }],
            recommendations: [replaceRecommendation()],
            authoredSessionCountOnDate: 1,
            replacedByOccurrenceId: 'occ-manual-1',
        }));
        expect(result.athleteDisposition).toBe('manually_replaced');
        expect(result.performance).toBe('none_observed');
    });

    it('never reports the replacement workout as the authored session completion', () => {
        const result = projectPlannedExecutionStatus(input({
            occurrenceId: undefined,
            occurrences: [{ ...manualOccurrence, state: 'completed' }],
            executions: [{ execution: manualExecution, entries: [] }],
            recommendations: [replaceRecommendation()],
            authoredSessionCountOnDate: 1,
            replacedByOccurrenceId: 'occ-manual-1',
        }));
        expect(result.athleteDisposition).toBe('manually_replaced');
        expect(result.performance).toBe('unknown');
        expect(result.executionId).toBeUndefined();
    });

    it('lets an exact external execution win over the replace label', () => {
        const result = projectPlannedExecutionStatus(input({
            executions: [{ execution, entries: [] }],
            recommendations: [replaceRecommendation()],
            performedOccurrences: [performed],
            authoredSessionCountOnDate: 1,
            replacedByOccurrenceId: 'occ-manual-1',
        }));
        expect(result.athleteDisposition).toBe('accepted');
        expect(result.performance).toBe('completed');
        expect(result.adjudication).toBe('unknown');
    });

    it('degrades a replace day with an unavailable archive to unknown without nulling anything', () => {
        const result = projectPlannedExecutionStatus(input({
            occurrenceId: undefined,
            occurrences: [],
            recommendations: [replaceRecommendation()],
            replaceArchiveUnavailable: true,
        }));
        expect(result).toMatchObject({
            adjudication: 'unknown',
            athleteDisposition: 'unknown',
            performance: 'unknown',
        });
        expect(result.adjudication).not.toBe('not_adjudicated');
        expect(result.evidence).toContain('replace-archive-unavailable');
    });
});

describe('projectPlannedExecutionStatus remaining WP5.2 pins (PR-C C3)', () => {
    function boundRecommendation(plannedDose: { volume: number; intensity: number }, executionDose: { volume: number; intensity: number }): DailyRecommendation {
        return { date: occurrence.date, recommendationAudit: {
            externalPlan: source,
            primarySession: { sessionSource: execution.sessionSource, occurrenceId: occurrence.occurrenceId, prescriptionHash: execution.prescriptionHash },
            plannedDose, executionDose,
        } } as DailyRecommendation;
    }

    it('distinguishes scaled-completed from proceeded-as-authored by audited dose diff', () => {
        const scaled = projectPlannedExecutionStatus(input({
            executions: [{ execution, entries: [] }],
            recommendations: [boundRecommendation({ volume: 1, intensity: 1 }, { volume: 0.7, intensity: 1 })],
            performedOccurrences: [performed],
        }));
        expect(scaled).toMatchObject({
            adjudication: 'app_dose_modified',
            performance: 'completed',
            occurrenceId: 'occ-1',
            performedOccurrenceId: 'performed-1',
            executionId: 'exec-1',
            prescriptionHash: execution.prescriptionHash,
        });
        const authored = projectPlannedExecutionStatus(input({
            executions: [{ execution, entries: [] }],
            recommendations: [boundRecommendation({ volume: 1, intensity: 1 }, { volume: 1, intensity: 1 })],
            performedOccurrences: [performed],
        }));
        expect(authored).toMatchObject({ adjudication: 'as_authored', performance: 'completed' });
    });

    it('pins intentionally_moved at the projector so refactors cannot break it silently', () => {
        const result = projectPlannedExecutionStatus(input({
            authoredDate: '2026-09-19',
            placementConfirmedMoved: true,
        }));
        expect(result.placement).toBe('intentionally_moved');
    });

    it('labels an abandoned execution with entries partial_or_abandoned', () => {
        const result = projectPlannedExecutionStatus(input({
            executions: [{ execution: { ...execution, state: 'abandoned' }, entries: [{} as SessionEntry] }],
            recommendations: [boundRecommendation({ volume: 1, intensity: 1 }, { volume: 1, intensity: 1 })],
        }));
        expect(result.performance).toBe('partial_or_abandoned');
        expect(result.occurrenceId).toBe('occ-1');
    });

    it('labels an explicit skip explicitly_skipped with none_observed', () => {
        const result = projectPlannedExecutionStatus(input({
            occurrences: [{ ...occurrence, state: 'skipped' }],
        }));
        expect(result).toMatchObject({
            athleteDisposition: 'explicitly_skipped',
            performance: 'none_observed',
        });
    });

    it('keeps authored rest without work at not_applicable with no observed-work evidence', () => {
        const result = projectPlannedExecutionStatus(input({
            authored: { kind: 'rest', planId: 'plan-a', revision: 2, restDirectiveId: 'rest-1' },
            occurrenceId: undefined,
            occurrences: [],
            recommendations: [],
            performedOccurrences: [],
        }));
        expect(result.performance).toBe('not_applicable');
        expect(result.evidence.some(item => item.startsWith('observed-work:'))).toBe(false);
    });

    it('refuses to cross-match old-revision bytes after a re-import', () => {
        const revisedSource = { ...source, revision: 3 };
        const result = projectPlannedExecutionStatus(input({
            authored: { kind: 'session', source: revisedSource },
            occurrenceId: undefined,
            executions: [{ execution, entries: [] }],
        }));
        expect(result.executionId).toBeUndefined();
        expect(result.occurrenceId).toBeUndefined();
        expect(result.performance).toBe('unknown');
    });

    it('labels unplanned work not_applicable with observed-work evidence', () => {
        const result = projectPlannedExecutionStatus(input({
            authored: { kind: 'none' },
            occurrenceId: undefined,
            occurrences: [],
            recommendations: [],
            performedOccurrences: [performed],
        }));
        expect(result.performance).toBe('not_applicable');
        expect(result.evidence).toContain('observed-work:performed-1');
    });

    it('renders every dimension unknown when performed reads are unavailable', () => {
        const result = projectPlannedExecutionStatus(input({ performedReadable: false }));
        expect(result).toMatchObject({
            placement: 'unknown',
            adjudication: 'unknown',
            athleteDisposition: 'unknown',
            performance: 'unknown',
        });
    });

    it('renders every dimension unknown when execution reads are unavailable', () => {
        const result = projectPlannedExecutionStatus(input({ executionsReadable: false }));
        expect(result).toMatchObject({
            placement: 'unknown',
            adjudication: 'unknown',
            athleteDisposition: 'unknown',
            performance: 'unknown',
        });
    });

    it('renders every dimension unknown when the authored identity is unknown', () => {
        const result = projectPlannedExecutionStatus(input({
            authored: { kind: 'unknown', reason: 'immutable plan revision could not be verified' },
            occurrenceId: undefined,
            occurrences: [],
        }));
        expect(result).toMatchObject({
            placement: 'unknown',
            adjudication: 'unknown',
            athleteDisposition: 'unknown',
            performance: 'unknown',
        });
    });

    it('joins performed identity through enrichment without forking on a second source ref', () => {
        const enriched: PerformedTrainingOccurrence = {
            ...performed,
            sourceRefs: [
                { kind: 'structured_execution', executionId: 'exec-1', sessionOccurrenceId: 'occ-1', prescriptionHash: execution.prescriptionHash },
                { kind: 'provider_activity', provider: 'garmin', activityId: 'garmin-activity-1' },
            ],
        };
        const result = projectPlannedExecutionStatus(input({
            executions: [{ execution, entries: [] }],
            recommendations: [boundRecommendation({ volume: 1, intensity: 1 }, { volume: 1, intensity: 1 })],
            performedOccurrences: [enriched],
        }));
        expect(result.performance).toBe('completed');
        expect(result.performedOccurrenceId).toBe('performed-1');
    });
});
