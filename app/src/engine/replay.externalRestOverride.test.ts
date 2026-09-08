import { describe, expect, it } from 'vitest';
import type { DailyRecommendation, ExternalTrainingPlan } from './models';
import type { ExternalRestDecisionProvenance } from './externalRestProvenance';
import { computeContentHash } from './externalPlanHash';
import { POLICY_VERSION } from './policy';
import { replayRecommendationAuditAgainstRevision } from './replay';
import { EXTERNAL_PLAN_SCHEMA_V3 } from '../sessions/externalPlanV3';

const DATE = '2026-08-18';
const PLAN_ID = 'autumn-block';
const DIRECTIVE_ID = 'w1-tue-rest';

function planRevision(): ExternalTrainingPlan {
    return {
        schema: EXTERNAL_PLAN_SCHEMA_V3,
        planId: PLAN_ID,
        revision: 1,
        title: '4-week block',
        startDate: '2026-08-17',
        weekCount: 4,
        sessions: [{
            id: 'w1-threshold', title: 'Threshold 3x12', priority: 'key',
            placement: { week: 1, preferredDay: 'monday', flexibility: 'preferred', ifMissed: 'drop' },
            gating: { modality: 'cycling', intensity: 'hard', durationMin: 60, durationMax: 75, environment: 'either', equipment: [] },
            prescription: { summary: '3x12 at threshold.' },
        }],
        restDays: [{ id: DIRECTIVE_ID, week: 1, day: 'tuesday' }],
    } as unknown as ExternalTrainingPlan;
}

async function overriddenRecommendation(plan: ExternalTrainingPlan): Promise<DailyRecommendation> {
    const externalRest: ExternalRestDecisionProvenance = {
        planId: PLAN_ID,
        revision: 1,
        contentHash: await computeContentHash(plan),
        restDirectiveId: DIRECTIVE_ID,
        date: DATE,
        overridden: true,
    };
    return {
        userId: 'u1',
        date: DATE,
        templateId: 'easy_01',
        templateTitle: 'Easy Ride',
        category: 'Easy Endurance',
        modality: 'Cycling',
        mode: 'train',
        rationale: 'Athlete explicitly overrode authored rest; normal gates selected an easy ride.',
        schemaVersion: 3,
        createdAt: '',
        updatedAt: '',
        adherence: { respondedAt: null, followed: null, actualModality: null, actualDurationMin: null, skipped: false, notes: null },
        recommendationAudit: {
            policyVersion: POLICY_VERSION,
            evaluatedAt: '2026-08-18T08:00:00Z',
            decisionContextRevision: 'history-v1:2026-08-18:7:none:none',
            safetyStatus: 'complete',
            history: { completedEventCount: 0, unmatchedEventCount: 0, sourceStatuses: { activities: 'AVAILABLE', recommendations: 'AVAILABLE', manualTraining: 'MISSING' } },
            envelope: { safetyRestrictedModalityCount: 0, planMaxAllowableTier: 'Hard' },
            candidateScores: [
                { templateId: 'easy_01', utilityScore: 1, excludedReasons: [] },
                { templateId: 'rest_01', utilityScore: 0, excludedReasons: [] },
            ],
            droppedContributorObjectives: [],
            externalRest,
        },
    };
}

describe('authored rest override replay (ADR-0035)', () => {
    it('keeps the authored directive load-bearing while replaying selection through normal ranking', async () => {
        const plan = planRevision();
        expect(await replayRecommendationAuditAgainstRevision(await overriddenRecommendation(plan), plan))
            .toEqual({ reproducible: true, policyMatchesCurrent: true, errors: [] });
    });

    it('still fails when the overridden decision did not select the highest-utility audited candidate', async () => {
        const plan = planRevision();
        const record = await overriddenRecommendation(plan);
        record.recommendationAudit!.candidateScores[1].utilityScore = 2;

        expect((await replayRecommendationAuditAgainstRevision(record, plan)).errors)
            .toContain('Persisted template was not the highest-utility audited candidate.');
    });
});
