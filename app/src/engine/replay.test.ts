import { describe, expect, it } from 'vitest';
import { EXTERNAL_PLAN_SCHEMA, type DailyRecommendation, type ExternalTrainingPlan } from './models';
import { POLICY_VERSION } from './policy';
import { externalTemplateId } from './externalSessionProfiles';
import { replayRecommendationAudit, replayRecommendationAuditAgainstRevision } from './replay';

function auditedRecommendation(): DailyRecommendation {
    return {
        userId: 'u1', date: '2026-08-07', templateId: 'easy_01', templateTitle: 'Easy Ride',
        category: 'Easy Endurance', modality: 'Cycling', mode: 'train', rationale: 'test', schemaVersion: 3,
        createdAt: '', updatedAt: '', adherence: { respondedAt: null, followed: null, actualModality: null, actualDurationMin: null, skipped: false, notes: null },
        recommendationAudit: {
            policyVersion: POLICY_VERSION, evaluatedAt: '2026-08-07T08:00:00Z', decisionContextRevision: 'history-v1:2026-08-07:7:none:none', safetyStatus: 'complete',
            history: { completedEventCount: 1, unmatchedEventCount: 0, sourceStatuses: { activities: 'AVAILABLE', recommendations: 'AVAILABLE', manualTraining: 'MISSING' } },
            envelope: { safetyRestrictedModalityCount: 0, planMaxAllowableTier: 'Easy' },
            candidateScores: [{ templateId: 'easy_01', utilityScore: 1, excludedReasons: [] }, { templateId: 'easy_02', utilityScore: 0.5, excludedReasons: [] }],
            droppedContributorObjectives: [],
        },
    };
}

describe('recommendation audit replay', () => {
    it('accepts a current-policy audit whose selected template is the top candidate', () => {
        expect(replayRecommendationAudit(auditedRecommendation())).toEqual({ reproducible: true, policyMatchesCurrent: true, errors: [] });
    });

    it('explicitly rejects the historical single-ranking-path policy as audit-only', () => {
        const record = auditedRecommendation();
        record.recommendationAudit!.policyVersion = '2026-08-single-ranking-path-v1';
        expect(replayRecommendationAudit(record)).toEqual({
            reproducible: false,
            policyMatchesCurrent: false,
            errors: ['Historical policy version 2026-08-single-ranking-path-v1 is intentionally audit-only and cannot be replayed by this build.'],
        });
    });

    it('treats the policy preceding Phase 5 as audit-only', () => {
        const record = auditedRecommendation();
        record.recommendationAudit!.policyVersion = '2026-08-objective-credit-v2-v2';
        expect(replayRecommendationAudit(record)).toEqual({
            reproducible: false,
            policyMatchesCurrent: false,
            errors: ['Historical policy version 2026-08-objective-credit-v2-v2 is intentionally audit-only and cannot be replayed by this build.'],
        });
    });

    it('treats the Phase 5 sequence-planning policy as audit-only now that Phase 6.2 has superseded it', () => {
        const record = auditedRecommendation();
        record.recommendationAudit!.policyVersion = '2026-08-phase5-sequence-planning-v1';
        expect(replayRecommendationAudit(record)).toEqual({
            reproducible: false,
            policyMatchesCurrent: false,
            errors: ['Historical policy version 2026-08-phase5-sequence-planning-v1 is intentionally audit-only and cannot be replayed by this build.'],
        });
    });

    it('rejects an unknown policy version distinctly from a known historical policy', () => {
        const record = auditedRecommendation();
        record.recommendationAudit!.policyVersion = 'unknown-policy';
        expect(replayRecommendationAudit(record)).toMatchObject({
            reproducible: false,
            policyMatchesCurrent: false,
            errors: ['Policy version unknown-policy is not available in this build.'],
        });
    });

    it('rejects a record whose selected template was not the highest-scoring candidate', () => {
        const record = auditedRecommendation();
        record.recommendationAudit!.candidateScores[1].utilityScore = 2;
        expect(replayRecommendationAudit(record)).toMatchObject({ reproducible: false, errors: ['Persisted template was not the highest-utility audited candidate.'] });
    });
});

