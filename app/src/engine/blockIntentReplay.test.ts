import { describe, expect, it } from 'vitest';
import type { IntentBlock } from './blockIntent';
import type { TrainingIntentProfile, TrainingPriority } from './models';
import {
    buildTreatmentIntentReplayPayloadV1,
    canonicalizeTreatmentIntentJson,
    hashTreatmentIntentReplayPayload,
    verifyTreatmentIntentReplayDigest,
    type TreatmentIntentReplayPayloadV1,
} from './blockIntentReplay';

describe('blockIntentReplay (ADR-0037 D-REPLAY)', () => {
    const baseBlock: IntentBlock = {
        id: 'block_cycling_phase_01',
        revision: 2,
        sourcePlanId: 'plan_external_road_2026',
        sourcePlanRevision: 3,
        dateRange: { startDate: '2026-09-07', endDate: '2026-10-04' },
        objectives: [
            {
                id: 'obj_cycling_tempo',
                sport: 'cycling',
                adaptationScope: 'threshold_quality',
                coverageKey: 'sustained_quality',
                intent: 'develop',
                priority: 'must_have',
                doseEnvelope: { min: 60, target: 90, max: 120, unit: 'minutes', floorSemantics: 'hard_floor' },
                knowledgeLineage: ['claim_tempo_durability_v1', 'claim_threshold_v1'],
                protectedRoles: [
                    { kind: 'coverage_role', coverageKey: 'sustained_quality' },
                    { kind: 'session', sessionId: 'threshold_anchor' },
                ],
                allowedSubstitutions: [{
                    targetCoverageKey: 'sustained_quality',
                    allowedCoverageKeys: ['outdoor_event_specific', 'gap_closing'],
                    minDoseFraction: 0.9,
                    rationale: 'Human-facing substitution explanation',
                }],
                successCriteria: {
                    evaluationRef: { id: 'eval_spec_01', revision: 1, metricId: 'cycling_ftp' },
                    minCompletedExposures: 3,
                    targetTrend: 'improving',
                },
                entryPrerequisites: { requiredPriorExposures: 4, minBaselineDays: 14, prohibitedTissueSeverities: ['limit', 'exclude'] },
                exitCriteria: { maxWeeksInBlock: 4, stagnationReviewAfterWeeks: 3 },
            },
            {
                id: 'obj_strength_retention',
                sport: 'strength',
                adaptationScope: 'strength_maintenance',
                coverageKey: 'primary_strength',
                intent: 'maintain',
                priority: 'should_have',
                doseEnvelope: { min: 1, target: 2, max: 2, unit: 'sessions', floorSemantics: 'soft_floor' },
                knowledgeLineage: ['claim_strength_maintenance_v1'],
                successCriteria: { minCompletedExposures: 1 },
            },
        ],
        reviewSchedule: { reviewCadenceDays: 14, nextReviewDate: '2026-09-21' },
        progressionContract: {
            targetBinding: { objectiveId: 'obj_cycling_tempo' },
            variable: 'duration_min',
            unit: 'minutes',
            currentValue: 90,
            permittedRange: { min: 60, max: 120 },
            increment: 10,
            knowledgeLineage: ['policy_progression_review_v1'],
            observationWindowDays: 14,
            minCompletedExposures: 3,
            requiredFollowUpCoveragePct: 75,
            reviewCadenceDays: 14,
            reductionAlternative: { decrement: 10, trigger: 'adverse_response' },
        },
        title: 'Initial Build Phase Block',
        notes: 'Coaching note for athlete view',
    };

    const baseProfile: Pick<TrainingIntentProfile, 'priorities' | 'weeklyCommitment'> = {
        priorities: ['endurance', 'strength_muscle'],
        weeklyCommitment: { minSessions: 4, targetSessions: 6, maxSessions: 7 },
    };

    async function digest(block = baseBlock, profile = baseProfile, schema = 'external-plan@4', sourceRef?: string) {
        return hashTreatmentIntentReplayPayload(buildTreatmentIntentReplayPayloadV1(block, profile, schema, sourceRef));
    }

    it('produces deterministic canonical JSON regardless of object key insertion order', async () => {
        const payload = buildTreatmentIntentReplayPayloadV1(baseBlock, baseProfile, 'external-plan@4');
        const hash = await hashTreatmentIntentReplayPayload(payload);
        const scrambled: TreatmentIntentReplayPayloadV1 = {
            block: payload.block,
            schemaVersion: payload.schemaVersion,
            trainingIntentProfile: payload.trainingIntentProfile,
            sourcePlanIdentity: payload.sourcePlanIdentity,
        };
        expect(canonicalizeTreatmentIntentJson(payload)).toContain('treatment_intent_replay_v1');
        expect(await hashTreatmentIntentReplayPayload(scrambled)).toBe(hash);
        expect(await verifyTreatmentIntentReplayDigest(payload, hash)).toBe(true);
    });

    it('canonicalizes semantically unordered objective/set collections', async () => {
        const reordered: IntentBlock = {
            ...baseBlock,
            objectives: [
                baseBlock.objectives[1],
                {
                    ...baseBlock.objectives[0],
                    knowledgeLineage: [...baseBlock.objectives[0].knowledgeLineage].reverse(),
                    protectedRoles: [...baseBlock.objectives[0].protectedRoles!].reverse(),
                    allowedSubstitutions: [{
                        ...baseBlock.objectives[0].allowedSubstitutions![0],
                        allowedCoverageKeys: [...baseBlock.objectives[0].allowedSubstitutions![0].allowedCoverageKeys].reverse(),
                    }],
                    entryPrerequisites: {
                        ...baseBlock.objectives[0].entryPrerequisites!,
                        prohibitedTissueSeverities: [...baseBlock.objectives[0].entryPrerequisites!.prohibitedTissueSeverities!].reverse(),
                    },
                },
            ],
            progressionContract: {
                ...baseBlock.progressionContract!,
                knowledgeLineage: [...baseBlock.progressionContract!.knowledgeLineage].reverse(),
            },
        };
        expect(await digest(reordered)).toBe(await digest());
    });

    it('normalizes empty optional protected/substitution sets to omission', async () => {
        const without: IntentBlock = {
            ...baseBlock,
            objectives: [{ ...baseBlock.objectives[0], protectedRoles: undefined, allowedSubstitutions: undefined }, baseBlock.objectives[1]],
        };
        const empty: IntentBlock = {
            ...without,
            objectives: [{ ...without.objectives[0], protectedRoles: [], allowedSubstitutions: [] }, without.objectives[1]],
        };
        expect(await digest(without)).toBe(await digest(empty));
    });

    it('excludes display-only title/notes and substitution rationale from digest', async () => {
        const modified: IntentBlock = {
            ...baseBlock,
            title: 'Changed title',
            notes: 'Changed coaching note',
            objectives: [{
                ...baseBlock.objectives[0],
                allowedSubstitutions: [{ ...baseBlock.objectives[0].allowedSubstitutions![0], rationale: 'Completely different explanation' }],
            }, baseBlock.objectives[1]],
        };
        expect(await digest(modified)).toBe(await digest());
    });

    it('changes identity for source and block identity/effective bounds', async () => {
        const baseHash = await digest();
        const mutations: Array<Promise<string>> = [
            digest(baseBlock, baseProfile, 'external-plan@3'),
            digest({ ...baseBlock, sourcePlanId: 'different_plan' }),
            digest({ ...baseBlock, sourcePlanRevision: 4 }),
            digest(baseBlock, baseProfile, 'external-plan@4', 'manual:abc'),
            digest({ ...baseBlock, id: 'different_block' }),
            digest({ ...baseBlock, revision: 3 }),
            digest({ ...baseBlock, dateRange: { ...baseBlock.dateRange, endDate: '2026-10-03' } }),
        ];
        for (const mutation of mutations) expect(await mutation).not.toBe(baseHash);
    });

    it('changes identity for pinned profile priorities and every weekly commitment field', async () => {
        const baseHash = await digest();
        const mutatedPriorities = { ...baseProfile, priorities: ['health', 'endurance'] as TrainingPriority[] };
        expect(await digest(baseBlock, mutatedPriorities)).not.toBe(baseHash);
        for (const [field, value] of [['minSessions', 5], ['targetSessions', 5], ['maxSessions', 8]] as const) {
            expect(await digest(baseBlock, { ...baseProfile, weeklyCommitment: { ...baseProfile.weeklyCommitment, [field]: value } })).not.toBe(baseHash);
        }
    });

    it('changes identity for every objective semantic family', async () => {
        const baseHash = await digest();
        const obj = baseBlock.objectives[0];
        const mutations: IntentBlock[] = [
            { ...baseBlock, objectives: [{ ...obj, sport: 'running' }, baseBlock.objectives[1]] },
            { ...baseBlock, objectives: [{ ...obj, adaptationScope: 'vo2_max' }, baseBlock.objectives[1]] },
            { ...baseBlock, objectives: [{ ...obj, coverageKey: 'gap_closing' }, baseBlock.objectives[1]] },
            { ...baseBlock, objectives: [{ ...obj, intent: 'maintain' }, baseBlock.objectives[1]] },
            { ...baseBlock, objectives: [{ ...obj, priority: 'nice_to_have' }, baseBlock.objectives[1]] },
            { ...baseBlock, objectives: [{ ...obj, doseEnvelope: { ...obj.doseEnvelope, min: 75 } }, baseBlock.objectives[1]] },
            { ...baseBlock, objectives: [{ ...obj, doseEnvelope: { ...obj.doseEnvelope, target: 95 } }, baseBlock.objectives[1]] },
            { ...baseBlock, objectives: [{ ...obj, doseEnvelope: { ...obj.doseEnvelope, max: 115 } }, baseBlock.objectives[1]] },
            { ...baseBlock, objectives: [{ ...obj, doseEnvelope: { ...obj.doseEnvelope, floorSemantics: 'soft_floor' } }, baseBlock.objectives[1]] },
            { ...baseBlock, objectives: [{ ...obj, knowledgeLineage: [...obj.knowledgeLineage, 'new_claim'] }, baseBlock.objectives[1]] },
            { ...baseBlock, objectives: [{ ...obj, protectedRoles: [{ kind: 'session', sessionId: 'different' }] }, baseBlock.objectives[1]] },
            { ...baseBlock, objectives: [{ ...obj, allowedSubstitutions: [{ ...obj.allowedSubstitutions![0], minDoseFraction: 0.8 }] }, baseBlock.objectives[1]] },
            { ...baseBlock, objectives: [{ ...obj, successCriteria: { ...obj.successCriteria, minCompletedExposures: 4 } }, baseBlock.objectives[1]] },
            { ...baseBlock, objectives: [{ ...obj, entryPrerequisites: { ...obj.entryPrerequisites!, minBaselineDays: 21 } }, baseBlock.objectives[1]] },
            { ...baseBlock, objectives: [{ ...obj, exitCriteria: { ...obj.exitCriteria!, maxWeeksInBlock: 5 } }, baseBlock.objectives[1]] },
        ];
        for (const mutation of mutations) expect(await digest(mutation)).not.toBe(baseHash);
    });

    it('changes identity for review timing and every progression semantic family', async () => {
        const baseHash = await digest();
        const pc = baseBlock.progressionContract!;
        const mutations: IntentBlock[] = [
            { ...baseBlock, reviewSchedule: { ...baseBlock.reviewSchedule, nextReviewDate: '2026-09-22' } },
            { ...baseBlock, progressionContract: { ...pc, targetBinding: { objectiveId: pc.targetBinding.objectiveId, sessionId: 'session_a' } } },
            { ...baseBlock, progressionContract: { ...pc, currentValue: 100 } },
            { ...baseBlock, progressionContract: { ...pc, increment: 15 } },
            { ...baseBlock, progressionContract: { ...pc, permittedRange: { min: 65, max: 120 } } },
            { ...baseBlock, progressionContract: { ...pc, permittedRange: { min: 60, max: 115 } } },
            { ...baseBlock, progressionContract: { ...pc, knowledgeLineage: [...pc.knowledgeLineage, 'new_policy'] } },
            { ...baseBlock, progressionContract: { ...pc, observationWindowDays: 10 } },
            { ...baseBlock, progressionContract: { ...pc, minCompletedExposures: 4 } },
            { ...baseBlock, progressionContract: { ...pc, requiredFollowUpCoveragePct: 90 } },
            { ...baseBlock, progressionContract: { ...pc, reviewCadenceDays: 7 } },
            { ...baseBlock, progressionContract: { ...pc, reductionAlternative: { decrement: 5, trigger: 'adverse_response' } } },
            { ...baseBlock, progressionContract: { ...pc, reductionAlternative: undefined, redirectCriteria: { triggers: ['active_restriction'] } } },
        ];
        for (const mutation of mutations) expect(await digest(mutation)).not.toBe(baseHash);
    });

    it('rejects non-finite numbers instead of hashing them as JSON null', async () => {
        const payload = buildTreatmentIntentReplayPayloadV1({
            ...baseBlock,
            progressionContract: { ...baseBlock.progressionContract!, currentValue: Number.NaN },
        }, baseProfile, 'external-plan@4');
        await expect(hashTreatmentIntentReplayPayload(payload)).rejects.toThrow('non-finite number');
    });
});
