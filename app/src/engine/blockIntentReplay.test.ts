import { describe, it, expect } from 'vitest';
import type { IntentBlock } from './blockIntent';
import type { TrainingIntentProfile, TrainingPriority } from './models';
import {
    buildTreatmentIntentReplayPayloadV1,
    hashTreatmentIntentReplayPayload,
    verifyTreatmentIntentReplayDigest,
    canonicalizeTreatmentIntentJson,
    type TreatmentIntentReplayPayloadV1,
} from './blockIntentReplay';

describe('blockIntentReplay (ADR-0037 D-REPLAY)', () => {
    const baseBlock: IntentBlock = {
        id: 'block_cycling_phase_01',
        revision: 2,
        sourcePlanId: 'plan_external_road_2026',
        sourcePlanRevision: 3,
        dateRange: {
            startDate: '2026-09-07',
            endDate: '2026-10-04',
        },
        objectives: [
            {
                id: 'obj_cycling_tempo',
                sport: 'cycling',
                adaptationScope: 'tempo_endurance',
                coverageKey: 'sustained_quality',
                intent: 'develop',
                priority: 'must_have',
                doseEnvelope: {
                    min: 60,
                    target: 90,
                    max: 120,
                    unit: 'minutes',
                    floorSemantics: 'hard_floor',
                },
                knowledgeLineage: ['claim_tempo_durability_v1'],
                protectedRoles: ['sustained_quality'],
                allowedSubstitutions: [
                    {
                        targetCoverageKey: 'sustained_quality',
                        allowedCoverageKeys: ['outdoor_event_specific'],
                        minDoseFraction: 0.9,
                    },
                ],
                entryPrerequisites: {
                    requiredPriorExposures: 4,
                    minBaselineDays: 14,
                    prohibitedTissueSeverities: ['limit', 'exclude'],
                },
                exitCriteria: {
                    maxWeeksInBlock: 4,
                },
            },
            {
                id: 'obj_strength_retention',
                sport: 'strength',
                adaptationScope: 'force_preservation',
                coverageKey: 'primary_strength',
                intent: 'maintain',
                priority: 'should_have',
                doseEnvelope: {
                    min: 1,
                    target: 2,
                    max: 2,
                    unit: 'sessions',
                    floorSemantics: 'soft_floor',
                },
            },
        ],
        reviewSchedule: {
            reviewCadenceDays: 14,
            nextReviewDate: '2026-09-21',
        },
        progressionContract: {
            targetBinding: {
                objectiveId: 'obj_cycling_tempo',
            },
            variable: 'duration_min',
            unit: 'minutes',
            currentValue: 90,
            permittedRange: {
                min: 60,
                max: 120,
            },
            increment: 10,
            observationWindowDays: 14,
            minCompletedExposures: 3,
            requiredFollowUpCoveragePct: 75,
            reviewCadenceDays: 14,
            reductionAlternative: {
                decrement: 10,
                trigger: 'adverse_response',
            },
        },
        title: 'Initial Build Phase Block',
        notes: 'Coaching note for athlete view',
    };

    const baseProfile: Pick<TrainingIntentProfile, 'priorities' | 'weeklyCommitment'> = {
        priorities: ['endurance', 'strength_muscle'],
        weeklyCommitment: {
            minSessions: 4,
            targetSessions: 6,
            maxSessions: 7,
        },
    };

    it('produces a deterministic SHA-256 hash regardless of object key order', async () => {
        const payload1 = buildTreatmentIntentReplayPayloadV1(baseBlock, baseProfile, 'external-plan@4');
        const hash1 = await hashTreatmentIntentReplayPayload(payload1);

        // Check canonical json serialization
        const json1 = canonicalizeTreatmentIntentJson(payload1);
        expect(json1).toContain('treatment_intent_replay_v1');

        // Reconstruct payload with scrambled top-level key insertion order
        const scrambledPayload: TreatmentIntentReplayPayloadV1 = {
            block: payload1.block,
            schemaVersion: payload1.schemaVersion,
            trainingIntentProfile: payload1.trainingIntentProfile,
            sourcePlanIdentity: payload1.sourcePlanIdentity,
        };
        const hash2 = await hashTreatmentIntentReplayPayload(scrambledPayload);

        expect(hash1).toHaveLength(64);
        expect(hash1).toBe(hash2);
        expect(await verifyTreatmentIntentReplayDigest(payload1, hash1)).toBe(true);
    });

    it('excludes display-only fields (title, notes) from replay digest', async () => {
        const payload1 = buildTreatmentIntentReplayPayloadV1(baseBlock, baseProfile, 'external-plan@4');
        const hash1 = await hashTreatmentIntentReplayPayload(payload1);

        const modifiedBlock: IntentBlock = {
            ...baseBlock,
            title: 'Changed Title completely for UI',
            notes: 'Completely altered coach notes that should not affect decision semantics',
        };
        const payload2 = buildTreatmentIntentReplayPayloadV1(modifiedBlock, baseProfile, 'external-plan@4');
        const hash2 = await hashTreatmentIntentReplayPayload(payload2);

        expect(hash1).toBe(hash2);
    });

    it('fails digest verification when TrainingIntentProfile priorities are mutated', async () => {
        const payload = buildTreatmentIntentReplayPayloadV1(baseBlock, baseProfile, 'external-plan@4');
        const baseHash = await hashTreatmentIntentReplayPayload(payload);

        const mutatedProfile = {
            ...baseProfile,
            priorities: ['health', 'endurance'] as TrainingPriority[],
        };
        const mutatedPayload = buildTreatmentIntentReplayPayloadV1(baseBlock, mutatedProfile, 'external-plan@4');
        const mutatedHash = await hashTreatmentIntentReplayPayload(mutatedPayload);

        expect(mutatedHash).not.toBe(baseHash);
        expect(await verifyTreatmentIntentReplayDigest(mutatedPayload, baseHash)).toBe(false);
    });

    it('fails digest verification when weeklyCommitment fields are mutated independently', async () => {
        const payload = buildTreatmentIntentReplayPayloadV1(baseBlock, baseProfile, 'external-plan@4');
        const baseHash = await hashTreatmentIntentReplayPayload(payload);

        // Mutate minSessions
        const mutMin = buildTreatmentIntentReplayPayloadV1(
            baseBlock,
            { ...baseProfile, weeklyCommitment: { ...baseProfile.weeklyCommitment, minSessions: 5 } },
            'external-plan@4',
        );
        expect(await hashTreatmentIntentReplayPayload(mutMin)).not.toBe(baseHash);

        // Mutate targetSessions
        const mutTarget = buildTreatmentIntentReplayPayloadV1(
            baseBlock,
            { ...baseProfile, weeklyCommitment: { ...baseProfile.weeklyCommitment, targetSessions: 5 } },
            'external-plan@4',
        );
        expect(await hashTreatmentIntentReplayPayload(mutTarget)).not.toBe(baseHash);

        // Mutate maxSessions
        const mutMax = buildTreatmentIntentReplayPayloadV1(
            baseBlock,
            { ...baseProfile, weeklyCommitment: { ...baseProfile.weeklyCommitment, maxSessions: 8 } },
            'external-plan@4',
        );
        expect(await hashTreatmentIntentReplayPayload(mutMax)).not.toBe(baseHash);
    });

    it('fails digest verification when objective intent (develop vs maintain) is mutated', async () => {
        const payload = buildTreatmentIntentReplayPayloadV1(baseBlock, baseProfile, 'external-plan@4');
        const baseHash = await hashTreatmentIntentReplayPayload(payload);

        const mutatedBlock: IntentBlock = {
            ...baseBlock,
            objectives: [
                { ...baseBlock.objectives[0], intent: 'maintain' },
                baseBlock.objectives[1],
            ],
        };
        const mutatedPayload = buildTreatmentIntentReplayPayloadV1(mutatedBlock, baseProfile, 'external-plan@4');
        expect(await hashTreatmentIntentReplayPayload(mutatedPayload)).not.toBe(baseHash);
    });

    it('fails digest verification when dose bounds or floor semantics are mutated', async () => {
        const payload = buildTreatmentIntentReplayPayloadV1(baseBlock, baseProfile, 'external-plan@4');
        const baseHash = await hashTreatmentIntentReplayPayload(payload);

        const mutatedBlock: IntentBlock = {
            ...baseBlock,
            objectives: [
                {
                    ...baseBlock.objectives[0],
                    doseEnvelope: { ...baseBlock.objectives[0].doseEnvelope, min: 75 },
                },
                baseBlock.objectives[1],
            ],
        };
        const mutatedPayload = buildTreatmentIntentReplayPayloadV1(mutatedBlock, baseProfile, 'external-plan@4');
        expect(await hashTreatmentIntentReplayPayload(mutatedPayload)).not.toBe(baseHash);
    });

    it('fails digest verification when progression contract fields are mutated', async () => {
        const payload = buildTreatmentIntentReplayPayloadV1(baseBlock, baseProfile, 'external-plan@4');
        const baseHash = await hashTreatmentIntentReplayPayload(payload);

        // Mutate increment
        const mutatedIncrement: IntentBlock = {
            ...baseBlock,
            progressionContract: { ...baseBlock.progressionContract!, increment: 15 },
        };
        expect(await hashTreatmentIntentReplayPayload(
            buildTreatmentIntentReplayPayloadV1(mutatedIncrement, baseProfile, 'external-plan@4'),
        )).not.toBe(baseHash);

        // Mutate currentValue
        const mutatedCurrentVal: IntentBlock = {
            ...baseBlock,
            progressionContract: { ...baseBlock.progressionContract!, currentValue: 100 },
        };
        expect(await hashTreatmentIntentReplayPayload(
            buildTreatmentIntentReplayPayloadV1(mutatedCurrentVal, baseProfile, 'external-plan@4'),
        )).not.toBe(baseHash);

        // Mutate permitted range
        const mutatedRange: IntentBlock = {
            ...baseBlock,
            progressionContract: { ...baseBlock.progressionContract!, permittedRange: { min: 60, max: 130 } },
        };
        expect(await hashTreatmentIntentReplayPayload(
            buildTreatmentIntentReplayPayloadV1(mutatedRange, baseProfile, 'external-plan@4'),
        )).not.toBe(baseHash);
    });
});