describe('external decision replay (ADR-0019 D-IMMUT)', () => {
    const PLAN_ID = 'autumn-block';
    const SESSION_ID = 'w1-threshold';

    function planRevision(overrides: Partial<ExternalTrainingPlan> = {}): ExternalTrainingPlan {
        return {
            schema: EXTERNAL_PLAN_SCHEMA,
            planId: PLAN_ID, revision: 1, title: '4-week block',
            startDate: '2026-08-17', weekCount: 4,
            sessions: [{
                id: SESSION_ID, title: 'Threshold 3x12', priority: 'key',
                placement: { week: 1, preferredDay: 'tuesday', flexibility: 'preferred', ifMissed: 'drop' },
                gating: { modality: 'cycling', intensity: 'hard', durationMin: 60, durationMax: 75, environment: 'either', equipment: [] },
                prescription: { summary: '3x12 at threshold.' },
            }],
            ...overrides,
        };
    }

    function eventPlanRevision(): ExternalTrainingPlan {
        const plan = planRevision();
        plan.sessions[0] = {
            ...plan.sessions[0],
            title: 'Road Race',
            isEvent: true,
            placement: { week: 1, preferredDay: 'tuesday', flexibility: 'fixed', ifMissed: 'drop' },
            gating: { modality: 'cycling', intensity: 'max', durationMin: 50, durationMax: 60, environment: 'outdoor', equipment: [] },
        };
        return plan;
    }

    function externalRecommendation(): DailyRecommendation {
        const record = auditedRecommendation();
        record.templateId = externalTemplateId(PLAN_ID, 1, SESSION_ID);
        record.templateTitle = 'Threshold 3x12';
        record.recommendationAudit!.candidateScores = [];
        record.recommendationAudit!.externalPlan = {
            planId: PLAN_ID, revision: 1, sessionId: SESSION_ID,
            contentHash: 'placeholder',
        };
        return record;
    }

    async function withRealHash(plan: ExternalTrainingPlan): Promise<DailyRecommendation> {
        const { computeContentHash } = await import('./externalPlanHash');
        const record = externalRecommendation();
        record.recommendationAudit!.externalPlan!.contentHash = await computeContentHash(plan);
        return record;
    }

    async function eventHybridRecommendation(plan: ExternalTrainingPlan): Promise<DailyRecommendation> {
        const { computeContentHash } = await import('./externalPlanHash');
        const record = auditedRecommendation();
        record.recommendationAudit!.externalPlan = {
            planId: PLAN_ID,
            revision: 1,
            sessionId: SESSION_ID,
            contentHash: await computeContentHash(plan),
        };
        return record;
    }

    it('replays reproducibly against the revision it names, despite ranking nothing', async () => {
        const plan = planRevision();
        expect(await replayRecommendationAuditAgainstRevision(await withRealHash(plan), plan))
            .toEqual({ reproducible: true, policyMatchesCurrent: true, errors: [] });
    });

    it('replays an external event as provenance for a normally ranked catalog recommendation', async () => {
        const plan = eventPlanRevision();
        const record = await eventHybridRecommendation(plan);

        expect(await replayRecommendationAuditAgainstRevision(record, plan))
            .toEqual({ reproducible: true, policyMatchesCurrent: true, errors: [] });
    });

    it('still verifies highest-utility selection on an event-informed ranked decision', async () => {
        const plan = eventPlanRevision();
        const record = await eventHybridRecommendation(plan);
        record.recommendationAudit!.candidateScores[1].utilityScore = 2;

        expect((await replayRecommendationAuditAgainstRevision(record, plan)).errors)
            .toContain('Persisted template was not the highest-utility audited candidate.');
    });

    it('rejects persisting an event itself as the recommended synthetic template', async () => {
        const plan = eventPlanRevision();
        const record = await eventHybridRecommendation(plan);
        record.templateId = externalTemplateId(PLAN_ID, 1, SESSION_ID);

        expect((await replayRecommendationAuditAgainstRevision(record, plan)).errors)
            .toContain('An external event was persisted as the recommended template instead of as a fixed commitment.');
    });

    it('fails with a distinct hash-mismatch reason when the stored revision was edited', async () => {
        const original = planRevision();
        const mutated = planRevision();
        mutated.sessions[0].prescription = { summary: '5x8 at threshold.' };

        const result = await replayRecommendationAuditAgainstRevision(await withRealHash(original), mutated);

        expect(result.reproducible).toBe(false);
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]).toMatch(/content hash mismatch/i);
        expect(result.errors[0]).toContain('has changed since this decision was made');
    });

    it('refuses to call an external decision reproducible without the revision', async () => {
        const result = replayRecommendationAudit(await withRealHash(planRevision()));

        expect(result.reproducible).toBe(false);
        expect(result.errors[0]).toContain('cannot be replayed without it');
    });

    it('rejects a revision that is not the one the audit names', async () => {
        const result = await replayRecommendationAuditAgainstRevision(
            await withRealHash(planRevision()),
            planRevision({ revision: 2 }),
        );

        expect(result.errors[0]).toContain('but the audit references autumn-block@1');
    });

    it('rejects a revision that hashes correctly but no longer contains the session', async () => {
        const plan = planRevision();
        const record = await withRealHash(plan);
        record.recommendationAudit!.externalPlan!.sessionId = 'w2-vo2';

        expect((await replayRecommendationAuditAgainstRevision(record, plan)).errors)
            .toContain('Session w2-vo2 is not present in plan autumn-block revision 1.');
    });

    it('rejects ranked candidates on an ordinary externally selected session', async () => {
        const plan = planRevision();
        const record = await withRealHash(plan);
        record.recommendationAudit!.candidateScores = [{ templateId: 'easy_01', utilityScore: 1, excludedReasons: [] }];

        expect((await replayRecommendationAuditAgainstRevision(record, plan)).errors)
            .toContain('An externally selected session audited ranked candidates, which that decision path must not produce.');
    });

    it('accepts the rest template a non-actionable verdict persists', async () => {
        const plan = planRevision();
        const record = await withRealHash(plan);
        record.templateId = 'rest_01';

        expect((await replayRecommendationAuditAgainstRevision(record, plan)).reproducible).toBe(true);
    });

    it('rejects a synthetic template id belonging to a different imported session', async () => {
        const plan = planRevision();
        const record = await withRealHash(plan);
        record.templateId = externalTemplateId(PLAN_ID, 1, 'w2-vo2');

        expect((await replayRecommendationAuditAgainstRevision(record, plan)).errors[0])
            .toContain('does not match the audited external session');
    });

    it('rejects a revision supplied for a decision that never used an external plan', () => {
        const result = replayRecommendationAudit(auditedRecommendation(), {
            plan: planRevision(), contentHash: 'anything',
        });

        expect(result.errors).toContain('A plan revision was supplied for a decision that did not come from an external plan.');
    });

    it('still replays a normal catalog decision unchanged when no revision is involved', () => {
        expect(replayRecommendationAudit(auditedRecommendation()))
            .toEqual({ reproducible: true, policyMatchesCurrent: true, errors: [] });
    });
});
