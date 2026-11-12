/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, deleteDoc, writeBatch, updateDoc } from 'firebase/firestore';

const emulatorDescribe = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
let testEnvironment: RulesTestEnvironment;

const ownerId = 'athlete-a';
const otherUserId = 'athlete-b';
const recommendationPath = `users/${ownerId}/daily_recommendations/2026-08-07`;
const fixedActivityPath = `users/${ownerId}/fixed_activities/activity-1`;
const scheduleWindowPath = `users/${ownerId}/schedule_window_manifests/2026-09-10`;
const planBlockPath = `users/${ownerId}/plan_blocks/trip-august`;
const trainingIntentProfilePath = `users/${ownerId}/training_intent/profile`;
const preferencesPath = `users/${ownerId}/preferences/profile`;
const goalPath = `users/${ownerId}/goals/goal-1`;
const externalPlanPath = `users/${ownerId}/external_plans/autumn-block`;
const externalRevisionPath = `${externalPlanPath}/revisions/1`;
const externalPlacementPath = `${externalPlanPath}/placement/current`;
const externalActivationPath = `${externalPlanPath}/activations/1`;
const intentBlockPath = `users/${ownerId}/intent_blocks/block_1`;
const intentBlockRevisionPath = `${intentBlockPath}/revisions/1`;
const decisionJournalPath = `users/${ownerId}/decision_journal/2026-08-07`;
const checkinPath = `users/${ownerId}/daily_subjective_checkins/2026-08-18`;

function validExternalPlanHeader() {
    return {
        userId: ownerId, planId: 'autumn-block', revision: 1, title: '4-week block',
        startDate: '2026-08-17', weekCount: 4,
        contentHash: 'a'.repeat(64),
        importedAt: '2026-08-15T06:00:00Z', supersededFrom: null, updatedAt: '2026-08-15T06:00:00Z',
    };
}

function validExternalPlanRevision() {
    return {
        schema: 'adaptive-training-recommender/external-plan@1',
        planId: 'autumn-block', revision: 1, title: '4-week block',
        startDate: '2026-08-17', weekCount: 4,
        sessions: [{ id: 'w1-a', title: 'Threshold', priority: 'key' }],
    };
}

/** ADR-0035. */
function validExternalPlanRevisionV3() {
    return {
        ...validExternalPlanRevision(),
        schema: 'adaptive-training-recommender/external-plan@3',
        restDays: [{ id: 'w1-fri-rest', week: 1, day: 'friday' }],
    };
}

function validExternalPlacement() {
    return {
        userId: ownerId, planId: 'autumn-block', revision: 1,
        assignments: [{ sessionId: 'w1-a', date: '2026-08-18', status: 'planned' }],
        updatedAt: '2026-08-15T06:00:00Z',
    };
}

function validExternalActivation() {
    return {
        userId: ownerId, planId: 'autumn-block', revision: 1, contentHash: 'a'.repeat(64),
        effectiveFrom: '2026-08-17', activatedAt: '2026-08-15T06:00:00Z',
    };
}

function validIntentBlockHeader() {
    return {
        userId: ownerId, blockId: 'block_1', revision: 1,
        contentHash: 'a'.repeat(64),
        sourcePlanId: 'block_1', sourcePlanRevision: 1,
        createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z',
    };
}

/** Rules only check top-level shape (see hasValidIntentBlockRevision's own comment) --
 * `block`/`pinnedTrainingIntentProfile` need only be maps, not a fully valid IntentBlock. */
function validIntentBlockRevision() {
    return {
        userId: ownerId, blockId: 'block_1', revision: 1,
        block: { id: 'block_1', revision: 1, objectives: [] },
        pinnedTrainingIntentProfile: { priorities: ['balanced_performance'], weeklyCommitment: { minSessions: 3, targetSessions: 4, maxSessions: 5 } },
        sourceSchemaVersion: 'manual-intent-block-v1', sourceRef: null,
        contentHash: 'a'.repeat(64),
        createdAt: '2026-09-01T00:00:00Z',
    };
}

function validGoal() {
    return {
        userId: ownerId, title: 'Road race', targetDate: '2026-09-13', eventCategory: 'cycling_event',
        taper: { startDate: '2026-09-07' }, createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z',
    };
}

function validFixedActivity() {
    return {
        userId: ownerId,
        title: 'Evening Football',
        date: '2026-08-12',
        durationMin: 90,
        fixed: true,
        environment: 'outdoor',
        equipment: ['cleats'],
        expectedStimulus: { aerobicEndurance: 0.6, repeatedSurges: 0.4 },
        expectedCost: { systemic: 0.8, lowerBody: 0.5 },
        isCompleted: false,
        createdAt: '2026-08-01T00:00:00Z',
        updatedAt: '2026-08-01T00:00:00Z',
    };
}

function validPlanBlock() {
    return {
        userId: ownerId, eventId: 'road-race', phase: 'travel', startDate: '2026-08-19', endDate: '2026-08-22',
        volumeScale: 0.6, intensityScale: 0.5,
        createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z',
    };
}

function validTrainingIntentProfile() {
    return {
        userId: ownerId, planningMode: 'evergreen', priorities: ['health'],
        weeklyCommitment: { minSessions: 2, targetSessions: 3, maxSessions: 4 },
        organizationPreference: 'auto', schemaVersion: 1,
        createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z',
    };
}

function validPreferences() {
    return {
        userId: ownerId, unavailableModalities: ['Cycling'],
        createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z',
    };
}

function validDecisionJournalEntry() {
    return {
        userId: ownerId, date: '2026-08-07',
        externalVerdict: 'proceed', sawEngineVerdictFirst: false,
        createdAt: '2026-08-07T06:00:00Z', updatedAt: '2026-08-07T06:00:00Z',
        schemaVersion: 1,
    };
}

function validCheckinWithSessionResponse() {
    return {
        userId: ownerId,
        date: '2026-08-18',
        readiness: 6,
        sleepQuality: 6,
        fatigue: 4,
        soreness: 3,
        mentalStress: 4,
        motivation: 6,
        painOrInjury: false,
        illnessSymptoms: false,
        unusuallyLimitedTime: false,
        alreadyTrainedToday: false,
        availability: { timeAvailableMin: 45, preferredModalityToday: null, indoorOnly: false },
        tissueResponses: {
            knee: {
                region: 'knee',
                morningState: 'normal',
                nextMorningReaction: 'normal',
                sourceSessionRef: { kind: 'strength', id: 'session-1', date: '2026-08-17' },
            },
        },
        createdAt: '2026-08-18T06:00:00Z',
        updatedAt: '2026-08-18T06:00:00Z',
    };
}

function validStrengthSession(sessionId = 'session-1') {
    return {
        userId: ownerId, sessionId, date: '2026-08-17',
        startedAt: '2026-08-17T18:00:00Z', updatedAt: '2026-08-17T18:00:00Z',
        state: 'in_progress',
        // Rules bound array length and top-level shape only (S1.3): nested per-set fields
        // like weightKg/reps/gauge are not, and cannot be, validated element-wise here --
        // see the comment on hasValidStrengthSession. Emulator coverage below reflects that.
        exercises: [{ exerciseId: 'hang_power_clean', sets: [{ setIndex: 1, reps: 3, weightKg: 80, isWarmup: false, completedAt: '2026-08-17T18:02:00Z' }] }],
        schemaVersion: 1,
    };
}

function validRecommendation(auditEvaluatedAt = '2026-08-07T08:00:00Z') {
    return {
        userId: ownerId,
        date: '2026-08-07',
        templateId: 'easy_01',
        templateTitle: 'Easy Ride',
        category: 'Easy Endurance',
        modality: 'Cycling',
        mode: 'train',
        rationale: 'A compact rationale.',
        schemaVersion: 3,
        createdAt: '2026-08-07T08:00:00Z',
        updatedAt: '2026-08-07T08:00:00Z',
        adherence: {
            respondedAt: null,
            followed: null,
            actualModality: null,
            actualDurationMin: null,
            skipped: false,
            notes: null,
        },
        recommendationAudit: {
            policyVersion: '2026-08-decision-provenance-v1',
            evaluatedAt: auditEvaluatedAt,
            decisionContextRevision: 'history-v1:2026-08-07:7:none:none',
            safetyStatus: 'complete',
            history: {
                completedEventCount: 0,
                unmatchedEventCount: 0,
                sourceStatuses: { activities: 'AVAILABLE', recommendations: 'AVAILABLE', manualTraining: 'MISSING' },
            },
            envelope: { safetyRestrictedModalityCount: 0, planMaxAllowableTier: 'Easy' },
            candidateScores: [] as unknown[],
        } as Record<string, unknown>,
    };
}

function validIdentityAssessment() {
    return {
        id: 'identity-assessment-1',
        automaticStatus: 'UNCERTAIN',
        policyVersion: 'identity-v1-shadow',
        featureSchemaVersion: 'identity-features-v1',
        passportVersion: '2026-08-07.1',
        reasonCodes: ['SESSION_TIMING_DISCORDANT'],
        sharedBundleRef: {
            id: '2026-08-07_eight_sleep_google_health',
            provider: 'eight_sleep', transport: 'google_health', revision: 2,
            sourcePayloadHash: 'sha256:shared', lineageKey: 'eight_sleep:pod-side:a',
        },
        anchorBundleRefs: [{
            id: '2026-08-07_garmin_garmin_direct',
            provider: 'garmin', transport: 'garmin_direct', revision: 1,
            sourcePayloadHash: 'sha256:anchor', lineageKey: 'garmin:device:athlete',
        }],
    };
}

function validIdentityDecision() {
    const assessment = validIdentityAssessment();
    return {
        identityAssessmentId: assessment.id,
        automaticStatus: assessment.automaticStatus,
        effectiveStatus: assessment.automaticStatus,
        reviewEventId: null,
        identityPolicyVersion: assessment.policyVersion,
        featureSchemaVersion: assessment.featureSchemaVersion,
        passportVersion: assessment.passportVersion,
        sharedBundleRef: assessment.sharedBundleRef,
        anchorBundleRefs: assessment.anchorBundleRefs,
        selectedEffectiveSource: { provider: 'garmin', transport: 'garmin_direct' },
        fallbackReason: 'SESSION_TIMING_DISCORDANT',
    };
}

emulatorDescribe('Injury history rules', () => {
    beforeAll(async () => {
        testEnvironment = await initializeTestEnvironment({ projectId: 'demo-injury-history', firestore: { rules: readFileSync('firestore.rules', 'utf8') } });
    });
    afterAll(async () => { await testEnvironment.cleanup(); });
    it('allows the owner to save dated active and resolved injuries and denies another user', async () => {
        const path = `users/${ownerId}/trainingSettings/profile`;
        const data = { userId: ownerId, schemaVersion: 3, createdAt: '2026-10-27',
            injuries: [{ severity: 'limit', createdAt: '2026-10-27' }],
            injuryHistory: [{ severity: 'monitor', resolvedAt: '2026-10-27' }] };
        const owner = testEnvironment.authenticatedContext(ownerId).firestore();
        const other = testEnvironment.authenticatedContext(otherUserId).firestore();
        await assertSucceeds(setDoc(doc(owner, path), data));
        await assertFails(getDoc(doc(other, path)));
        await assertFails(updateDoc(doc(other, path), { injuryHistory: [] }));
        await assertFails(updateDoc(doc(owner, path), { injuryHistory: 'invalid' }));
    });
});

emulatorDescribe('Firestore security rules', () => {
    beforeAll(async () => {
        testEnvironment = await initializeTestEnvironment({
            projectId: 'demo-adaptive-training',
            firestore: { rules: readFileSync('firestore.rules', 'utf8') },
        });
    });

    afterEach(async () => {
        await testEnvironment.clearFirestore();
    });

    afterAll(async () => {
        await testEnvironment.cleanup();
    });

    it('allows an owner to create a schema-v3 recommendation with a compact audit', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await expect(assertSucceeds(setDoc(doc(ownerDb, recommendationPath), validRecommendation()))).resolves.toBeUndefined();
    });

    it('accepts identity provenance only when it matches server-owned assessment evidence', async () => {
        await testEnvironment.withSecurityRulesDisabled(async context => {
            await setDoc(
                doc(context.firestore(), `users/${ownerId}/health_identity_assessments/identity-assessment-1`),
                validIdentityAssessment(),
            );
        });
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        const recommendation = validRecommendation();
        recommendation.recommendationAudit.identityDecision = validIdentityDecision();
        await assertSucceeds(setDoc(doc(ownerDb, recommendationPath), recommendation));

        await testEnvironment.clearFirestore();
        await testEnvironment.withSecurityRulesDisabled(async context => {
            await setDoc(
                doc(context.firestore(), `users/${ownerId}/health_identity_assessments/identity-assessment-1`),
                validIdentityAssessment(),
            );
        });
        const forged = validRecommendation();
        forged.recommendationAudit.identityDecision = {
            ...validIdentityDecision(), passportVersion: 'forged-passport',
        };
        await assertFails(setDoc(doc(ownerDb, recommendationPath), forged));

        await testEnvironment.clearFirestore();
        await testEnvironment.withSecurityRulesDisabled(async context => {
            await setDoc(
                doc(context.firestore(), `users/${ownerId}/health_identity_assessments/identity-assessment-1`),
                validIdentityAssessment(),
            );
        });
        const forgedBundle = validRecommendation();
        forgedBundle.recommendationAudit.identityDecision = {
            ...validIdentityDecision(),
            sharedBundleRef: { ...validIdentityDecision().sharedBundleRef, revision: 99 },
        };
        await assertFails(setDoc(doc(ownerDb, recommendationPath), forgedBundle));
    });

    it('accepts a valid exact engine verdict and rejects an unsupported one', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertSucceeds(setDoc(doc(ownerDb, recommendationPath), { ...validRecommendation(), engineVerdict: 'advisory' }));
        await testEnvironment.clearFirestore();
        await assertFails(setDoc(doc(ownerDb, recommendationPath), { ...validRecommendation(), engineVerdict: 'maybe' }));
    });

    it('rejects cross-user recommendation reads', async () => {
        await testEnvironment.withSecurityRulesDisabled(async context => {
            await setDoc(doc(context.firestore(), recommendationPath), validRecommendation());
        });
        const otherDb = testEnvironment.authenticatedContext(otherUserId).firestore();
        await assertFails(getDoc(doc(otherDb, recommendationPath)));
    });

    it('rejects client writes to backend-owned wearable collections', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertFails(setDoc(doc(ownerDb, `users/${ownerId}/activities/garmin-1`), { date: '2026-08-07' }));
        await assertFails(setDoc(doc(ownerDb, `users/${ownerId}/daily_recovery_snapshots/2026-08-07`), { date: '2026-08-07' }));
    });

    it('allows an owner to record a canonical check-in response linked to a strength session', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertSucceeds(setDoc(doc(ownerDb, checkinPath), validCheckinWithSessionResponse()));

        const otherDb = testEnvironment.authenticatedContext(otherUserId).firestore();
        await assertFails(setDoc(doc(otherDb, checkinPath), validCheckinWithSessionResponse(), { merge: true }));
    });

    it('allows a well-formed goal taper and rejects a malformed taper object', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertSucceeds(setDoc(doc(ownerDb, goalPath), validGoal()));
        await assertFails(setDoc(doc(ownerDb, `${goalPath}-bad`), { ...validGoal(), taper: { startDate: 123 } }));
    });

    it('allows a well-formed typed performanceTarget (ADR-0041) and rejects malformed shapes', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertSucceeds(setDoc(doc(ownerDb, `${goalPath}-perf-exercise`), {
            ...validGoal(),
            performanceTarget: {
                kind: 'performance_metric',
                metricId: 'strength_1rm_kg',
                subjectRef: { kind: 'exercise', exerciseId: 'conventional_deadlift' },
                targetValue: 220,
            },
        }));
        await assertSucceeds(setDoc(doc(ownerDb, `${goalPath}-perf-test`), {
            ...validGoal(),
            performanceTarget: {
                kind: 'performance_metric',
                metricId: 'sprint_elapsed_time_s',
                subjectRef: { kind: 'performance_test', performanceTestId: 'sprint_10m_standing-r1' },
                targetValue: 1.75,
            },
        }));
        await assertSucceeds(setDoc(doc(ownerDb, `${goalPath}-perf-null`), { ...validGoal(), performanceTarget: null }));

        await assertFails(setDoc(doc(ownerDb, `${goalPath}-perf-bad-kind`), {
            ...validGoal(), performanceTarget: { kind: 'wrong_kind', metricId: 'strength_1rm_kg', subjectRef: { kind: 'exercise', exerciseId: 'x' }, targetValue: 1 },
        }));
        await assertFails(setDoc(doc(ownerDb, `${goalPath}-perf-bad-value`), {
            ...validGoal(), performanceTarget: { kind: 'performance_metric', metricId: 'strength_1rm_kg', subjectRef: { kind: 'exercise', exerciseId: 'x' }, targetValue: '220' },
        }));
        await assertFails(setDoc(doc(ownerDb, `${goalPath}-perf-extra-key`), {
            ...validGoal(), performanceTarget: { kind: 'performance_metric', metricId: 'strength_1rm_kg', subjectRef: { kind: 'exercise', exerciseId: 'x' }, targetValue: 1, extra: 'nope' },
        }));
        await assertFails(setDoc(doc(ownerDb, `${goalPath}-perf-bad-subject`), {
            ...validGoal(), performanceTarget: { kind: 'performance_metric', metricId: 'strength_1rm_kg', subjectRef: { kind: 'exercise', exerciseId: 'x', extra: 'nope' }, targetValue: 1 },
        }));
    });

    it('rejects a recommendation whose user or date disagrees with its path', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertFails(setDoc(doc(ownerDb, recommendationPath), { ...validRecommendation(), date: '2026-08-08' }));
        await assertFails(setDoc(doc(ownerDb, recommendationPath), { ...validRecommendation(), userId: otherUserId }));
        await assertFails(setDoc(
            doc(ownerDb, `users/${otherUserId}/daily_recommendations/2026-08-07`),
            { ...validRecommendation(), userId: otherUserId },
        ));
    });

    it('accepts an audit carrying external plan provenance', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        const external = validRecommendation();
        external.recommendationAudit.externalPlan = {
            planId: 'autumn-block', revision: 2, sessionId: 'w1-threshold', contentHash: 'a'.repeat(64),
        };
        await assertSucceeds(setDoc(doc(ownerDb, recommendationPath), external));

    });

    it('accepts bounded athlete-evidence lineage and rejects an oversized lineage', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        const withEvidence = validRecommendation();
        (withEvidence.recommendationAudit as Record<string, unknown>).athleteEvidenceLineage = [{
            recordId: 'athlete-evidence-1',
            version: 1,
            domain: 'subjective_calibration',
            refinementType: 'calibrate_scalar',
            baseKnowledgeClaimId: 'readiness.objective_mode_thresholds',
        }];
        await assertSucceeds(setDoc(doc(ownerDb, recommendationPath), withEvidence));

        await testEnvironment.clearFirestore();
        const oversized = validRecommendation();
        (oversized.recommendationAudit as Record<string, unknown>).athleteEvidenceLineage = Array.from({ length: 17 }, (_, i) => ({
            recordId: `athlete-evidence-${i}`,
            version: 1,
            domain: 'subjective_calibration',
            refinementType: 'calibrate_scalar',
            baseKnowledgeClaimId: 'readiness.objective_mode_thresholds',
        }));
        await assertFails(setDoc(doc(ownerDb, recommendationPath), oversized));
    });

    it('accepts an audit carrying subjective-drift provenance', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        const withDrift = validRecommendation();
        withDrift.recommendationAudit.subjectiveDrift = {
            estimatorId: 'subjective-baseline-v1-mean-stdev-7-28',
            estimatorPolicyVersion: 'subjective-drift-score-v1-equal-weights-strain-z-cap',
            historyThroughDateExclusive: '2026-08-07',
            recentRecordedDays: 7,
            longRecordedDays: 28,
            contribution: 1.2,
            perMetricContributions: { readiness: 0.2, sleepQuality: 0.2, fatigue: 0.2, soreness: 0.2, mentalStress: 0.2, motivation: 0.2 },
            decisionRelevant: true,
        };
        await assertSucceeds(setDoc(doc(ownerDb, recommendationPath), withDrift));

    });

    it('rejects a v3 recommendation with a malformed audit', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        const malformed = validRecommendation();
        (malformed.recommendationAudit.history as { sourceStatuses: Record<string, string> }).sourceStatuses.activities = 'FORGED';
        await assertFails(setDoc(doc(ownerDb, recommendationPath), malformed));
    });

    it('rejects updating decision fields without a batch archive write of the prior revision', async () => {
        await testEnvironment.withSecurityRulesDisabled(async context => {
            await setDoc(doc(context.firestore(), recommendationPath), { ...validRecommendation(), revision: 1 });
        });
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertFails(setDoc(doc(ownerDb, recommendationPath), {
            ...validRecommendation(),
            templateId: 'hard_01',
            revision: 2,
        }, { merge: true }));
    });

    it('rejects adding a prescription without incrementing the revision and archiving the prior decision', async () => {
        await testEnvironment.withSecurityRulesDisabled(async context => {
            await setDoc(doc(context.firestore(), recommendationPath), { ...validRecommendation(), revision: 1 });
        });
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertFails(setDoc(doc(ownerDb, recommendationPath), {
            prescription: { workoutId: 'easy_ride', displayBlocks: [] },
        }, { merge: true }));
    });

    it('rejects decision update when archived prior revision fields are mismatched', async () => {
        await testEnvironment.withSecurityRulesDisabled(async context => {
            await setDoc(doc(context.firestore(), recommendationPath), { ...validRecommendation(), revision: 1 });
        });
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        const batch = ownerDb.batch();
        batch.set(doc(ownerDb, `${recommendationPath}/revisions/1`) as any, {
            revision: 1,
            templateId: 'FORGED_ID',
            templateTitle: 'Easy Ride',
            category: 'Easy Endurance',
            modality: 'Cycling',
            mode: 'train',
            rationale: 'A compact rationale.',
            // Carry the parent's exact audit so only the field under test can cause the denial (#940).
            recommendationAudit: validRecommendation().recommendationAudit,
        });
        batch.set(doc(ownerDb, recommendationPath) as any, {
            ...validRecommendation(),
            templateId: 'hard_01',
            revision: 2,
        }, { merge: true });

        await assertFails(batch.commit());
    });

    it('rejects decision update when archived scalar provenance is mismatched', async () => {
        await testEnvironment.withSecurityRulesDisabled(async context => {
            await setDoc(doc(context.firestore(), recommendationPath), { ...validRecommendation(), revision: 1 });
        });
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        const batch = ownerDb.batch();
        batch.set(doc(ownerDb, `${recommendationPath}/revisions/1`) as any, {
            revision: 1,
            templateId: 'easy_01',
            templateTitle: 'Easy Ride',
            category: 'FORGED_CATEGORY',
            modality: 'Cycling',
            mode: 'train',
            rationale: 'A compact rationale.',
            // Carry the parent's exact audit so only the field under test can cause the denial (#940).
            recommendationAudit: validRecommendation().recommendationAudit,
        });
        batch.set(doc(ownerDb, recommendationPath) as any, {
            ...validRecommendation('2026-08-07T09:30:00Z'),
            templateId: 'hard_01',
            revision: 2,
        }, { merge: true });

        await assertFails(batch.commit());
    });

    it('rejects a malformed changed scalar even when the archive and revision transition are otherwise valid', async () => {
        await testEnvironment.withSecurityRulesDisabled(async context => {
            await setDoc(doc(context.firestore(), recommendationPath), { ...validRecommendation(), revision: 1 });
        });
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        const batch = ownerDb.batch();
        batch.set(doc(ownerDb, `${recommendationPath}/revisions/1`) as any, {
            revision: 1,
            templateId: 'easy_01',
            templateTitle: 'Easy Ride',
            category: 'Easy Endurance',
            modality: 'Cycling',
            mode: 'train',
            rationale: 'A compact rationale.',
            // Carry the parent's exact audit so only the field under test can cause the denial (#940).
            recommendationAudit: validRecommendation().recommendationAudit,
        });
        batch.set(doc(ownerDb, recommendationPath) as any, {
            ...validRecommendation('2026-08-07T09:30:00Z'),
            templateTitle: 42,
            revision: 2,
        }, { merge: true });

        await assertFails(batch.commit());
    });

    it('accepts a decision change for a legacy parent without a revision field (#940)', async () => {
        const legacy = validRecommendation() as Record<string, unknown>;
        delete legacy.revision;
        await testEnvironment.withSecurityRulesDisabled(async context => {
            await setDoc(doc(context.firestore(), recommendationPath), legacy);
        });
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        const batch = ownerDb.batch();
        batch.set(doc(ownerDb, `${recommendationPath}/revisions/1`) as any, {
            revision: 1,
            templateId: 'easy_01',
            templateTitle: 'Easy Ride',
            category: 'Easy Endurance',
            modality: 'Cycling',
            mode: 'train',
            rationale: 'A compact rationale.',
            recommendationAudit: validRecommendation().recommendationAudit,
        });
        batch.set(doc(ownerDb, recommendationPath) as any, {
            ...validRecommendation(),
            templateId: 'hard_01',
            revision: 2,
        }, { merge: true });

        await assertSucceeds(batch.commit());
    });

    it('rejects decision update with non-incrementing revision number', async () => {
        await testEnvironment.withSecurityRulesDisabled(async context => {
            await setDoc(doc(context.firestore(), recommendationPath), { ...validRecommendation(), revision: 1 });
        });
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        const batch = ownerDb.batch();
        batch.set(doc(ownerDb, `${recommendationPath}/revisions/1`) as any, {
            revision: 1,
            templateId: 'easy_01',
            templateTitle: 'Easy Ride',
            category: 'Easy Endurance',
            modality: 'Cycling',
            mode: 'train',
            rationale: 'A compact rationale.',
            // Carry the parent's exact audit so only the field under test can cause the denial (#940).
            recommendationAudit: validRecommendation().recommendationAudit,
        });
        batch.set(doc(ownerDb, recommendationPath) as any, {
            ...validRecommendation(),
            templateId: 'hard_01',
            revision: 5,
        }, { merge: true });

        await assertFails(batch.commit());
    });

    it('rejects update or delete of an existing revision document in subcollection', async () => {
        await testEnvironment.withSecurityRulesDisabled(async context => {
            await setDoc(doc(context.firestore(), `${recommendationPath}/revisions/1`), {
                revision: 1, templateId: 'easy_01', templateTitle: 'Easy Ride', category: 'Easy Endurance', modality: 'Cycling', mode: 'train', rationale: 'r',
            });
        });
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertFails(setDoc(doc(ownerDb, `${recommendationPath}/revisions/1`), { templateId: 'tampered' }, { merge: true }));
    });

    it('rejects schemaVersion downgrade from 3 to 1', async () => {
        await testEnvironment.withSecurityRulesDisabled(async context => {
            await setDoc(doc(context.firestore(), recommendationPath), { ...validRecommendation(), schemaVersion: 3 });
        });
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertFails(setDoc(doc(ownerDb, recommendationPath), { ...validRecommendation(), schemaVersion: 1 }, { merge: true }));
    });

    it('allows decision update with valid atomic batch archive write and a genuinely new audit', async () => {
        await testEnvironment.withSecurityRulesDisabled(async context => {
            await setDoc(doc(context.firestore(), recommendationPath), { ...validRecommendation('2026-08-07T08:00:00Z'), revision: 1 });
        });
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        const batch = ownerDb.batch();
        batch.set(doc(ownerDb, `${recommendationPath}/revisions/1`) as any, {
            revision: 1,
            templateId: 'easy_01',
            templateTitle: 'Easy Ride',
            category: 'Easy Endurance',
            modality: 'Cycling',
            mode: 'train',
            rationale: 'A compact rationale.',
            recommendationAudit: validRecommendation('2026-08-07T08:00:00Z').recommendationAudit,
        });
        batch.set(doc(ownerDb, recommendationPath) as any, {
            ...validRecommendation('2026-08-07T09:30:00Z'),
            templateId: 'hard_01',
            templateTitle: 'Hard Ride',
            revision: 2,
        }, { merge: true });

        await expect(assertSucceeds(batch.commit())).resolves.toBeUndefined();
    });

    it('allows re-saving the same decision later with the original audit preserved unchanged', async () => {
        const original = validRecommendation('2026-08-07T08:00:00Z');
        await testEnvironment.withSecurityRulesDisabled(async context => {
            await setDoc(doc(context.firestore(), recommendationPath), { ...original, revision: 1 });
        });
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await expect(assertSucceeds(
            setDoc(doc(ownerDb, recommendationPath), { ...original, revision: 1 }, { merge: true }),
        )).resolves.toBeUndefined();
    });

    it('allows an adherence-only merge on a revisioned v3 recommendation with nested decision evidence', async () => {
        const original = {
            ...validRecommendation('2026-08-07T08:00:00Z'),
            revision: 1,
            prescription: {
                id: '2026-08-07_easy_ride_default',
                workoutId: 'easy_ride',
                displayBlocks: [{ id: 'main', steps: [{ id: 'easy', targets: ['RPE 3'] }] }],
            },
        };
        original.recommendationAudit.plannedDose = { volume: 1, intensity: 1.1 };
        original.recommendationAudit.executionDose = { volume: 1, intensity: 1.1 };
        original.recommendationAudit.candidateScores = [{
            templateId: 'easy_01', utilityScore: 1, excludedReasons: [], benefitScore: 1, costPenalty: 0,
        }];
        original.recommendationAudit.droppedContributorObjectives = [];

        await testEnvironment.withSecurityRulesDisabled(async context => {
            await setDoc(doc(context.firestore(), recommendationPath), original);
        });

        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        const answeredAdherence = {
            respondedAt: '2026-08-08T07:00:00Z',
            followed: true,
            actualModality: null,
            actualDurationMin: null,
            skipped: false,
            notes: null,
        };
        await expect(assertSucceeds(setDoc(
            doc(ownerDb, recommendationPath),
            { adherence: answeredAdherence },
            { merge: true },
        ))).resolves.toBeUndefined();

        const stored = await getDoc(doc(ownerDb, recommendationPath));
        expect(stored.data()?.adherence).toEqual(answeredAdherence);
        expect(stored.data()?.revision).toBe(1);
    });

    it('rejects a cross-user adherence-only merge', async () => {
        await testEnvironment.withSecurityRulesDisabled(async context => {
            await setDoc(doc(context.firestore(), recommendationPath), { ...validRecommendation(), revision: 1 });
        });

        const otherDb = testEnvironment.authenticatedContext(otherUserId).firestore();
        await assertFails(setDoc(doc(otherDb, recommendationPath), {
            adherence: {
                respondedAt: '2026-08-08T07:00:00Z',
                followed: true,
                actualModality: null,
                actualDurationMin: null,
                skipped: false,
                notes: null,
            },
        }, { merge: true }));
    });

    it('allows an owner to create and read a valid fixed activity', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await expect(assertSucceeds(setDoc(doc(ownerDb, fixedActivityPath), validFixedActivity()))).resolves.toBeUndefined();
        await expect(assertSucceeds(getDoc(doc(ownerDb, fixedActivityPath)))).resolves.toBeDefined();
    });

    it('rejects unauthenticated fixed activity access', async () => {
        const anonDb = testEnvironment.unauthenticatedContext().firestore();
        await assertFails(setDoc(doc(anonDb, fixedActivityPath), validFixedActivity()));
        await testEnvironment.withSecurityRulesDisabled(async context => {
            await setDoc(doc(context.firestore(), fixedActivityPath), validFixedActivity());
        });
        await assertFails(getDoc(doc(anonDb, fixedActivityPath)));
    });

    it('rejects cross-user fixed activity reads and writes', async () => {
        await testEnvironment.withSecurityRulesDisabled(async context => {
            await setDoc(doc(context.firestore(), fixedActivityPath), validFixedActivity());
        });
        const otherDb = testEnvironment.authenticatedContext(otherUserId).firestore();
        await assertFails(getDoc(doc(otherDb, fixedActivityPath)));
        await assertFails(setDoc(doc(otherDb, fixedActivityPath), validFixedActivity()));
        await assertFails(setDoc(doc(otherDb, `users/${otherUserId}/fixed_activities/activity-2`), { ...validFixedActivity(), userId: ownerId }));
    });

    // Issue #1202 (ADR-0053): fixed-activity VALUES (date, durationMin, flags, environment
    // enums, startTime, stimulus/cost axis values, availabilityOverride) are validated by
    // engine/validationCore.ts validateFixedActivity in FixedActivityService.createActivity and
    // updateActivity before every write -- see validation.test.ts and fixedActivityService.test.ts.
    // The rules keep ownership, the key allow-lists, the title/equipment/catalog-id caps and
    // the createdAt shape.
    it.each([
        ['a zero durationMin', { durationMin: 0 }],
        ['an over-long durationMin', { durationMin: 1500 }],
        ['an expectedCost value above 1', { expectedCost: { systemic: 1.5 } }],
        ['an expectedStimulus value above 1', { expectedStimulus: { aerobicEndurance: 1.5 } }],
        ['an unknown environment', { environment: 'space' }],
        ['an unknown availabilityContextOverride environment', { availabilityContextOverride: { environment: 'space' } }],
        ['a malformed date', { date: '08/12/2026' }],
        ['a calendar-impossible date', { date: '2026-02-30' }],
        ['a non-boolean isCompleted', { isCompleted: 'no' }],
        ['an out-of-range availabilityOverride', { availabilityOverride: 1500 }],
    ])('accepts a fixed activity with %s at the rules boundary (validateFixedActivity owns it)', async (_label, override) => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertSucceeds(setDoc(doc(ownerDb, fixedActivityPath), { ...validFixedActivity(), ...override }));
    });

    it('rejects a fixed activity with an unknown stimulus or cost axis key, or a non-string createdAt', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertFails(setDoc(doc(ownerDb, fixedActivityPath), { ...validFixedActivity(), expectedStimulus: { notAnAxis: 0.5 } }));
        await assertFails(setDoc(doc(ownerDb, fixedActivityPath), { ...validFixedActivity(), expectedCost: { notAnAxis: 0.5 } }));
        await assertFails(setDoc(doc(ownerDb, fixedActivityPath), { ...validFixedActivity(), createdAt: 42 }));
    });

    it('rejects a fixed activity with an oversized equipment list', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertFails(setDoc(doc(ownerDb, fixedActivityPath), { ...validFixedActivity(), equipment: Array.from({ length: 21 }, (_, i) => `item-${i}`) }));
    });

    it('rejects a fixed activity with a non-string or oversized equipment item', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertFails(setDoc(doc(ownerDb, fixedActivityPath), { ...validFixedActivity(), equipment: [42] }));
        await assertFails(setDoc(doc(ownerDb, fixedActivityPath), { ...validFixedActivity(), equipment: ['x'.repeat(51)] }));
    });

    it('allows a fixed activity with a valid availabilityContextOverride (Phase 6.2b / D6-B)', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await expect(assertSucceeds(setDoc(doc(ownerDb, fixedActivityPath), {
            ...validFixedActivity(),
            availabilityContextOverride: { environment: 'indoor', equipment: ['indoor_bike'] },
        }))).resolves.toBeUndefined();
    });

    it('rejects a fixed activity with an unrecognized key inside availabilityContextOverride', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertFails(setDoc(doc(ownerDb, fixedActivityPath), {
            ...validFixedActivity(),
            availabilityContextOverride: { environment: 'indoor', extra: true },
        }));
    });

    // ADR-0036 D-WINDOW: one authoritative same-date manifest.
    function validScheduleWindow() {
        return {
            userId: ownerId,
            date: '2026-09-10',
            revision: 1,
            windows: [{
                id: 'window-1',
                userId: ownerId,
                date: '2026-09-10',
                startLocal: '06:00',
                endLocal: '07:00',
                revision: 1,
                createdAt: '2026-09-01T00:00:00Z',
                updatedAt: '2026-09-01T00:00:00Z',
            }],
            createdAt: '2026-09-01T00:00:00Z',
            updatedAt: '2026-09-01T00:00:00Z',
        };
    }

    it('allows an owner to create a valid schedule window', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await expect(assertSucceeds(setDoc(doc(ownerDb, scheduleWindowPath), validScheduleWindow()))).resolves.toBeUndefined();
    });

    it('allows an owner update that bumps revision and preserves createdAt', async () => {
        await testEnvironment.withSecurityRulesDisabled(async context => {
            await setDoc(doc(context.firestore(), scheduleWindowPath), validScheduleWindow());
        });
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        const updated = validScheduleWindow();
        updated.revision = 2;
        updated.updatedAt = '2026-09-02T00:00:00Z';
        updated.windows[0] = { ...updated.windows[0], endLocal: '07:30', revision: 2, updatedAt: '2026-09-02T00:00:00Z' };
        await expect(assertSucceeds(setDoc(doc(ownerDb, scheduleWindowPath), {
            ...updated,
        }))).resolves.toBeUndefined();
    });

    it('rejects an update that does not bump revision', async () => {
        await testEnvironment.withSecurityRulesDisabled(async context => {
            await setDoc(doc(context.firestore(), scheduleWindowPath), validScheduleWindow());
        });
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertFails(setDoc(doc(ownerDb, scheduleWindowPath), { ...validScheduleWindow(), endLocal: '07:30' }));
    });

    it('rejects an update that changes createdAt', async () => {
        await testEnvironment.withSecurityRulesDisabled(async context => {
            await setDoc(doc(context.firestore(), scheduleWindowPath), validScheduleWindow());
        });
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertFails(setDoc(doc(ownerDb, scheduleWindowPath), { ...validScheduleWindow(), revision: 2, createdAt: '2026-09-05T00:00:00Z' }));
    });

    /** The manifest with its single window's fields overridden, so a test reaches the
     * nested entry check rather than the manifest-level key allow-list. */
    function scheduleWindowWith(windowOverride: Record<string, unknown>) {
        const manifest = validScheduleWindow();
        return { ...manifest, windows: [{ ...manifest.windows[0], ...windowOverride }] };
    }

    it('rejects window fields placed at the manifest level', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertFails(setDoc(doc(ownerDb, scheduleWindowPath), { ...validScheduleWindow(), startLocal: '07:00' }));
        await assertFails(setDoc(doc(ownerDb, scheduleWindowPath), { ...validScheduleWindow(), environment: 'indoor' }));
    });

    // Issue #1202 (ADR-0053): the positive duration, the environment enum and the
    // per-window revision are validated by engine/scheduleWindows.ts validateScheduleWindow
    // (via validateScheduleWindowManifest) in ScheduleWindowService.buildManifest before every
    // write -- see scheduleWindows.test.ts.
    it.each([
        ['a zero-length window', { startLocal: '07:00', endLocal: '07:00' }],
        ['a cross-midnight window', { startLocal: '22:00', endLocal: '02:00' }],
        ['an unknown environment', { environment: 'space' }],
        ['a zero window revision', { revision: 0 }],
    ])('accepts %s at the rules boundary (validateScheduleWindow owns it)', async (_label, windowOverride) => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertSucceeds(setDoc(doc(ownerDb, scheduleWindowPath), scheduleWindowWith(windowOverride)));
    });

    // The HH:mm pattern stays: the overlap check compares the times as strings.
    it('rejects a malformed startLocal/endLocal', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertFails(setDoc(doc(ownerDb, scheduleWindowPath), scheduleWindowWith({ startLocal: '6:00' })));
        await assertFails(setDoc(doc(ownerDb, scheduleWindowPath), scheduleWindowWith({ endLocal: '24:00' })));
    });

    it('rejects a schedule window with an oversized label', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertFails(setDoc(doc(ownerDb, scheduleWindowPath), scheduleWindowWith({ label: 'x'.repeat(101) })));
    });

    it('rejects a schedule window with a non-string or oversized equipment item', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertFails(setDoc(doc(ownerDb, scheduleWindowPath), scheduleWindowWith({ equipment: [42] })));
        await assertFails(setDoc(doc(ownerDb, scheduleWindowPath), scheduleWindowWith({ equipment: ['x'.repeat(51)] })));
    });

    it('rejects a window bound to another user or date', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertFails(setDoc(doc(ownerDb, scheduleWindowPath), scheduleWindowWith({ userId: otherUserId })));
        await assertFails(setDoc(doc(ownerDb, scheduleWindowPath), scheduleWindowWith({ date: '2026-09-11' })));
    });

    it('rejects unauthenticated schedule window access', async () => {
        const anonDb = testEnvironment.unauthenticatedContext().firestore();
        await assertFails(setDoc(doc(anonDb, scheduleWindowPath), validScheduleWindow()));
        await testEnvironment.withSecurityRulesDisabled(async context => {
            await setDoc(doc(context.firestore(), scheduleWindowPath), validScheduleWindow());
        });
        await assertFails(getDoc(doc(anonDb, scheduleWindowPath)));
    });

    it('rejects cross-user schedule window reads and writes', async () => {
        await testEnvironment.withSecurityRulesDisabled(async context => {
            await setDoc(doc(context.firestore(), scheduleWindowPath), validScheduleWindow());
        });
        const otherDb = testEnvironment.authenticatedContext(otherUserId).firestore();
        await assertFails(getDoc(doc(otherDb, scheduleWindowPath)));
        await assertFails(setDoc(doc(otherDb, scheduleWindowPath), validScheduleWindow()));
        await assertFails(setDoc(doc(otherDb, `users/${otherUserId}/schedule_windows/window-2`), { ...validScheduleWindow(), userId: ownerId }));
    });

    it('rejects a fixed activity missing the required fixed field', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        const withoutFixed: Record<string, unknown> = validFixedActivity();
        delete withoutFixed.fixed;
        await assertFails(setDoc(doc(ownerDb, fixedActivityPath), withoutFixed));
    });

    it('rejects updating a fixed activity that forges a different owner or createdAt', async () => {
        await testEnvironment.withSecurityRulesDisabled(async context => {
            await setDoc(doc(context.firestore(), fixedActivityPath), validFixedActivity());
        });
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertFails(setDoc(doc(ownerDb, fixedActivityPath), { ...validFixedActivity(), userId: otherUserId }, { merge: true }));
        await assertFails(setDoc(doc(ownerDb, fixedActivityPath), { ...validFixedActivity(), createdAt: '2099-01-01T00:00:00Z' }, { merge: true }));
    });

    it('allows an owner to update and delete their own fixed activity', async () => {
        await testEnvironment.withSecurityRulesDisabled(async context => {
            await setDoc(doc(context.firestore(), fixedActivityPath), validFixedActivity());
        });
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await expect(assertSucceeds(setDoc(doc(ownerDb, fixedActivityPath), { ...validFixedActivity(), isCompleted: true }, { merge: true }))).resolves.toBeUndefined();
        await expect(assertSucceeds(deleteDoc(doc(ownerDb, fixedActivityPath)))).resolves.toBeUndefined();
    });

    it('allows an owner to create a valid authored travel plan block and rejects unknown keys or forged timestamps', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await expect(assertSucceeds(setDoc(doc(ownerDb, planBlockPath), validPlanBlock()))).resolves.toBeUndefined();
        await assertFails(setDoc(doc(ownerDb, `${planBlockPath}-extra`), { ...validPlanBlock(), surprise: true }));
        await assertFails(setDoc(doc(ownerDb, `${planBlockPath}-created`), { ...validPlanBlock(), createdAt: 42 }));
        for (const key of ['phase', 'startDate', 'endDate', 'volumeScale', 'intensityScale']) {
            const missing: Record<string, unknown> = validPlanBlock();
            delete missing[key];
            await assertFails(setDoc(doc(ownerDb, `${planBlockPath}-missing-${key}`), missing));
        }
        const withoutEventId: Record<string, unknown> = validPlanBlock();
        delete withoutEventId.eventId;
        await assertSucceeds(setDoc(doc(ownerDb, `${planBlockPath}-no-event`), withoutEventId));
        await assertFails(setDoc(doc(ownerDb, planBlockPath), { ...validPlanBlock(), createdAt: '2099-01-01T00:00:00Z' }, { merge: true }));
    });

    // Issue #1202 (ADR-0053): plan-block VALUES (phase, dates and their order, scales,
    // eventId type) are validated by engine/validationCore.ts validateAuthoredPlanBlock in
    // PlanBlockService.create and update before every write -- see validation.test.ts.
    it.each([
        ['an inverted date range', { endDate: '2026-08-18' }],
        ['a calendar-impossible date', { startDate: '2026-02-30' }],
        ['an out-of-range intensityScale', { intensityScale: 1.1 }],
        ['an out-of-range volumeScale', { volumeScale: -0.1 }],
        ['a non-travel phase', { phase: 'taper' }],
    ])('accepts a plan block with %s at the rules boundary (validateAuthoredPlanBlock owns it)', async (_label, override) => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertSucceeds(setDoc(doc(ownerDb, planBlockPath), { ...validPlanBlock(), ...override }));
    });

    // --- Schedule overlays (hasValidScheduleOverlay) ---

    const scheduleOverlayPath = `users/${ownerId}/schedule_overlays/overlay-1`;

    function validScheduleOverlay() {
        return {
            userId: ownerId, title: 'Ski trip', category: 'active_sport', sport: 'skiing',
            startDate: '2026-12-20', endDate: '2026-12-27', dailyAvailabilityMinutes: 60,
            volumeScale: 0.5, intensityScale: 0.6,
            expectedCost: { systemic: 0.7, lowerBody: 0.85 },
            equipment: ['skis'], environment: 'outdoor', notes: 'Alps',
            createdAt: '2026-12-01T00:00:00Z', updatedAt: '2026-12-01T00:00:00Z',
        };
    }

    it('allows an owner to create, replace and delete a valid schedule overlay', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertSucceeds(setDoc(doc(ownerDb, scheduleOverlayPath), validScheduleOverlay()));
        await assertSucceeds(setDoc(doc(ownerDb, scheduleOverlayPath), { ...validScheduleOverlay(), title: 'Longer ski trip', updatedAt: '2026-12-02T00:00:00Z' }));
        await assertSucceeds(getDoc(doc(ownerDb, scheduleOverlayPath)));
        await assertSucceeds(deleteDoc(doc(ownerDb, scheduleOverlayPath)));
    });

    it('rejects cross-user schedule overlay access, forged ownership and a changed createdAt', async () => {
        await testEnvironment.withSecurityRulesDisabled(async context => {
            await setDoc(doc(context.firestore(), scheduleOverlayPath), validScheduleOverlay());
        });
        const otherDb = testEnvironment.authenticatedContext(otherUserId).firestore();
        await assertFails(getDoc(doc(otherDb, scheduleOverlayPath)));
        await assertFails(setDoc(doc(otherDb, scheduleOverlayPath), validScheduleOverlay()));
        await assertFails(setDoc(doc(otherDb, `users/${otherUserId}/schedule_overlays/forged`), validScheduleOverlay()));
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertFails(setDoc(doc(ownerDb, scheduleOverlayPath), { ...validScheduleOverlay(), createdAt: '2099-01-01T00:00:00Z' }));
    });

    it('rejects a schedule overlay with unknown or missing keys, or over a size cap', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        const withoutCost: Record<string, unknown> = validScheduleOverlay();
        delete withoutCost.expectedCost;
        await assertFails(setDoc(doc(ownerDb, scheduleOverlayPath), withoutCost));
        await assertFails(setDoc(doc(ownerDb, scheduleOverlayPath), { ...validScheduleOverlay(), surprise: true }));
        await assertFails(setDoc(doc(ownerDb, scheduleOverlayPath), { ...validScheduleOverlay(), expectedCost: { notAnAxis: 0.5 } }));
        await assertFails(setDoc(doc(ownerDb, scheduleOverlayPath), { ...validScheduleOverlay(), title: '' }));
        await assertFails(setDoc(doc(ownerDb, scheduleOverlayPath), { ...validScheduleOverlay(), title: 'x'.repeat(201) }));
        await assertFails(setDoc(doc(ownerDb, scheduleOverlayPath), { ...validScheduleOverlay(), notes: 'x'.repeat(1001) }));
        await assertFails(setDoc(doc(ownerDb, scheduleOverlayPath), { ...validScheduleOverlay(), equipment: ['x'.repeat(51)] }));
        await assertFails(setDoc(doc(ownerDb, scheduleOverlayPath), { ...validScheduleOverlay(), createdAt: 42 }));
    });

    // Issue #1202 (ADR-0053): overlay VALUES are validated by engine/validationCore.ts
    // validateScheduleOverlay (and whole minutes by assertWholeMinuteAvailability) in
    // ScheduleOverlayService.create and update before every write -- see
    // scheduleOverlayService.test.ts.
    it.each([
        ['an unknown category', { category: 'holiday' }],
        ['an unknown sport', { sport: 'curling' }],
        ['an inverted date range', { endDate: '2026-12-19' }],
        ['a calendar-impossible date', { startDate: '2026-02-30' }],
        ['fractional availability minutes', { dailyAvailabilityMinutes: 30.5 }],
        ['out-of-range availability minutes', { dailyAvailabilityMinutes: 1500 }],
        ['an out-of-range volumeScale', { volumeScale: 1.5 }],
        ['an out-of-range expectedCost value', { expectedCost: { systemic: 1.5 } }],
        ['an unknown environment', { environment: 'space' }],
    ])('accepts a schedule overlay with %s at the rules boundary (validateScheduleOverlay owns it)', async (_label, override) => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertSucceeds(setDoc(doc(ownerDb, scheduleOverlayPath), { ...validScheduleOverlay(), ...override }));
    });

    it('rejects cross-user authored plan block access and forged ownership', async () => {
        await testEnvironment.withSecurityRulesDisabled(async context => {
            await setDoc(doc(context.firestore(), planBlockPath), validPlanBlock());
        });
        const otherDb = testEnvironment.authenticatedContext(otherUserId).firestore();
        await assertFails(getDoc(doc(otherDb, planBlockPath)));
        await assertFails(setDoc(doc(otherDb, `users/${otherUserId}/plan_blocks/forged`), validPlanBlock()));
    });

    it('stores an external plan header, revision and placement for its owner', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertSucceeds(setDoc(doc(ownerDb, externalPlanPath), validExternalPlanHeader()));
        await assertSucceeds(setDoc(doc(ownerDb, externalRevisionPath), validExternalPlanRevision()));
        await assertSucceeds(setDoc(doc(ownerDb, externalPlacementPath), validExternalPlacement()));
    });

    it('accepts v6 reduced-definition revisions, revision-scoped placement and immutable activation records', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        const v6Path = `${externalPlanPath}/revisions/2`;
        await assertSucceeds(setDoc(doc(ownerDb, externalPlanPath), { ...validExternalPlanHeader(), revision: 2, supersededFrom: '2026-08-17' }));
        await assertSucceeds(setDoc(doc(ownerDb, v6Path), {
            schema: 'adaptive-training-recommender/external-plan@6',
            planId: 'autumn-block', revision: 2, title: '4-week block',
            startDate: '2026-08-17', weekCount: 4, sessions: [{ id: 'w1-a', title: 'Threshold' }],
            restDays: [], intentBlocks: [],
        }));
        const v6PlacementPath = `${v6Path}/placement/current`;
        const v6ActivationPath = `${externalPlanPath}/activations/2`;
        await assertSucceeds(setDoc(doc(ownerDb, v6PlacementPath), { ...validExternalPlacement(), revision: 2 }));
        await assertFails(setDoc(doc(ownerDb, v6ActivationPath), {
            ...validExternalActivation(), revision: 2, contentHash: 'b'.repeat(64),
        }));
        await assertSucceeds(setDoc(doc(ownerDb, v6ActivationPath), { ...validExternalActivation(), revision: 2 }));
        await assertSucceeds(getDoc(doc(ownerDb, v6ActivationPath)));
        await assertFails(setDoc(doc(ownerDb, v6ActivationPath), { ...validExternalActivation(), revision: 2 }));
        await assertFails(deleteDoc(doc(ownerDb, v6ActivationPath)));
        await assertFails(setDoc(doc(ownerDb, `${externalPlanPath}/activations/3`), {
            ...validExternalActivation(), revision: 3,
        }));
        await assertFails(setDoc(doc(ownerDb, `${externalPlanPath}/activations/2`), {
            ...validExternalActivation(), revision: 2, contentHash: 'z'.repeat(64),
        }));
        await assertFails(setDoc(doc(ownerDb, `${externalPlanPath}/revisions/3/placement/current`), {
            ...validExternalPlacement(), revision: 3,
        }));
    });

    it('makes an activation record create-only, so a stored effective date cannot be rewritten', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertSucceeds(setDoc(doc(ownerDb, externalPlanPath), validExternalPlanHeader()));
        await assertSucceeds(setDoc(doc(ownerDb, externalRevisionPath), validExternalPlanRevision()));
        await assertSucceeds(setDoc(doc(ownerDb, externalActivationPath), validExternalActivation()));
        // Same-bytes rewrite is still an update: denied. A changed effective date is
        // denied as well -- same-revision replays with a different date must fail closed
        // at the service layer, and rules never permit the mutation either.
        await assertFails(setDoc(doc(ownerDb, externalActivationPath), validExternalActivation()));
        await assertFails(setDoc(doc(ownerDb, externalActivationPath), { ...validExternalActivation(), effectiveFrom: '2026-08-20' }));
        await assertFails(updateDoc(doc(ownerDb, externalActivationPath), { effectiveFrom: '2026-08-20' }));
        await assertFails(deleteDoc(doc(ownerDb, externalActivationPath)));
        await assertSucceeds(getDoc(doc(ownerDb, externalActivationPath)));
    });

    it('allows only owner creation of immutable revision-scoped placement history', async () => {
        await testEnvironment.withSecurityRulesDisabled(async context => {
            await setDoc(doc(context.firestore(), externalRevisionPath), validExternalPlanRevision());
        });
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        const otherDb = testEnvironment.authenticatedContext(otherUserId).firestore();
        const path = `${externalPlanPath}/revisions/1/placement_history/event-1`;
        const event = { userId: ownerId, planId: 'autumn-block', revision: 1, changedOn: '2026-08-18',
            recordedAt: '2026-08-18T12:00:00.000Z', previous: [], assignments: [], successors: {} };
        await assertFails(setDoc(doc(otherDb, path), event));
        await assertFails(setDoc(doc(ownerDb, path), { ...event, revision: 2 }));
        await assertFails(setDoc(doc(ownerDb, path), { ...event, recordedAt: '2026-08-18T12:00:00Z' }));
        await assertFails(setDoc(doc(ownerDb, path), { ...event, successors: Object.fromEntries(Array.from({ length: 121 }, (_, i) => [String(i), {}])) }));
        await assertSucceeds(setDoc(doc(ownerDb, path), event));
        await assertSucceeds(getDoc(doc(ownerDb, path)));
        await assertFails(getDoc(doc(otherDb, path)));
        await assertFails(setDoc(doc(ownerDb, path), event));
        await assertFails(updateDoc(doc(ownerDb, path), { changedOn: '2026-08-19' }));
        await assertFails(deleteDoc(doc(ownerDb, path)));
    });

    it('accepts an invalid-prior marker on placement history only with empty previous assignments (#1172)', async () => {
        await testEnvironment.withSecurityRulesDisabled(async context => {
            await setDoc(doc(context.firestore(), externalRevisionPath), validExternalPlanRevision());
        });
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        const path = (id: string) => `${externalPlanPath}/revisions/1/placement_history/${id}`;
        const event = { userId: ownerId, planId: 'autumn-block', revision: 1, changedOn: '2026-08-18',
            recordedAt: '2026-08-18T12:00:00.000Z', previous: [], assignments: [], successors: {},
            previousState: 'invalid', previousStateReason: 'current-schema-invalid' };
        const assignment = { sessionId: 'a', date: '2026-08-18', status: 'planned' };
        await assertFails(setDoc(doc(ownerDb, path('fabricated')), { ...event, previous: [assignment] }));
        await assertFails(setDoc(doc(ownerDb, path('bad-state')), { ...event, previousState: 'valid' }));
        await assertFails(setDoc(doc(ownerDb, path('bad-reason')), { ...event, previousStateReason: 'made-up' }));
        const unmarked = { userId: ownerId, planId: 'autumn-block', revision: 1, changedOn: '2026-08-18',
            recordedAt: '2026-08-18T12:00:00.000Z', previous: [], assignments: [], successors: {} };
        await assertFails(setDoc(doc(ownerDb, path('no-reason')), { ...unmarked, previousState: 'invalid' }));
        await assertFails(setDoc(doc(ownerDb, path('reason-only')), { ...unmarked, previousStateReason: 'current-schema-invalid' }));
        await assertSucceeds(setDoc(doc(ownerDb, path('marked')), event));
    });

    it('denies cross-user and revision-mismatched revision-scoped placement writes', async () => {
        await testEnvironment.withSecurityRulesDisabled(async context => {
            const admin = context.firestore();
            await setDoc(doc(admin, externalPlanPath), validExternalPlanHeader());
            await setDoc(doc(admin, externalRevisionPath), validExternalPlanRevision());
            await setDoc(doc(admin, `${externalPlanPath}/revisions/2`), { ...validExternalPlanRevision(), revision: 2 });
        });
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        const otherDb = testEnvironment.authenticatedContext(otherUserId).firestore();
        const scopedPath = `${externalPlanPath}/revisions/1/placement/current`;
        // Owner writes bound to the owning revision succeed.
        await assertSucceeds(setDoc(doc(ownerDb, scopedPath), validExternalPlacement()));
        await assertSucceeds(setDoc(doc(ownerDb, scopedPath), { ...validExternalPlacement(), successors: { a: { revision: 2, sessionId: 'b' } } }));
        await assertFails(setDoc(doc(ownerDb, scopedPath), { ...validExternalPlacement(), successors: [] }));
        // A placement claiming another revision never lands under this revision's path:
        // historical revisions cannot consume another revision's overlay.
        await assertFails(setDoc(doc(ownerDb, scopedPath), { ...validExternalPlacement(), revision: 2 }));
        await assertFails(setDoc(doc(ownerDb, `${externalPlanPath}/revisions/2/placement/current`), { ...validExternalPlacement(), revision: 1 }));
        // Cross-user reads and writes on revision-scoped placement are denied.
        await assertFails(getDoc(doc(otherDb, scopedPath)));
        await assertFails(setDoc(doc(otherDb, scopedPath), validExternalPlacement()));
        await assertFails(setDoc(doc(otherDb, `users/${otherUserId}/external_plans/autumn-block/revisions/1/placement/current`), validExternalPlacement()));
    });

    it('accepts a provable legacy activation when the header omitted supersededFrom', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        const path = `users/${ownerId}/external_plans/legacy-plan`;
        const legacyHeader = { ...validExternalPlanHeader(), planId: 'legacy-plan' };
        delete (legacyHeader as { supersededFrom?: string | null }).supersededFrom;
        await assertSucceeds(setDoc(doc(ownerDb, path), legacyHeader));
        await assertSucceeds(setDoc(doc(ownerDb, `${path}/revisions/1`), {
            ...validExternalPlanRevision(), planId: 'legacy-plan',
        }));
        await assertSucceeds(setDoc(doc(ownerDb, `${path}/activations/1`), {
            ...validExternalActivation(), planId: 'legacy-plan',
        }));
    });

    it('stores a v2 external plan revision (M3.6) -- rules bound sessions but never deep-validate them either version', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertSucceeds(setDoc(doc(ownerDb, externalRevisionPath), {
            ...validExternalPlanRevision(),
            schema: 'adaptive-training-recommender/external-plan@2',
            sessions: [{ id: 'w1-a', title: 'Threshold', priority: 'key', definition: { schemaVersion: 1, title: 'Threshold', intent: 'training', blocks: [] } }],
        }));
    });

    it('makes a stored revision create-only, so an audited decision stays verifiable', async () => {
        await testEnvironment.withSecurityRulesDisabled(async context => {
            await setDoc(doc(context.firestore(), externalRevisionPath), validExternalPlanRevision());
        });
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertFails(setDoc(doc(ownerDb, externalRevisionPath), { ...validExternalPlanRevision(), title: 'edited' }));
        await assertFails(deleteDoc(doc(ownerDb, externalRevisionPath)));
        await assertSucceeds(getDoc(doc(ownerDb, externalRevisionPath)));
    });

    it('refuses an external plan header that moves backwards to a superseded revision', async () => {
        await testEnvironment.withSecurityRulesDisabled(async context => {
            await setDoc(doc(context.firestore(), externalPlanPath), { ...validExternalPlanHeader(), revision: 3 });
        });
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertFails(setDoc(doc(ownerDb, externalPlanPath), { ...validExternalPlanHeader(), revision: 2 }));
        await assertSucceeds(setDoc(doc(ownerDb, externalPlanPath), { ...validExternalPlanHeader(), revision: 4 }));
    });

    it('rejects a malformed external plan header and an over-large revision', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertFails(setDoc(doc(ownerDb, externalPlanPath), { ...validExternalPlanHeader(), contentHash: 'short' }));
        await assertFails(setDoc(doc(ownerDb, externalPlanPath), { ...validExternalPlanHeader(), weekCount: 27 }));
        await assertFails(setDoc(doc(ownerDb, externalRevisionPath), {
            ...validExternalPlanRevision(),
            schema: 'adaptive-training-recommender/external-plan@4',
        }));
        await assertFails(setDoc(doc(ownerDb, externalRevisionPath), { ...validExternalPlanRevision(), sessions: [] }));
        await assertFails(setDoc(doc(ownerDb, `users/${ownerId}/external_plans/autumn-block/revisions/4`), {
            ...validExternalPlanRevision(),
            revision: 3,
        }));
        await assertFails(setDoc(doc(ownerDb, `users/${ownerId}/external_plans/other-block/revisions/3`), {
            ...validExternalPlanRevision(),
            planId: 'autumn-block',
        }));
        await assertFails(setDoc(doc(ownerDb, `users/${ownerId}/external_plans/autumn-block/placement/stale`), validExternalPlacement()));
        await assertFails(setDoc(doc(ownerDb, `users/${ownerId}/external_plans/other-block/placement/current`), validExternalPlacement()));
    });

    it('accepts a well-formed external-plan@3 revision with restDays (ADR-0035)', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertSucceeds(setDoc(doc(ownerDb, externalRevisionPath), validExternalPlanRevisionV3()));
    });

    it('accepts external-plan@3 with an empty restDays list', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertSucceeds(setDoc(doc(ownerDb, externalRevisionPath), { ...validExternalPlanRevisionV3(), restDays: [] }));
    });

    it('rejects a v1/v2 revision carrying restDays -- the field is v3-only', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertFails(setDoc(doc(ownerDb, externalRevisionPath), {
            ...validExternalPlanRevision(),
            restDays: [{ id: 'w1-fri-rest', week: 1, day: 'friday' }],
        }));
        await assertFails(setDoc(doc(ownerDb, externalRevisionPath), {
            ...validExternalPlanRevision(),
            schema: 'adaptive-training-recommender/external-plan@2',
            restDays: [{ id: 'w1-fri-rest', week: 1, day: 'friday' }],
        }));
    });

    it('rejects an external-plan@3 revision missing restDays entirely', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        const { restDays: _restDays, ...withoutRestDays } = validExternalPlanRevisionV3();
        void _restDays;
        await assertFails(setDoc(doc(ownerDb, externalRevisionPath), withoutRestDays));
    });

    it('rejects an oversized restDays list', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        const restDays = Array.from({ length: 27 }, (_, i) => ({ id: `r${i}`, week: 1, day: 'friday' }));
        await assertFails(setDoc(doc(ownerDb, externalRevisionPath), { ...validExternalPlanRevisionV3(), restDays }));
    });

    it('rejects a decision audit whose externalRest provenance is malformed (ADR-0035)', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        const rec = validRecommendation();
        rec.recommendationAudit.externalRest = { planId: 'autumn-block', revision: 1, contentHash: 'a'.repeat(64), restDirectiveId: 'w1-fri-rest' /* missing date */ };
        await assertFails(setDoc(doc(ownerDb, recommendationPath), rec));
    });

    it('accepts a decision audit carrying valid externalRest provenance', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        const rec = validRecommendation();
        rec.templateId = 'rest_01';
        rec.recommendationAudit.externalRest = { planId: 'autumn-block', revision: 1, contentHash: 'a'.repeat(64), restDirectiveId: 'w1-fri-rest', date: '2026-08-21' };
        await assertSucceeds(setDoc(doc(ownerDb, recommendationPath), rec));
    });

    it('rejects cross-user external plan access and forged ownership', async () => {
        await testEnvironment.withSecurityRulesDisabled(async context => {
            await setDoc(doc(context.firestore(), externalPlanPath), validExternalPlanHeader());
            await setDoc(doc(context.firestore(), externalRevisionPath), validExternalPlanRevision());
        });
        const otherDb = testEnvironment.authenticatedContext(otherUserId).firestore();
        await assertFails(getDoc(doc(otherDb, externalPlanPath)));
        await assertFails(getDoc(doc(otherDb, externalRevisionPath)));
        await assertFails(setDoc(doc(otherDb, `users/${otherUserId}/external_plans/forged`), validExternalPlanHeader()));
        await assertFails(setDoc(doc(otherDb, `users/${otherUserId}/external_plans/autumn-block/placement/current`), validExternalPlacement()));
        await assertFails(getDoc(doc(otherDb, externalActivationPath)));
        await assertFails(setDoc(doc(otherDb, externalActivationPath), validExternalActivation()));
    });

    it('stores an intent block header and revision for its owner (ADR-0037 H5a/H5c persistence)', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertSucceeds(setDoc(doc(ownerDb, intentBlockPath), validIntentBlockHeader()));
        await assertSucceeds(setDoc(doc(ownerDb, intentBlockRevisionPath), validIntentBlockRevision()));
    });

    it('makes an intent block revision create-only', async () => {
        await testEnvironment.withSecurityRulesDisabled(async context => {
            await setDoc(doc(context.firestore(), intentBlockRevisionPath), validIntentBlockRevision());
        });
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertFails(setDoc(doc(ownerDb, intentBlockRevisionPath), { ...validIntentBlockRevision(), sourceSchemaVersion: 'edited' }));
        await assertFails(deleteDoc(doc(ownerDb, intentBlockRevisionPath)));
        await assertSucceeds(getDoc(doc(ownerDb, intentBlockRevisionPath)));
    });

    it('refuses an intent block header that moves backwards to a superseded revision', async () => {
        await testEnvironment.withSecurityRulesDisabled(async context => {
            await setDoc(doc(context.firestore(), intentBlockPath), { ...validIntentBlockHeader(), revision: 3 });
        });
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertFails(setDoc(doc(ownerDb, intentBlockPath), { ...validIntentBlockHeader(), revision: 2 }));
        await assertSucceeds(setDoc(doc(ownerDb, intentBlockPath), { ...validIntentBlockHeader(), revision: 4 }));
    });

    it('rejects a malformed intent block header and revision', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertFails(setDoc(doc(ownerDb, intentBlockPath), { ...validIntentBlockHeader(), contentHash: 'short' }));
        await assertFails(setDoc(doc(ownerDb, intentBlockPath), { ...validIntentBlockHeader(), sourcePlanRevision: 0 }));
        await assertFails(setDoc(doc(ownerDb, intentBlockRevisionPath), { ...validIntentBlockRevision(), contentHash: 'short' }));
        await assertFails(setDoc(doc(ownerDb, `users/${ownerId}/intent_blocks/block_1/revisions/2`), {
            ...validIntentBlockRevision(),
            revision: 1,
        }));
        await assertFails(setDoc(doc(ownerDb, `users/${ownerId}/intent_blocks/other_block/revisions/1`), {
            ...validIntentBlockRevision(),
            blockId: 'block_1',
        }));
    });

    it('rejects cross-user intent block access and forged ownership', async () => {
        await testEnvironment.withSecurityRulesDisabled(async context => {
            await setDoc(doc(context.firestore(), intentBlockPath), validIntentBlockHeader());
            await setDoc(doc(context.firestore(), intentBlockRevisionPath), validIntentBlockRevision());
        });
        const otherDb = testEnvironment.authenticatedContext(otherUserId).firestore();
        await assertFails(getDoc(doc(otherDb, intentBlockPath)));
        await assertFails(getDoc(doc(otherDb, intentBlockRevisionPath)));
        await assertFails(setDoc(doc(otherDb, `users/${otherUserId}/intent_blocks/forged`), validIntentBlockHeader()));
    });

    it('allows canonical unavailable modalities and rejects unsupported values', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertSucceeds(setDoc(doc(ownerDb, preferencesPath), validPreferences()));
        await assertFails(setDoc(doc(ownerDb, preferencesPath), {
            ...validPreferences(), unavailableModalities: ['None'],
        }));
    });

    it('accepts the ADR-0052 Phase 2 engine recommendations setting (#1167 P2-1)', async () => {
        // ADR-0053: its boolean type is owned by validatePreferences on the write path; the
        // rules only need to let the owner store and later change an explicit choice.
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertSucceeds(setDoc(doc(ownerDb, preferencesPath), { ...validPreferences(), engineRecommendationsEnabled: true }));
        await assertSucceeds(setDoc(doc(ownerDb, preferencesPath), { engineRecommendationsEnabled: false }, { merge: true }));
        const otherDb = testEnvironment.authenticatedContext(otherUserId).firestore();
        await assertFails(setDoc(doc(otherDb, preferencesPath), { engineRecommendationsEnabled: false }, { merge: true }));
    });

    it('enforces ownership, exact shape, bounded priorities and immutable creation time for training intent profiles', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        const valid = validTrainingIntentProfile();
        await expect(assertSucceeds(setDoc(doc(ownerDb, trainingIntentProfilePath), valid))).resolves.toBeUndefined();
        await assertFails(setDoc(doc(ownerDb, trainingIntentProfilePath), { ...valid, surprise: true }));
        await assertFails(setDoc(doc(ownerDb, trainingIntentProfilePath), {
            ...valid, weeklyCommitment: { ...valid.weeklyCommitment, extraSessions: 1 },
        }));
        await assertFails(setDoc(doc(ownerDb, trainingIntentProfilePath), {
            ...valid, priorities: ['health', 'endurance', 'strength_muscle', 'speed_power', 'sport_readiness', 'balanced_performance', 'health'],
        }));
        await assertFails(setDoc(doc(ownerDb, trainingIntentProfilePath), { ...valid, createdAt: '2099-01-01T00:00:00Z' }, { merge: true }));
        const otherDb = testEnvironment.authenticatedContext(otherUserId).firestore();
        await assertFails(getDoc(doc(otherDb, trainingIntentProfilePath)));
    });

    // Issue #1202 (ADR-0053): training-intent VALUES (planningMode, weeklyCommitment counts
    // and ordering, organizationPreference, schemaVersion, the capability enum, uniqueness
    // and enabled rule) are validated by engine/validationCore.ts validateTrainingIntentProfile
    // in TrainingIntentProfileService.upsert before every write -- see
    // trainingIntentProfileService.test.ts.
    it.each([
        ['a fractional targetSessions', { weeklyCommitment: { minSessions: 2, targetSessions: 2.5, maxSessions: 4 } }],
        ['an inverted weekly commitment', { weeklyCommitment: { minSessions: 4, targetSessions: 3, maxSessions: 4 } }],
        ['an unsupported planningMode', { planningMode: 'unsupported' }],
        ['a manual organizationPreference', { organizationPreference: 'manual' }],
        ['a zero schemaVersion', { schemaVersion: 0 }],
        ['an unknown capability', { capabilityMaintenance: { enabled: true, capabilities: ['football'] } }],
        ['an enabled opt-in with no capability', { capabilityMaintenance: { enabled: true, capabilities: [] } }],
        ['a duplicate capability', { capabilityMaintenance: { enabled: true, capabilities: ['sport_skill', 'sport_skill'] } }],
        ['a non-boolean enabled', { capabilityMaintenance: { enabled: 'yes', capabilities: ['sport_skill'] } }],
    ])('accepts a training intent profile with %s at the rules boundary (validateTrainingIntentProfile owns it)', async (_label, override) => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertSucceeds(setDoc(doc(ownerDb, trainingIntentProfilePath), { ...validTrainingIntentProfile(), ...override }));
    });

    it('accepts an absent or valid capability-maintenance opt-in and rejects unknown keys or an oversized list (#805)', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        const valid = validTrainingIntentProfile();
        const profileRef = doc(ownerDb, trainingIntentProfilePath);
        const all = ['linear_speed_skill', 'acceleration_deceleration', 'multidirectional_change_of_direction', 'sport_skill'];
        await assertSucceeds(setDoc(profileRef, valid));
        await assertSucceeds(setDoc(profileRef, { ...valid, capabilityMaintenance: { enabled: true, capabilities: all } }));
        await assertSucceeds(setDoc(profileRef, { ...valid, capabilityMaintenance: { enabled: false, capabilities: all } }));
        await assertFails(setDoc(profileRef, { ...valid, capabilityMaintenance: { enabled: true, capabilities: ['sport_skill'], intervalDays: 7 } }));
        await assertFails(setDoc(profileRef, { ...valid, capabilityMaintenance: { enabled: true } }));
        await assertFails(setDoc(profileRef, { ...valid, capabilityMaintenance: { enabled: true, capabilities: [...all, 'sport_skill'] } }));
        // Update path: the owner can opt out with a merge-write and keeps the field shape-checked.
        await assertSucceeds(setDoc(profileRef, { capabilityMaintenance: { enabled: false, capabilities: [] } }, { merge: true }));
        await assertFails(setDoc(profileRef, { capabilityMaintenance: { enabled: true, capabilities: 'sport_skill' } }, { merge: true }));
        const otherDb = testEnvironment.authenticatedContext(otherUserId).firestore();
        await assertFails(setDoc(doc(otherDb, trainingIntentProfilePath), { ...valid, capabilityMaintenance: { enabled: true, capabilities: all } }));
    });

    it('rejects re-saving the same decision with a different audit than what is stored', async () => {
        await testEnvironment.withSecurityRulesDisabled(async context => {
            await setDoc(doc(context.firestore(), recommendationPath), { ...validRecommendation('2026-08-07T08:00:00Z'), revision: 1 });
        });
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertFails(
            setDoc(doc(ownerDb, recommendationPath), { ...validRecommendation('2026-08-07T09:30:00Z'), revision: 1 }, { merge: true }),
        );
    });

    // --- Decision journal (Phase 9.0.2) ---

    it('allows an owner to create a well-formed decision journal entry', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await expect(assertSucceeds(setDoc(doc(ownerDb, decisionJournalPath), validDecisionJournalEntry()))).resolves.toBeUndefined();
    });

    it('rejects a malformed or foreign-owned decision journal entry', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertFails(setDoc(doc(ownerDb, decisionJournalPath), {
            ...validDecisionJournalEntry(), surprise: true,
        }));
        const withoutSawFirst: Record<string, unknown> = validDecisionJournalEntry();
        delete withoutSawFirst.sawEngineVerdictFirst;
        await assertFails(setDoc(doc(ownerDb, decisionJournalPath), withoutSawFirst));
        await assertFails(setDoc(doc(ownerDb, decisionJournalPath), {
            ...validDecisionJournalEntry(), externalNote: 'x'.repeat(2001),
        }));
        await assertFails(setDoc(doc(ownerDb, decisionJournalPath), {
            ...validDecisionJournalEntry(), createdAt: 42,
        }));
        await assertFails(setDoc(doc(ownerDb, decisionJournalPath), { ...validDecisionJournalEntry(), date: '2026-08-08' }));
        await assertFails(setDoc(doc(ownerDb, decisionJournalPath), { ...validDecisionJournalEntry(), userId: otherUserId }));
        const otherDb = testEnvironment.authenticatedContext(otherUserId).firestore();
        await assertFails(setDoc(
            doc(otherDb, `users/${otherUserId}/decision_journal/2026-08-07`),
            { ...validDecisionJournalEntry(), userId: ownerId },
        ));
    });

    // Issue #1202 (ADR-0053): the verdict enums, the sawEngineVerdictFirst type and
    // schemaVersion are validated by engine/validationCore.ts validateDecisionJournalEntry in
    // DecisionJournalService.write before every write -- see decisionJournal.test.ts.
    it.each([
        ['an unknown externalVerdict', { externalVerdict: 'maybe' }],
        ['an unknown actualVerdict', { actualVerdict: 'maybe' }],
        ['a non-boolean sawEngineVerdictFirst', { sawEngineVerdictFirst: 'no' }],
        ['schemaVersion 2', { schemaVersion: 2 }],
    ])('accepts a decision journal entry with %s at the rules boundary (validateDecisionJournalEntry owns it)', async (_label, override) => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertSucceeds(setDoc(doc(ownerDb, decisionJournalPath), { ...validDecisionJournalEntry(), ...override }));
    });

    it('rejects cross-user decision journal reads and writes', async () => {
        await testEnvironment.withSecurityRulesDisabled(async context => {
            await setDoc(doc(context.firestore(), decisionJournalPath), validDecisionJournalEntry());
        });
        const otherDb = testEnvironment.authenticatedContext(otherUserId).firestore();
        await assertFails(getDoc(doc(otherDb, decisionJournalPath)));
        await assertFails(setDoc(doc(otherDb, decisionJournalPath), validDecisionJournalEntry(), { merge: true }));
    });

    it('allows the evening outcome update but rejects rewriting any morning observation field', async () => {
        await testEnvironment.withSecurityRulesDisabled(async context => {
            await setDoc(doc(context.firestore(), decisionJournalPath), validDecisionJournalEntry());
        });
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();

        await expect(assertSucceeds(setDoc(doc(ownerDb, decisionJournalPath), {
            ...validDecisionJournalEntry(), actualVerdict: 'scale', updatedAt: '2026-08-07T20:00:00Z',
        }))).resolves.toBeUndefined();

        await assertFails(setDoc(doc(ownerDb, decisionJournalPath), {
            ...validDecisionJournalEntry(), sawEngineVerdictFirst: true,
        }));
        await assertFails(setDoc(doc(ownerDb, decisionJournalPath), {
            ...validDecisionJournalEntry(), externalVerdict: 'scale',
        }));
        await assertFails(setDoc(doc(ownerDb, decisionJournalPath), {
            ...validDecisionJournalEntry(), externalNote: 'rewritten after reveal',
        }));
        await assertFails(setDoc(doc(ownerDb, decisionJournalPath), {
            ...validDecisionJournalEntry(), createdAt: '2099-01-01T00:00:00Z',
        }));
    });

    it('rejects deletion of decision journal evidence, including by its owner', async () => {
        await testEnvironment.withSecurityRulesDisabled(async context => {
            await setDoc(doc(context.firestore(), decisionJournalPath), validDecisionJournalEntry());
        });
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertFails(deleteDoc(doc(ownerDb, decisionJournalPath)));
    });

    // --- Strength session logging (ADR-0021, S1.3) ---

    const strengthSessionPath = `users/${ownerId}/strength_sessions/session-1`;

    it('allows an owner to create a well-formed strength session', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await expect(assertSucceeds(setDoc(doc(ownerDb, strengthSessionPath), validStrengthSession()))).resolves.toBeUndefined();
    });

    it('allows appending sets and advancing state on update, but not rewriting when the session started or which day it belongs to', async () => {
        await testEnvironment.withSecurityRulesDisabled(async context => {
            await setDoc(doc(context.firestore(), strengthSessionPath), validStrengthSession());
        });
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();

        await expect(assertSucceeds(setDoc(doc(ownerDb, strengthSessionPath), {
            ...validStrengthSession(),
            state: 'completed',
            completedAt: '2026-08-17T18:45:00Z',
            updatedAt: '2026-08-17T18:45:00Z',
            exercises: [
                ...validStrengthSession().exercises,
                { exerciseId: 'front_squat', sets: [{ setIndex: 1, reps: 5, weightKg: 100, isWarmup: false, completedAt: '2026-08-17T18:20:00Z' }] },
            ],
        }))).resolves.toBeUndefined();

        await assertFails(setDoc(doc(ownerDb, strengthSessionPath), { ...validStrengthSession(), date: '2026-08-18' }));
        await assertFails(setDoc(doc(ownerDb, strengthSessionPath), { ...validStrengthSession(), startedAt: '2026-08-17T19:00:00Z' }));
    });

    // Every case writes to the document id it names as sessionId, so each fails only for the
    // field under test (an unmatched path would be rejected by the sessionId binding alone).
    it.each([
        ['a completed state at creation', { state: 'completed', completedAt: '2026-08-17T18:45:00Z' }],
        ['a completedAt on an in_progress session', { completedAt: '2026-08-17T18:45:00Z' }],
        ['an unknown state', { state: 'paused' }],
        ['an extra field', { surprise: true }],
        ['a notes field over 2000 characters', { notes: 'x'.repeat(2001) }],
        ['a startedAt that is not a string', { startedAt: 5 }],
        ['more than 30 exercises', { exercises: Array.from({ length: 31 }, () => ({ exerciseId: 'front_squat', sets: [] })) }],
        ['a foreign userId', { userId: otherUserId }],
        ['a missing exercises list', { exercises: undefined }],
    ])('rejects a strength session with %s', async (_label, override) => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        const id = 'session-matched';
        const session: Record<string, unknown> = { ...validStrengthSession(id), ...override };
        for (const key of Object.keys(session)) if (session[key] === undefined) delete session[key];
        await assertFails(setDoc(doc(ownerDb, `users/${ownerId}/strength_sessions/${id}`), session));
        // Control: the same document without the override is accepted at the same path.
        await assertSucceeds(setDoc(doc(ownerDb, `users/${ownerId}/strength_sessions/${id}`), validStrengthSession(id)));
    });

    it('rejects a strength session whose sessionId does not match its document', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertFails(setDoc(doc(ownerDb, `${strengthSessionPath}-id-mismatch`), validStrengthSession('someone-elses-id')));
    });

    // Issue #1202 (ADR-0053): validateStrengthSession (assertValidStrengthSession in
    // StrengthSessionService startSession and transitionState) owns these values.
    it.each([
        ['a malformed date', { date: '2026-02-30' }],
        ['a malformed sourceRecommendationDate', { sourceRecommendationDate: '17-08-2026' }],
        ['schemaVersion 2', { schemaVersion: 2 }],
        ['an out-of-range sessionRpe', { sessionRpe: 11 }],
    ])('accepts a strength session with %s at the rules boundary (validateStrengthSession owns it)', async (_label, override) => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertSucceeds(setDoc(doc(ownerDb, strengthSessionPath), { ...validStrengthSession(), ...override }));
    });

    it('rejects a foreign-owned strength session', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertFails(setDoc(doc(ownerDb, strengthSessionPath), { ...validStrengthSession(), userId: otherUserId }));
        const otherDb = testEnvironment.authenticatedContext(otherUserId).firestore();
        await assertFails(setDoc(
            doc(otherDb, `users/${otherUserId}/strength_sessions/session-1`),
            { ...validStrengthSession(), userId: ownerId },
        ));
    });

    it('makes completed and abandoned strength sessions terminal and immutable', async () => {
        await testEnvironment.withSecurityRulesDisabled(async context => {
            await setDoc(doc(context.firestore(), strengthSessionPath), validStrengthSession());
        });
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        const completed = {
            ...validStrengthSession(),
            state: 'completed',
            completedAt: '2026-08-17T18:45:00Z',
            updatedAt: '2026-08-17T18:45:00Z',
        };
        await expect(assertSucceeds(setDoc(doc(ownerDb, strengthSessionPath), completed))).resolves.toBeUndefined();
        await assertFails(setDoc(doc(ownerDb, strengthSessionPath), {
            ...validStrengthSession(), updatedAt: '2026-08-17T19:00:00Z',
        }));
        await assertFails(setDoc(doc(ownerDb, strengthSessionPath), {
            ...completed,
            exercises: [...completed.exercises, { exerciseId: 'bench_press', sets: [] }],
        }));
    });

    it('rejects cross-user strength session reads and writes', async () => {
        await testEnvironment.withSecurityRulesDisabled(async context => {
            await setDoc(doc(context.firestore(), strengthSessionPath), validStrengthSession());
        });
        const otherDb = testEnvironment.authenticatedContext(otherUserId).firestore();
        await assertFails(getDoc(doc(otherDb, strengthSessionPath)));
        await assertFails(setDoc(doc(otherDb, strengthSessionPath), validStrengthSession(), { merge: true }));
    });

    it('allows an owner to delete a mis-started strength session', async () => {
        await testEnvironment.withSecurityRulesDisabled(async context => {
            await setDoc(doc(context.firestore(), strengthSessionPath), validStrengthSession());
        });
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await expect(assertSucceeds(deleteDoc(doc(ownerDb, strengthSessionPath)))).resolves.toBeUndefined();
    });

    it('M1.6 offline acceptance: persists a logged set, survives simulated reload, and maintains sync', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        const initialSession = {
            ...validStrengthSession(),
            exercises: [{ exerciseId: 'bench_press', sets: [] }],
        };
        await expect(assertSucceeds(setDoc(doc(ownerDb, strengthSessionPath), initialSession))).resolves.toBeUndefined();

        const withSet = {
            ...initialSession,
            exercises: [{
                exerciseId: 'bench_press',
                sets: [{
                    setIndex: 1,
                    reps: 5,
                    weightKg: 80,
                    isWarmup: false,
                    completedAt: '2026-08-17T18:05:00Z',
                }],
            }],
            updatedAt: '2026-08-17T18:05:00Z',
        };
        await expect(assertSucceeds(setDoc(doc(ownerDb, strengthSessionPath), withSet))).resolves.toBeUndefined();

        const reloadedSnap = await getDoc(doc(ownerDb, strengthSessionPath));
        expect(reloadedSnap.exists()).toBe(true);
        const data = reloadedSnap.data();
        expect(data?.exercises).toHaveLength(1);
        expect(data?.exercises[0].sets).toHaveLength(1);
        expect(data?.exercises[0].sets[0]).toMatchObject({
            setIndex: 1,
            reps: 5,
            weightKg: 80,
            isWarmup: false,
        });
    });

    // --- Garmin workout queue ---

    const garminQueuePath = `users/${ownerId}/garmin_workout_queue/2026-08-17`;

    function validGarminQueuedWorkout() {
        return {
            userId: ownerId,
            date: '2026-08-17',
            workoutTitle: 'Threshold 3x12',
            modality: 'cycling',
            status: 'pending',
            queuedAt: '2026-08-17T08:00:00Z',
            syncedAt: null,
            error: null,
            payload: {
                schemaVersion: 'canonical_workout_v1',
                title: 'Threshold 3x12',
                workoutId: 's1',
                modality: 'cycling',
                targetDurationMin: 75,
                blocks: [],
                exportedAt: '2026-08-17T08:00:00Z',
            },
        };
    }

    it('allows an owner to queue and read a valid garmin workout item', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await expect(assertSucceeds(setDoc(doc(ownerDb, garminQueuePath), validGarminQueuedWorkout()))).resolves.toBeUndefined();
        await expect(assertSucceeds(getDoc(doc(ownerDb, garminQueuePath)))).resolves.toBeDefined();
    });

    it('allows an owner to update and re-queue an existing garmin workout item with new queuedAt', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await expect(assertSucceeds(setDoc(doc(ownerDb, garminQueuePath), validGarminQueuedWorkout()))).resolves.toBeUndefined();
        const updated = {
            ...validGarminQueuedWorkout(),
            queuedAt: '2026-08-17T09:30:00Z',
            workoutTitle: 'Threshold 4x10',
        };
        await expect(assertSucceeds(setDoc(doc(ownerDb, garminQueuePath), updated))).resolves.toBeUndefined();
    });

    // Every case writes to the real date-document path, so each fails only for the check it names.
    it.each([
        ['an extra field', { unexpectedField: true }],
        ['a foreign userId', { userId: otherUserId }],
        ['a date that does not match its document', { date: '2026-08-18' }],
        ['a missing payload', { payload: undefined }],
        ['a workoutTitle over 200 characters', { workoutTitle: 'x'.repeat(201) }],
        ['a modality over 64 characters', { modality: 'x'.repeat(65) }],
        ['an error over 2000 characters', { error: 'x'.repeat(2001) }],
    ])('rejects a garmin workout queue item with %s', async (_label, override) => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        const item: Record<string, unknown> = { ...validGarminQueuedWorkout(), ...override };
        for (const key of Object.keys(item)) if (item[key] === undefined) delete item[key];
        await assertFails(setDoc(doc(ownerDb, garminQueuePath), item));
    });

    it('rejects a cross-user garmin workout queue read or write', async () => {
        const otherDb = testEnvironment.authenticatedContext(otherUserId).firestore();
        await assertFails(getDoc(doc(otherDb, garminQueuePath)));
        await assertFails(setDoc(doc(otherDb, garminQueuePath), validGarminQueuedWorkout()));
    });

    // Issue #1202 (ADR-0053): these value checks are owned by validateQueuedWorkoutWrite
    // (contracts/workoutExportContract.ts), which GarminWorkoutQueueService.queueWorkout runs
    // before every write -- see workoutExportContract.test.ts and garminWorkoutQueueService.test.ts.
    it.each([
        ['an unknown status', { status: 'unknown' }],
        ['a numeric queuedAt', { queuedAt: 1724650000 }],
        ['a numeric syncedAt', { syncedAt: 5 }],
        ['a numeric garminWorkoutId', { garminWorkoutId: 12345 }],
        ['a non-map payload', { payload: 'not-a-map' }],
    ])('accepts a garmin workout queue item with %s at the rules boundary (validateQueuedWorkoutWrite owns it)', async (_label, override) => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertSucceeds(setDoc(doc(ownerDb, garminQueuePath), { ...validGarminQueuedWorkout(), ...override }));
    });

    it('allows an owner to delete a queued workout item', async () => {
        await testEnvironment.withSecurityRulesDisabled(async context => {
            await setDoc(doc(context.firestore(), garminQueuePath), validGarminQueuedWorkout());
        });
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await expect(assertSucceeds(deleteDoc(doc(ownerDb, garminQueuePath)))).resolves.toBeUndefined();
    });

    // --- Garmin manual "Sync Now" request ---

    const garminSyncRequestPath = `users/${ownerId}/garmin_sync_requests/latest`;

    function validGarminSyncRequest() {
        return {
            userId: ownerId,
            status: 'pending',
            requestedAt: '2026-08-21T06:15:00Z',
            completedAt: null,
            error: null,
        };
    }

    it('allows an owner to create and re-request a manual sync', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await expect(assertSucceeds(setDoc(doc(ownerDb, garminSyncRequestPath), validGarminSyncRequest()))).resolves.toBeUndefined();
        await expect(assertSucceeds(getDoc(doc(ownerDb, garminSyncRequestPath)))).resolves.toBeDefined();

        const requeued = { ...validGarminSyncRequest(), requestedAt: '2026-08-21T06:20:00Z' };
        await expect(assertSucceeds(setDoc(doc(ownerDb, garminSyncRequestPath), requeued))).resolves.toBeUndefined();
    });

    it('rejects a malformed, foreign-owned, or non-latest garmin sync request', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertFails(setDoc(doc(ownerDb, garminSyncRequestPath), {
            ...validGarminSyncRequest(), status: 'unknown',
        }));
        // The browser may only ever queue 'pending' -- 'processing'/'completed'/'failed'
        // and a non-null error are Admin-SDK-only outcomes the poller reports.
        await assertFails(setDoc(doc(ownerDb, garminSyncRequestPath), {
            ...validGarminSyncRequest(), status: 'processing',
        }));
        await assertFails(setDoc(doc(ownerDb, garminSyncRequestPath), {
            ...validGarminSyncRequest(), status: 'completed',
        }));
        await assertFails(setDoc(doc(ownerDb, garminSyncRequestPath), {
            ...validGarminSyncRequest(), error: 'not a real failure',
        }));
        await assertFails(setDoc(doc(ownerDb, garminSyncRequestPath), {
            ...validGarminSyncRequest(), unexpectedField: true,
        }));
        await assertFails(setDoc(doc(ownerDb, garminSyncRequestPath), {
            ...validGarminSyncRequest(), userId: otherUserId,
        }));
        await assertFails(setDoc(doc(ownerDb, `users/${ownerId}/garmin_sync_requests/2026-08-21`), validGarminSyncRequest()));
        const otherDb = testEnvironment.authenticatedContext(otherUserId).firestore();
        await assertFails(getDoc(doc(otherDb, garminSyncRequestPath)));
        await assertFails(setDoc(doc(otherDb, garminSyncRequestPath), validGarminSyncRequest()));
    });

    it('allows an owner to delete a manual sync request', async () => {
        await testEnvironment.withSecurityRulesDisabled(async context => {
            await setDoc(doc(context.firestore(), garminSyncRequestPath), validGarminSyncRequest());
        });
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await expect(assertSucceeds(deleteDoc(doc(ownerDb, garminSyncRequestPath)))).resolves.toBeUndefined();
    });

    // --- Multidomain session definitions, occurrences, executions & entries (M2.2, M2.3 / ADR-0023) ---

    const sessionDefHeaderPath = `users/${ownerId}/session_definitions/def-full-body`;
    const sessionDefRevPath = `${sessionDefHeaderPath}/revisions/1`;
    const sessionOccPath = `users/${ownerId}/session_occurrences/occ-unplanned-1`;
    const sessionExecPath = `users/${ownerId}/session_executions/exec-1`;
    const sessionEntryPath = `${sessionExecPath}/entries/entry-1`;
    const sessionRestEventPath = `${sessionExecPath}/restEvents/rest-1`;

    function validSessionDefHeader() {
        return {
            userId: ownerId,
            definitionId: 'def-full-body',
            title: 'Full Body Maintenance',
            latestRevision: 1,
            dominantModality: 'strength',
            createdAt: '2026-08-18T10:00:00Z',
            updatedAt: '2026-08-18T10:00:00Z',
        };
    }

    function validSessionDefRevision() {
        return {
            userId: ownerId,
            definitionId: 'def-full-body',
            id: 'def-full-body',
            revision: 1,
            schemaVersion: 1,
            title: 'Full Body Maintenance',
            intent: 'training',
            contentHash: 'hash-abc-123',
            blocks: [
                {
                    id: 'b1',
                    role: 'main',
                    executionMode: 'sequential',
                    steps: [
                        {
                            id: 's1',
                            kind: 'exercise',
                            exerciseRef: { kind: 'catalog', exerciseId: 'bench_press' },
                        },
                    ],
                },
            ],
            createdAt: '2026-08-18T10:00:00Z',
        };
    }

    function validSessionOccurrence() {
        return {
            userId: ownerId,
            occurrenceId: 'occ-unplanned-1',
            date: '2026-08-18',
            authority: 'unplanned_log',
            state: 'active',
            definitionRef: {
                definitionId: 'def-full-body',
                revision: 1,
                contentHash: 'hash-abc-123',
            },
            createdAt: '2026-08-18T10:00:00Z',
            updatedAt: '2026-08-18T10:00:00Z',
        };
    }

    function validExternalPlanSessionOccurrence() {
        return {
            userId: ownerId,
            occurrenceId: 'occ-ext-1',
            date: '2026-08-18',
            authority: 'external_plan',
            state: 'scheduled',
            externalPlanRef: {
                planId: 'plan-1',
                revision: 1,
                sessionId: 'session-1',
                contentHash: 'hash-abc-123',
            },
            createdAt: '2026-08-18T10:00:00Z',
            updatedAt: '2026-08-18T10:00:00Z',
        };
    }

    function validSessionExecution() {
        return {
            userId: ownerId,
            executionId: 'exec-1',
            sessionSource: { kind: 'manual', definitionId: 'def-full-body', revision: 1, contentHash: 'hash-abc-123' },
            date: '2026-08-18',
            startedAt: '2026-08-18T10:00:00Z',
            updatedAt: '2026-08-18T10:00:00Z',
            state: 'in_progress',
            schemaVersion: 1,
        };
    }

    function validSessionEntry() {
        return {
            id: 'entry-1',
            executionId: 'exec-1',
            completedAt: '2026-08-18T10:05:00Z',
            createdAt: '2026-08-18T10:05:00Z',
            updatedAt: '2026-08-18T10:05:00Z',
            payload: {
                kind: 'repetition',
                setIndex: 1,
                reps: 8,
                weightKg: 60,
                isWarmup: false,
            },
        };
    }

    function validSessionRestEvent() {
        return {
            id: 'rest-1',
            executionId: 'exec-1',
            afterEntryId: 'entry-1',
            prescribedSeconds: 90,
            startedAt: '2026-08-18T10:05:00Z',
            endedAt: '2026-08-18T10:06:30Z',
            actualSeconds: 90,
            endReason: 'timer_elapsed',
            createdAt: '2026-08-18T10:06:30Z',
            updatedAt: '2026-08-18T10:06:30Z',
        };
    }

    // --- M5.1: SessionResponse (occurrence-linked response generalization) ---

    const sessionResponsePath = `users/${ownerId}/session_responses/resp-1`;

    function validSessionResponse() {
        return {
            userId: ownerId,
            responseId: 'resp-1',
            sourceSession: { kind: 'execution', id: 'exec-1', date: '2026-08-18' },
            window: 'immediate',
            date: '2026-08-18',
            checkinRef: { date: '2026-08-18' },
            sessionRpe: 7,
            createdAt: '2026-08-18T10:45:00Z',
            updatedAt: '2026-08-18T10:45:00Z',
        };
    }

    it('allows an owner to manage session definition header and write-once revision', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await expect(assertSucceeds(setDoc(doc(ownerDb, sessionDefHeaderPath), validSessionDefHeader()))).resolves.toBeUndefined();
        await expect(assertSucceeds(setDoc(doc(ownerDb, sessionDefRevPath), validSessionDefRevision()))).resolves.toBeUndefined();

        // Revision is write-once
        await assertFails(setDoc(doc(ownerDb, sessionDefRevPath), {
            ...validSessionDefRevision(),
            title: 'Mutated title',
        }));

        // Cross-user is rejected
        const otherDb = testEnvironment.authenticatedContext(otherUserId).firestore();
        await assertFails(getDoc(doc(otherDb, sessionDefHeaderPath)));
        await assertFails(getDoc(doc(otherDb, sessionDefRevPath)));
    });

    it('allows supported companion metadata and reversible template archive state', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await expect(assertSucceeds(setDoc(doc(ownerDb, sessionDefHeaderPath), {
            ...validSessionDefHeader(), status: 'active',
        }))).resolves.toBeUndefined();
        await expect(assertSucceeds(setDoc(doc(ownerDb, sessionDefRevPath), {
            ...validSessionDefRevision(),
            companionSessions: [{ id: 'spin', definitionRef: 'recovery-spin', relation: 'later_same_day' }],
        }))).resolves.toBeUndefined();
        await expect(assertSucceeds(setDoc(doc(ownerDb, sessionDefHeaderPath), {
            ...validSessionDefHeader(), status: 'archived', archivedAt: '2026-08-18T12:00:00Z',
        }))).resolves.toBeUndefined();
        await expect(assertSucceeds(setDoc(doc(ownerDb, sessionDefHeaderPath), {
            ...validSessionDefHeader(), status: 'active',
        }))).resolves.toBeUndefined();
    });

    // Issue #1202 (ADR-0053): schemaVersion, the intent enum and the blocks list type are
    // validated by sessions/validation.ts validateSessionDefinition in
    // SessionDefinitionService.saveDefinitionRevision before the write -- see
    // sessions/validation.test.ts and sessionDefinitionService.test.ts.
    it.each([
        ['an unknown intent', { intent: 'strength' }],
        ['schemaVersion 2', { schemaVersion: 2 }],
        ['a non-list blocks value', { blocks: { b1: {} } }],
    ])('accepts a session definition revision with %s at the rules boundary (validateSessionDefinition owns it)', async (_label, override) => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertSucceeds(setDoc(doc(ownerDb, sessionDefRevPath), { ...validSessionDefRevision(), ...override }));
    });

    // Issue #1202: movementComposition is part of the SessionDefinition schema
    // (sessions/models.ts, covered by sessionDefinitionHash) and ManualSessionBuilder carries it
    // over from a catalog base definition, but the revision key allow-list used to omit it, so
    // saving such a revision was denied. validateSessionDefinition owns its content.
    it('accepts a session definition revision carrying movementComposition', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertSucceeds(setDoc(doc(ownerDb, sessionDefRevPath), {
            ...validSessionDefRevision(),
            movementComposition: [{ id: 'push', pattern: 'upper_push', stepIds: ['s1'], status: 'relaxed', reason: 'not evidenced' }],
        }));
    });

    it('keeps the session definition revision bound to its path and owner', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertFails(setDoc(doc(ownerDb, sessionDefRevPath), { ...validSessionDefRevision(), revision: 2 }));
        await assertFails(setDoc(doc(ownerDb, sessionDefRevPath), { ...validSessionDefRevision(), id: 'other-definition' }));
        await assertFails(setDoc(doc(ownerDb, sessionDefRevPath), { ...validSessionDefRevision(), userId: otherUserId }));
        await assertFails(setDoc(doc(ownerDb, sessionDefRevPath), { ...validSessionDefRevision(), contentHash: '' }));
        await assertFails(setDoc(doc(ownerDb, sessionDefRevPath), { ...validSessionDefRevision(), companionSessions: 'spin' }));
    });

    it('rejects a session definition header with archivedAt but no status', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertFails(setDoc(doc(ownerDb, sessionDefHeaderPath), {
            ...validSessionDefHeader(), archivedAt: '2026-08-18T12:00:00Z',
        }));
    });

    const executionPrescriptionPath = `users/${ownerId}/execution_prescriptions/presc-hash-abc`;

    function validExecutionPrescription() {
        return {
            userId: ownerId,
            schemaVersion: 1,
            prescriptionHash: 'presc-hash-abc',
            sessionSource: { kind: 'catalog', workoutId: 'strength_full_body_maintenance_01', catalogVersion: '1' },
            definitionHash: 'def-hash-123',
            blocks: [
                {
                    id: 'b1',
                    title: 'Main',
                    role: 'main',
                    executionMode: 'sequential',
                    steps: [{ id: 's1', kind: 'exercise' }],
                },
            ],
            createdAt: '2026-08-18T10:00:00Z',
        };
    }

    it('allows owner to write-once execution prescriptions and rejects mutations', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await expect(assertSucceeds(setDoc(doc(ownerDb, executionPrescriptionPath), validExecutionPrescription()))).resolves.toBeUndefined();

        // Write-once immutable
        await assertFails(setDoc(doc(ownerDb, executionPrescriptionPath), {
            ...validExecutionPrescription(),
            definitionHash: 'mutated-hash',
        }));

        // Cross-user denied
        const otherDb = testEnvironment.authenticatedContext(otherUserId).firestore();
        await assertFails(getDoc(doc(otherDb, executionPrescriptionPath)));
    });

    it('allows a catalog execution prescription with a valid displayMetadata snapshot (M3.2)', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await expect(assertSucceeds(setDoc(doc(ownerDb, executionPrescriptionPath), {
            ...validExecutionPrescription(),
            displayMetadata: {
                title: 'Full Body Maintenance', intent: 'training', dominantModality: 'Strength', duration: { min: 30, max: 60 },
            },
        }))).resolves.toBeUndefined();
    });

    it('rejects an execution prescription with a malformed displayMetadata snapshot', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertFails(setDoc(doc(ownerDb, executionPrescriptionPath), {
            ...validExecutionPrescription(),
            displayMetadata: { intent: 'training' }, // missing required title
        }));
    });

    it('allows valid occurrence authorities in M3 (unplanned_log, schedule, replace, additional)', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        // unplanned_log succeeds
        await expect(assertSucceeds(setDoc(doc(ownerDb, sessionOccPath), validSessionOccurrence()))).resolves.toBeUndefined();

        // schedule succeeds in M3
        await expect(assertSucceeds(setDoc(doc(ownerDb, `${sessionOccPath}-sched`), {
            ...validSessionOccurrence(),
            occurrenceId: 'occ-unplanned-1-sched',
            authority: 'schedule',
        }))).resolves.toBeUndefined();

        // replace_recommendation succeeds in M3
        await expect(assertSucceeds(setDoc(doc(ownerDb, `${sessionOccPath}-replace`), {
            ...validSessionOccurrence(),
            occurrenceId: 'occ-unplanned-1-replace',
            authority: 'replace_recommendation',
        }))).resolves.toBeUndefined();

        // additional_session succeeds in M3
        await expect(assertSucceeds(setDoc(doc(ownerDb, `${sessionOccPath}-add`), {
            ...validSessionOccurrence(),
            occurrenceId: 'occ-unplanned-1-add',
            authority: 'additional_session',
        }))).resolves.toBeUndefined();

        // external_plan succeeds in Issue #434 PR 2
        await expect(assertSucceeds(setDoc(doc(ownerDb, `${sessionOccPath}-ext`), {
            ...validExternalPlanSessionOccurrence(),
            occurrenceId: 'occ-unplanned-1-ext',
        }))).resolves.toBeUndefined();

        // Issue #1202 (ADR-0053): the authority enum is owned by validateSessionOccurrence
        // (assertValidSessionOccurrence runs before every occurrence write), so an unknown
        // authority is accepted at the rules boundary.
        await expect(assertSucceeds(setDoc(doc(ownerDb, `${sessionOccPath}-unknown`), {
            ...validSessionOccurrence(),
            occurrenceId: 'occ-unplanned-1-unknown',
            authority: 'bogus_authority',
        }))).resolves.toBeUndefined();
    });

    it('allows external-plan occurrence lifecycle (scheduled -> active -> completed / skipped) and leaves ref exclusivity to validateSessionOccurrence', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        const occPath = `users/${ownerId}/session_occurrences/occ-ext-lifecycle`;
        const baseOcc = {
            ...validExternalPlanSessionOccurrence(),
            occurrenceId: 'occ-ext-lifecycle',
        };

        // 1. Create scheduled external-plan occurrence
        await expect(assertSucceeds(setDoc(doc(ownerDb, occPath), baseOcc))).resolves.toBeUndefined();

        // 2. Transition to active
        await expect(assertSucceeds(setDoc(doc(ownerDb, occPath), {
            ...baseOcc,
            state: 'active',
            updatedAt: '2026-08-18T10:05:00Z',
        }))).resolves.toBeUndefined();

        // 3. Transition to completed
        await expect(assertSucceeds(setDoc(doc(ownerDb, occPath), {
            ...baseOcc,
            state: 'completed',
            updatedAt: '2026-08-18T11:00:00Z',
        }))).resolves.toBeUndefined();

        // 3b. Completed occurrence cannot transition back to active
        await assertFails(setDoc(doc(ownerDb, occPath), {
            ...baseOcc,
            state: 'active',
            updatedAt: '2026-08-18T11:05:00Z',
        }));

        // 4. Create another occurrence with skipped state
        const skippedPath = `users/${ownerId}/session_occurrences/occ-ext-skipped`;
        await expect(assertSucceeds(setDoc(doc(ownerDb, skippedPath), {
            ...validExternalPlanSessionOccurrence(),
            occurrenceId: 'occ-ext-skipped',
            state: 'skipped',
        }))).resolves.toBeUndefined();

        // 4b. Skipped occurrence cannot transition back to active
        await assertFails(setDoc(doc(ownerDb, skippedPath), {
            ...validExternalPlanSessionOccurrence(),
            occurrenceId: 'occ-ext-skipped',
            state: 'active',
            updatedAt: '2026-08-18T10:05:00Z',
        }));

        // 4c. Scheduled occurrence can transition directly to completed (production state before PR 3 claims)
        const directPath = `users/${ownerId}/session_occurrences/occ-ext-direct`;
        await expect(assertSucceeds(setDoc(doc(ownerDb, directPath), {
            ...validExternalPlanSessionOccurrence(),
            occurrenceId: 'occ-ext-direct',
            state: 'scheduled',
        }))).resolves.toBeUndefined();
        await expect(assertSucceeds(setDoc(doc(ownerDb, directPath), {
            ...validExternalPlanSessionOccurrence(),
            occurrenceId: 'occ-ext-direct',
            state: 'completed',
            updatedAt: '2026-08-18T11:00:00Z',
        }))).resolves.toBeUndefined();

        // 4d. Terminal completed occurrence cannot transition back to scheduled
        await assertFails(setDoc(doc(ownerDb, directPath), {
            ...validExternalPlanSessionOccurrence(),
            occurrenceId: 'occ-ext-direct',
            state: 'scheduled',
            updatedAt: '2026-08-18T11:05:00Z',
        }));

        // 5, 7, 8. Issue #1202 (ADR-0053): ref exclusivity and the authority/ref pairing are
        // owned by validateSessionOccurrence (assertValidSessionOccurrence runs before every
        // occurrence write; see sessions/validation.test.ts), so the rules accept these shapes.
        const bothPath = `users/${ownerId}/session_occurrences/occ-ext-both`;
        await assertSucceeds(setDoc(doc(ownerDb, bothPath), {
            ...validExternalPlanSessionOccurrence(),
            occurrenceId: 'occ-ext-both',
            definitionRef: {
                definitionId: 'def-full-body',
                revision: 1,
                contentHash: 'hash-abc-123',
            },
        }));

        // 6. At least one ref is a kept required key, so an occurrence with neither is rejected.
        const neitherPath = `users/${ownerId}/session_occurrences/occ-ext-neither`;
        const noRef = { ...validExternalPlanSessionOccurrence(), occurrenceId: 'occ-ext-neither' };
        delete (noRef as { externalPlanRef?: unknown }).externalPlanRef;
        await assertFails(setDoc(doc(ownerDb, neitherPath), noRef));

        const mismatchedExtPath = `users/${ownerId}/session_occurrences/occ-ext-mismatched`;
        await assertSucceeds(setDoc(doc(ownerDb, mismatchedExtPath), {
            ...validExternalPlanSessionOccurrence(),
            occurrenceId: 'occ-ext-mismatched',
            authority: 'replace_recommendation',
        }));

        const mismatchedDefPath = `users/${ownerId}/session_occurrences/occ-def-mismatched`;
        await assertSucceeds(setDoc(doc(ownerDb, mismatchedDefPath), {
            ...validSessionOccurrence(),
            occurrenceId: 'occ-def-mismatched',
            authority: 'external_plan',
        }));
    });

    it('validates windowBinding on external-plan occurrences (H4 #434 PR 3, D-WINDOW)', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        function validWindowBinding() {
            return {
                windowId: 'window-1', bundleId: 'bundle-1', order: 0,
                boundStartLocal: '07:00', boundEndLocal: '08:00',
                startInstant: '2026-08-18T05:00:00Z', endInstant: '2026-08-18T06:00:00Z',
            };
        }

        // 1. Accepts a valid windowBinding on an external-plan occurrence.
        const boundPath = `users/${ownerId}/session_occurrences/occ-ext-bound`;
        await expect(assertSucceeds(setDoc(doc(ownerDb, boundPath), {
            ...validExternalPlanSessionOccurrence(),
            occurrenceId: 'occ-ext-bound',
            windowBinding: validWindowBinding(),
        }))).resolves.toBeUndefined();

        // 2. Issue #1202 (ADR-0053): windowBinding-needs-externalPlanRef is owned by
        // validateSessionOccurrence, so a manual occurrence with a binding is accepted here.
        const manualWithWindowPath = `users/${ownerId}/session_occurrences/occ-manual-window`;
        await assertSucceeds(setDoc(doc(ownerDb, manualWithWindowPath), {
            ...validSessionOccurrence(),
            occurrenceId: 'occ-manual-window',
            windowBinding: validWindowBinding(),
        }));

        // 3. Rejects a windowBinding missing a required field (the kept hasAll key check).
        const incompletePath = `users/${ownerId}/session_occurrences/occ-ext-incomplete-window`;
        const incompleteBinding = validWindowBinding() as Partial<ReturnType<typeof validWindowBinding>>;
        delete incompleteBinding.order;
        await assertFails(setDoc(doc(ownerDb, incompletePath), {
            ...validExternalPlanSessionOccurrence(),
            occurrenceId: 'occ-ext-incomplete-window',
            windowBinding: incompleteBinding,
        }));

        // 4. windowBinding is immutable once set.
        await assertFails(setDoc(doc(ownerDb, boundPath), {
            ...validExternalPlanSessionOccurrence(),
            occurrenceId: 'occ-ext-bound',
            windowBinding: { ...validWindowBinding(), windowId: 'window-2' },
            updatedAt: '2026-08-18T11:00:00Z',
        }));
    });

    it('allows one atomic scheduled external occurrence binding with its matching reservation', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        const occurrenceId = 'occ-ext-seal';
        const occurrenceRef = doc(ownerDb, `users/${ownerId}/session_occurrences/${occurrenceId}`);
        const reservationRef = doc(ownerDb, `users/${ownerId}/session_occurrence_windows/win-2026-08-18-window-1`);
        const binding = {
            windowId: 'window-1', bundleId: 'bundle-1', order: 0,
            boundStartLocal: '07:00', boundEndLocal: '08:00',
            startInstant: '2026-08-18T05:00:00Z', endInstant: '2026-08-18T06:00:00Z',
        };
        await setDoc(occurrenceRef, {
            ...validExternalPlanSessionOccurrence(), occurrenceId,
        });

        const batch = writeBatch(ownerDb);
        batch.update(occurrenceRef, { windowBinding: binding, placementOrder: 0, updatedAt: '2026-08-18T11:00:00Z' });
        batch.set(reservationRef, {
            userId: ownerId, date: '2026-08-18', windowId: binding.windowId, occurrenceId,
            createdAt: '2026-08-18T11:00:00Z',
        });
        await assertSucceeds(batch.commit());

        await assertFails(setDoc(occurrenceRef, {
            ...validExternalPlanSessionOccurrence(), occurrenceId,
            windowBinding: { ...binding, windowId: 'window-2' }, placementOrder: 1,
            updatedAt: '2026-08-18T12:00:00Z',
        }));
    });

    it('enforces session_occurrence_windows as the D-WINDOW exclusivity mechanism (H4 #434 PR 3)', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        const otherDb = testEnvironment.authenticatedContext(otherUserId).firestore();
        const reservationPath = `users/${ownerId}/session_occurrence_windows/win-2026-08-18-window-1`;

        function validReservation() {
            return {
                userId: ownerId, date: '2026-08-18', windowId: 'window-1',
                occurrenceId: 'occ-ext-1', createdAt: '2026-08-18T10:00:00Z',
            };
        }

        // 1. Owner can create a valid reservation.
        await expect(assertSucceeds(setDoc(doc(ownerDb, reservationPath), validReservation())))
            .resolves.toBeUndefined();

        // 2. Rejects a shape with an extra/missing field.
        const malformedPath = `users/${ownerId}/session_occurrence_windows/win-2026-08-18-window-2`;
        await assertFails(setDoc(doc(ownerDb, malformedPath), { ...validReservation(), extra: 'nope' }));
        const missingFieldPath = `users/${ownerId}/session_occurrence_windows/win-2026-08-18-window-3`;
        const missingField: Partial<ReturnType<typeof validReservation>> = validReservation();
        delete missingField.occurrenceId;
        await assertFails(setDoc(doc(ownerDb, missingFieldPath), missingField));

        // 3. A same-window handoff (occurrenceId repointed, date/windowId unchanged) is
        // allowed -- this is exactly what getOrCreateExternalPlanOccurrence's re-import
        // supersession does when the successor keeps the predecessor's resolved window:
        // Firestore evaluates that `set()` on an existing document as `update`, so without
        // this the whole occurrence-creation transaction would fail with permission-denied.
        await expect(assertSucceeds(setDoc(doc(ownerDb, reservationPath), {
            ...validReservation(), occurrenceId: 'occ-ext-2', createdAt: '2026-08-18T11:00:00Z',
        }))).resolves.toBeUndefined();

        // 4. The reservation's identity (date, windowId) stays immutable even though
        // occurrenceId can change -- a reservation must never be silently moved to cover a
        // different window or date.
        await assertFails(setDoc(doc(ownerDb, reservationPath), {
            ...validReservation(), windowId: 'window-2',
        }));
        await assertFails(setDoc(doc(ownerDb, reservationPath), {
            ...validReservation(), date: '2026-08-19',
        }));

        // 5. The owner may delete their own reservation (releasing the window); a
        // cross-user read/write/update is denied.
        await assertFails(getDoc(doc(otherDb, reservationPath)));
        await assertFails(deleteDoc(doc(otherDb, reservationPath)));
        await assertFails(setDoc(doc(otherDb, reservationPath), { ...validReservation(), occurrenceId: 'occ-hijacked' }));
        await expect(assertSucceeds(deleteDoc(doc(ownerDb, reservationPath)))).resolves.toBeUndefined();
    });

    it('enforces the daily_ledgers reservation aggregate contract (H4 #434 PR 3, D-LEDGER step 6a)', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        const otherDb = testEnvironment.authenticatedContext(otherUserId).firestore();
        const aggregatePath = `users/${ownerId}/daily_ledgers/2026-08-18`;

        function validAggregate() {
            return {
                userId: ownerId, date: '2026-08-18', revision: 1,
                ceilings: { dailyMinuteCeiling: 90, dailySystemicCostCeiling: 1 },
                reservations: { 'occ-1': { minutes: 60, systemicCost: 0.4, state: 'reserved' } },
                seededAt: '2026-08-18T05:00:00Z',
                createdAt: '2026-08-18T05:00:00Z', updatedAt: '2026-08-18T05:00:00Z',
            };
        }

        // 1. Owner can seed a valid aggregate.
        await expect(assertSucceeds(setDoc(doc(ownerDb, aggregatePath), validAggregate())))
            .resolves.toBeUndefined();

        // 2. Cross-user read is denied.
        await assertFails(getDoc(doc(otherDb, aggregatePath)));

        // 3. A revision jump greater than 1 is rejected -- every mutating transition must
        // bump revision by exactly one.
        await assertFails(setDoc(doc(ownerDb, aggregatePath), {
            ...validAggregate(), revision: 3, updatedAt: '2026-08-18T06:00:00Z',
        }));

        // 4. A legitimate +1 update (adding a reservation) succeeds.
        await expect(assertSucceeds(setDoc(doc(ownerDb, aggregatePath), {
            ...validAggregate(),
            revision: 2,
            reservations: { ...validAggregate().reservations, 'occ-2': { minutes: 30, systemicCost: 0.2, state: 'reserved' } },
            updatedAt: '2026-08-18T06:00:00Z',
        }))).resolves.toBeUndefined();

        // 5. ceilings/seededAt/createdAt/date are immutable once seeded.
        await assertFails(setDoc(doc(ownerDb, aggregatePath), {
            ...validAggregate(), revision: 3, ceilings: { dailyMinuteCeiling: 999, dailySystemicCostCeiling: 1 },
        }));
        await assertFails(setDoc(doc(ownerDb, aggregatePath), {
            ...validAggregate(), revision: 3, seededAt: '2026-08-18T07:00:00Z',
        }));

        // 6. Deletes are never allowed -- the aggregate is an append/mutate-only ledger.
        await assertFails(deleteDoc(doc(ownerDb, aggregatePath)));

        // 7. Rejects a malformed shape (missing a required field).
        const malformed = validAggregate() as Partial<ReturnType<typeof validAggregate>>;
        delete malformed.ceilings;
        await assertFails(setDoc(doc(ownerDb, `users/${ownerId}/daily_ledgers/2026-08-19`), malformed));

        // 8. generations (H4 #434 PR 3 step 8, item 2a) is optional and, when present, a
        // map -- the same dynamic-keyed tradeoff as reservations.
        const withGenerationsPath = `users/${ownerId}/daily_ledgers/2026-08-20`;
        await expect(assertSucceeds(setDoc(doc(ownerDb, withGenerationsPath), {
            ...validAggregate(), date: '2026-08-20', generations: { 'session-am': 1 },
        }))).resolves.toBeUndefined();
        await assertFails(setDoc(doc(ownerDb, `users/${ownerId}/daily_ledgers/2026-08-21`), {
            ...validAggregate(), date: '2026-08-21', generations: 'not-a-map',
        }));
    });

    it('enforces the intraday_bundle_placements display-audit contract (ADR-0036 D-PLACEMENT follow-up)', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        const otherDb = testEnvironment.authenticatedContext(otherUserId).firestore();
        const placementPath = `users/${ownerId}/intraday_bundle_placements/2026-08-18`;

        function validPlacement() {
            return {
                userId: ownerId, date: '2026-08-18', bundleId: 'bundle-1', outcome: 'placed',
                bindings: [{
                    sessionId: 'w1-am', windowId: 'win-am',
                    boundStartLocal: '06:00', boundEndLocal: '07:00',
                    startInstant: '2026-08-18T04:00:00.000Z', endInstant: '2026-08-18T05:00:00.000Z',
                }],
                reason: null,
                revision: 1,
                createdAt: '2026-08-18T05:00:00Z', updatedAt: '2026-08-18T05:00:00Z',
            };
        }

        // 1. Owner can record a valid placement.
        await expect(assertSucceeds(setDoc(doc(ownerDb, placementPath), validPlacement())))
            .resolves.toBeUndefined();

        // 2. Cross-user read/write is denied.
        await assertFails(getDoc(doc(otherDb, placementPath)));
        await assertFails(setDoc(doc(otherDb, placementPath), { ...validPlacement(), userId: otherUserId }));

        // 3. A revision jump greater than 1 is rejected.
        await assertFails(setDoc(doc(ownerDb, placementPath), { ...validPlacement(), revision: 3 }));

        // 4. A legitimate +1 re-proposal update succeeds.
        await expect(assertSucceeds(setDoc(doc(ownerDb, placementPath), {
            ...validPlacement(), revision: 2, updatedAt: '2026-08-18T06:00:00Z',
        }))).resolves.toBeUndefined();

        // 5. date/createdAt are immutable once created.
        await assertFails(setDoc(doc(ownerDb, placementPath), { ...validPlacement(), revision: 3, createdAt: '2026-08-18T07:00:00Z' }));

        // 6. Deletes are never allowed.
        await assertFails(deleteDoc(doc(ownerDb, placementPath)));

        // 7. An infeasible outcome with an empty bindings list and a reason is valid.
        const infeasiblePath = `users/${ownerId}/intraday_bundle_placements/2026-08-19`;
        await expect(assertSucceeds(setDoc(doc(ownerDb, infeasiblePath), {
            ...validPlacement(), date: '2026-08-19', outcome: 'infeasible', bindings: [], reason: 'insufficient daily systemic-cost budget',
        }))).resolves.toBeUndefined();

        // 8. An unknown outcome value is rejected.
        await assertFails(setDoc(doc(ownerDb, `users/${ownerId}/intraday_bundle_placements/2026-08-20`), {
            ...validPlacement(), date: '2026-08-20', outcome: 'maybe',
        }));

        // 9. Rejects a malformed shape (missing a required field).
        const malformed = validPlacement() as Partial<ReturnType<typeof validPlacement>>;
        delete malformed.bundleId;
        await assertFails(setDoc(doc(ownerDb, `users/${ownerId}/intraday_bundle_placements/2026-08-21`), malformed));
    });

    it.each([4, 5, 6])('enforces immutable ownership and shape for replayable intraday placement audits with external-plan@%i started members', async version => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        const otherDb = testEnvironment.authenticatedContext(otherUserId).firestore();
        const auditId = 'audit_' + 'a'.repeat(64);
        const auditPath = `users/${ownerId}/intraday_bundle_placement_audits/${auditId}`;
        const binding = {
            sessionId: 's1', windowId: 'window-1', boundStartLocal: '06:00', boundEndLocal: '07:00',
            startInstant: '2026-08-18T04:00:00Z', endInstant: '2026-08-18T05:00:00Z',
        };
        const validAudit = {
            schemaVersion: 'intraday_bundle_placement_audit_v1', auditId, snapshotHash: 'a'.repeat(64), userId: ownerId,
            date: '2026-08-18', asOf: '2026-08-18T05:00:00Z', policyVersion: '2026-09-h4-intraday-bundle-member-launch-v1',
            plan: { planId: 'plan-1', revision: 2, contentHash: 'b'.repeat(64) }, bundleId: 'bundle-1',
            planSnapshot: {
                schema: `adaptive-training-recommender/external-plan@${version}`, planId: 'plan-1', revision: 2,
                title: 'Test plan', startDate: '2026-08-17', weekCount: 1, sessions: [{}], restDays: [],
                ...(version >= 5 ? { intentBlocks: [] } : {}),
            },
            scheduleWindows: [], fixedActivities: [], restDates: [], planSessions: [{ sessionId: 's1', date: '2026-08-18', status: 'planned' }],
            members: [{ sessionId: 's1', order: 1, priority: 'key', requestedWindow: { startLocal: '06:00', endLocal: '07:00' }, estimatedMinutes: 45, estimatedSystemicCost: 0.2, started: true, existingBinding: binding }],
            ledger: { ceilings: { dailyMinuteCeiling: 60, dailySystemicCostCeiling: 1 }, entries: [], result: { remainingMinutes: 60, remainingSystemicCost: 1, unresolvedEntries: [] } },
            proposal: { bundleId: 'bundle-1', outcome: 'placed', bindings: [binding] }, createdAt: '2026-08-18T05:00:00Z',
        };

        await assertFails(setDoc(doc(otherDb, auditPath), validAudit));
        await assertFails(setDoc(doc(ownerDb, auditPath), { ...validAudit, userId: otherUserId }));
        await assertFails(setDoc(doc(testEnvironment.unauthenticatedContext().firestore(), auditPath), validAudit));
        await assertSucceeds(setDoc(doc(ownerDb, auditPath), validAudit));
        await assertSucceeds(getDoc(doc(ownerDb, auditPath)));
        await assertFails(getDoc(doc(otherDb, auditPath)));
        await assertFails(setDoc(doc(otherDb, auditPath), { ...validAudit, userId: otherUserId }));
        await assertFails(setDoc(doc(ownerDb, auditPath), validAudit));
        await assertFails(updateDoc(doc(ownerDb, auditPath), { asOf: '2026-08-18T06:00:00Z' }));
        await assertFails(setDoc(doc(ownerDb, auditPath), { ...validAudit, proposal: { bundleId: 'bundle-1', outcome: 'placed' } }));
        await assertFails(deleteDoc(doc(ownerDb, auditPath)));
        await assertFails(setDoc(doc(ownerDb, `users/${ownerId}/intraday_bundle_placement_audits/not-the-payload-id`), validAudit));
        const unstartedAuditId = 'audit_' + 'd'.repeat(64);
        const snapshotWithoutIntentBlocks = { ...validAudit.planSnapshot };
        delete snapshotWithoutIntentBlocks.intentBlocks;
        const unstartedMember: Record<string, unknown> = { ...validAudit.members[0], started: false };
        delete unstartedMember.existingBinding;
        await assertSucceeds(setDoc(doc(ownerDb, `users/${ownerId}/intraday_bundle_placement_audits/${unstartedAuditId}`), {
            ...validAudit, auditId: unstartedAuditId, planSnapshot: snapshotWithoutIntentBlocks,
            members: [unstartedMember],
            proposal: { bundleId: 'bundle-1', outcome: 'infeasible', reason: 'no placement' },
        }));
        const emptyMembersAuditId = 'audit_' + 'c'.repeat(64);
        await assertFails(setDoc(
            doc(ownerDb, `users/${ownerId}/intraday_bundle_placement_audits/${emptyMembersAuditId}`),
            { ...validAudit, auditId: emptyMembersAuditId, members: [] },
        ));
        const snapshotWithoutRestDays: Record<string, unknown> = { ...validAudit.planSnapshot };
        delete snapshotWithoutRestDays.restDays;
        const malformedSnapshots = [
            { ...validAudit.planSnapshot, schema: 'adaptive-training-recommender/external-plan@3' },
            { ...validAudit.planSnapshot, schema: 'adaptive-training-recommender/external-plan@7' },
            { ...validAudit.planSnapshot, planId: 'another-plan' },
            { ...validAudit.planSnapshot, revision: 3 },
            { ...validAudit.planSnapshot, unexpectedField: true },
            { ...validAudit.planSnapshot, sessions: Array.from({ length: 121 }, () => ({})) },
            { ...validAudit.planSnapshot, intentBlocks: {} },
            { ...validAudit.planSnapshot, intentBlocks: Array.from({ length: 27 }, () => ({})) },
            snapshotWithoutRestDays,
            ...(version === 4 ? [{ ...validAudit.planSnapshot, intentBlocks: [] }] : []),
        ];
        for (const planSnapshot of malformedSnapshots) {
            await assertFails(setDoc(doc(ownerDb, `users/${ownerId}/intraday_bundle_placement_audits/${emptyMembersAuditId}`), {
                ...validAudit, auditId: emptyMembersAuditId, planSnapshot,
            }));
        }
    });

    it('allows recommendations with primarySession and additionalSessions bindings', async () => {
        const base = validRecommendation();
        const recWithBindings = {
            ...base,
            primarySession: {
                sessionSource: { kind: 'catalog', workoutId: 'strength_full_body_maintenance_01', catalogVersion: '1' },
                prescriptionHash: 'presc-hash-abc',
            },
            additionalSessions: [
                {
                    sessionSource: { kind: 'unplanned_fixture', fixtureId: '01-full-body-maintenance' },
                    prescriptionHash: 'presc-hash-xyz',
                },
            ],
            recommendationAudit: {
                ...base.recommendationAudit,
                primarySession: {
                    sessionSource: { kind: 'catalog', workoutId: 'strength_full_body_maintenance_01', catalogVersion: '1' },
                    prescriptionHash: 'presc-hash-abc',
                },
            },
        };
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await expect(assertSucceeds(setDoc(doc(ownerDb, `users/${ownerId}/daily_recommendations/2026-08-07`), recWithBindings))).resolves.toBeUndefined();
    });

    it('accepts a catalog binding with a valid fitWorkoutFingerprint pair', async () => {
        const base = validRecommendation();
        const recWithFingerprint = {
            ...base,
            primarySession: {
                sessionSource: { kind: 'catalog', workoutId: 'strength_full_body_maintenance_01', catalogVersion: '1' },
                prescriptionHash: 'presc-hash-abc',
                occurrenceId: 'occ-1',
                fitWorkoutFingerprint: 'fit-workout-v2:0123456789abcdef0123456789abcdef',
                fitWorkoutFingerprintKind: 'semantic_definition',
            },
        };
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await expect(assertSucceeds(setDoc(doc(ownerDb, `users/${ownerId}/daily_recommendations/2026-08-07`), recWithFingerprint))).resolves.toBeUndefined();
    });

    it('rejects a catalog binding with only one half of the fingerprint pair', async () => {
        const base = validRecommendation();
        const recOnlyFingerprint = {
            ...base,
            primarySession: {
                sessionSource: { kind: 'catalog', workoutId: 'strength_full_body_maintenance_01', catalogVersion: '1' },
                prescriptionHash: 'presc-hash-abc',
                fitWorkoutFingerprint: 'fit-workout-v2:0123456789abcdef0123456789abcdef',
            },
        };
        const recOnlyKind = {
            ...base,
            primarySession: {
                sessionSource: { kind: 'catalog', workoutId: 'strength_full_body_maintenance_01', catalogVersion: '1' },
                prescriptionHash: 'presc-hash-abc',
                fitWorkoutFingerprintKind: 'semantic_definition',
            },
        };
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await expect(assertFails(setDoc(doc(ownerDb, `users/${ownerId}/daily_recommendations/2026-08-07`), recOnlyFingerprint))).resolves.toBeDefined();
        await expect(assertFails(setDoc(doc(ownerDb, `users/${ownerId}/daily_recommendations/2026-08-07`), recOnlyKind))).resolves.toBeDefined();
    });

    it('rejects a catalog binding with an unknown fingerprint kind', async () => {
        const base = validRecommendation();
        const recInvalidKind = {
            ...base,
            primarySession: {
                sessionSource: { kind: 'catalog', workoutId: 'strength_full_body_maintenance_01', catalogVersion: '1' },
                prescriptionHash: 'presc-hash-abc',
                fitWorkoutFingerprint: 'fit-workout-v2:0123456789abcdef0123456789abcdef',
                fitWorkoutFingerprintKind: 'invalid_kind',
            },
        };
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await expect(assertFails(setDoc(doc(ownerDb, `users/${ownerId}/daily_recommendations/2026-08-07`), recInvalidKind))).resolves.toBeDefined();
    });

    it('rejects a catalog binding with an extra unknown key', async () => {
        const base = validRecommendation();
        const recExtraKey = {
            ...base,
            primarySession: {
                sessionSource: { kind: 'catalog', workoutId: 'strength_full_body_maintenance_01', catalogVersion: '1' },
                prescriptionHash: 'presc-hash-abc',
                unknownField: 'disallowed',
            },
        };
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await expect(assertFails(setDoc(doc(ownerDb, `users/${ownerId}/daily_recommendations/2026-08-07`), recExtraKey))).resolves.toBeDefined();
    });

    it('binds a recommendation to an owner-only, write-once decision context with bounded history', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        const otherDb = testEnvironment.authenticatedContext(otherUserId).firestore();
        const contextPath = `${recommendationPath}/decision_contexts/1`;
        const recommendation = {
            ...validRecommendation(),
            revision: 1,
            recommendationAudit: {
                ...validRecommendation().recommendationAudit,
                decisionContext: { path: contextPath, revision: 1, contentHash: 'a'.repeat(64) },
            },
        };
        const context = {
            schemaVersion: 1,
            userId: ownerId,
            date: '2026-08-07',
            recommendationRevision: 1,
            // Must equal the bound audit's evaluation (validRecommendation's audit).
            evaluatedAt: '2026-08-07T08:00:00Z',
            policyVersion: '2026-08-decision-provenance-v1',
            captureVersion: 'same-day-capture-v1',
            appSource: { gitSha: 'abc123', dirty: false },
            minimumSafetyStatus: 'complete',
            evaluatorInputs: {},
            performedTrainingFacts: {
                asOfDate: '2026-08-07', windowDays: 7, revision: 'canonical-facts-v1:evergreen_general:test',
                exposures: [], coverageCredits: [],
            },
            trainingHistoryReplay: { preparedSnapshot: {}, capture: { schemaVersion: 1, requests: [] } },
            contentHash: 'a'.repeat(64),
        };

        const batch = writeBatch(ownerDb);
        batch.set(doc(ownerDb, recommendationPath), recommendation);
        batch.set(doc(ownerDb, contextPath), context);
        await assertSucceeds(batch.commit());
        await assertFails(updateDoc(doc(ownerDb, contextPath), { policyVersion: 'changed' }));
        await assertFails(deleteDoc(doc(ownerDb, contextPath)));
        await assertFails(getDoc(doc(otherDb, contextPath)));
        await assertFails(setDoc(doc(ownerDb, `${recommendationPath}/decision_contexts/2`), {
            ...context, recommendationRevision: 2,
        }));
        const mismatchPath = `users/${ownerId}/daily_recommendations/2026-08-08`;
        const mismatch = writeBatch(ownerDb);
        mismatch.set(doc(ownerDb, mismatchPath), {
            ...recommendation,
            date: '2026-08-08',
            recommendationAudit: {
                ...recommendation.recommendationAudit,
                decisionContext: { path: `${mismatchPath}/decision_contexts/1`, revision: 1, contentHash: 'a'.repeat(64) },
            },
        });
        mismatch.set(doc(ownerDb, `${mismatchPath}/decision_contexts/1`), {
            ...context, date: '2026-08-08', contentHash: 'b'.repeat(64),
        });
        await assertFails(mismatch.commit());

        const missingFactsPath = `users/${ownerId}/daily_recommendations/2026-08-09`;
        const missingFactsContextPath = `${missingFactsPath}/decision_contexts/1`;
        const missingFacts = writeBatch(ownerDb);
        missingFacts.set(doc(ownerDb, missingFactsPath), {
            ...recommendation,
            date: '2026-08-09',
            recommendationAudit: {
                ...recommendation.recommendationAudit,
                decisionContext: { path: missingFactsContextPath, revision: 1, contentHash: 'c'.repeat(64) },
            },
        });
        missingFacts.set(doc(ownerDb, missingFactsContextPath), {
            ...context,
            date: '2026-08-09',
            performedTrainingFacts: null,
            contentHash: 'c'.repeat(64),
        });
        await assertFails(missingFacts.commit());

        const wrongPathDay = '2026-08-14';
        const wrongPathRecommendationPath = `users/${ownerId}/daily_recommendations/${wrongPathDay}`;
        const wrongPathContextPath = `${wrongPathRecommendationPath}/decision_contexts/1`;
        const wrongPathBatch = writeBatch(ownerDb);
        wrongPathBatch.set(doc(ownerDb, wrongPathRecommendationPath), {
            ...recommendation,
            date: wrongPathDay,
            recommendationAudit: {
                ...recommendation.recommendationAudit,
                decisionContext: {
                    path: `users/${ownerId}/daily_recommendations/${wrongPathDay}/decision_contexts/999`,
                    revision: 1,
                    contentHash: 'e'.repeat(64),
                },
            },
        });
        wrongPathBatch.set(doc(ownerDb, wrongPathContextPath), {
            ...context, date: wrongPathDay, contentHash: 'e'.repeat(64),
        });
        await assertFails(wrongPathBatch.commit());

        const stringRevisionDay = '2026-08-15';
        const stringRevisionRecommendationPath = `users/${ownerId}/daily_recommendations/${stringRevisionDay}`;
        const stringRevisionContextPath = `${stringRevisionRecommendationPath}/decision_contexts/1`;
        const stringRevisionBatch = writeBatch(ownerDb);
        stringRevisionBatch.set(doc(ownerDb, stringRevisionRecommendationPath), {
            ...recommendation,
            date: stringRevisionDay,
            recommendationAudit: {
                ...recommendation.recommendationAudit,
                decisionContext: { path: stringRevisionContextPath, revision: 1, contentHash: 'f'.repeat(64) },
            },
        });
        stringRevisionBatch.set(doc(ownerDb, stringRevisionContextPath), {
            ...context, date: stringRevisionDay, recommendationRevision: '1', contentHash: 'f'.repeat(64),
        });
        await assertFails(stringRevisionBatch.commit());

        // The capture must describe the same evaluation as the audit it is bound to. The
        // first (drift-free) entry is the positive control for the three rejections.
        for (const [day, drift, expected] of [
            ['2026-08-13', {}, 'succeeds'],
            ['2026-08-10', { policyVersion: 'some-other-policy' }, 'fails'],
            ['2026-08-11', { evaluatedAt: '2026-08-11T09:15:00.000Z' }, 'fails'],
            ['2026-08-12', { appSource: { gitSha: 'abc123', dirty: false, extra: true } }, 'fails'],
        ] as const) {
            const driftPath = `users/${ownerId}/daily_recommendations/${day}`;
            const driftContextPath = `${driftPath}/decision_contexts/1`;
            const driftBatch = writeBatch(ownerDb);
            driftBatch.set(doc(ownerDb, driftPath), {
                ...recommendation,
                date: day,
                recommendationAudit: {
                    ...recommendation.recommendationAudit,
                    decisionContext: { path: driftContextPath, revision: 1, contentHash: 'd'.repeat(64) },
                },
            });
            driftBatch.set(doc(ownerDb, driftContextPath), {
                ...context, date: day, contentHash: 'd'.repeat(64), ...drift,
            });
            if (expected === 'succeeds') await assertSucceeds(driftBatch.commit());
            else await assertFails(driftBatch.commit());
        }
    });

    it('allows additionalSessions at the full 4-element bound without exceeding the rule-evaluation budget', async () => {
        // Regression test: a prior attempt at real per-element validation at the schema's
        // historical 16-element bound blew the emulator's ~1000-expression budget. This
        // proves per-element validation at the current 4-element bound actually works,
        // not just the single-element case the test above already covers.
        const binding = (i: number) => ({
            sessionSource: { kind: 'unplanned_fixture', fixtureId: `0${i}-full-body-maintenance` },
            prescriptionHash: `presc-hash-${i}`,
        });
        const base = validRecommendation();
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await expect(assertSucceeds(setDoc(doc(ownerDb, `users/${ownerId}/daily_recommendations/2026-08-07`), {
            ...base,
            additionalSessions: [binding(1), binding(2), binding(3), binding(4)],
        }))).resolves.toBeUndefined();
    });

    it('rejects additionalSessions beyond the 4-element bound', async () => {
        const binding = (i: number) => ({
            sessionSource: { kind: 'unplanned_fixture', fixtureId: `0${i}-full-body-maintenance` },
            prescriptionHash: `presc-hash-${i}`,
        });
        const base = validRecommendation();
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertFails(setDoc(doc(ownerDb, `users/${ownerId}/daily_recommendations/2026-08-07`), {
            ...base,
            additionalSessions: [binding(1), binding(2), binding(3), binding(4), binding(5)],
        }));
    });

    it('allows an authored replacement occurrence provenance in a recommendation audit', async () => {
        const base = validRecommendation();
        const primarySession = {
            sessionSource: {
                kind: 'manual', definitionId: 'manual-1', revision: 1, contentHash: 'a'.repeat(64),
            },
            occurrenceId: 'occ-authored-1',
            prescriptionHash: 'b'.repeat(64),
            executedDefinition: 'reduced',
        };
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await expect(assertSucceeds(setDoc(doc(ownerDb, recommendationPath), {
            ...base,
            primarySession,
            recommendationAudit: {
                ...base.recommendationAudit,
                candidateScores: [],
                primarySession,
                authoredOccurrence: { occurrenceId: 'occ-authored-1', decision: 'scale' },
            },
        }))).resolves.toBeUndefined();
    });

    it('accepts valid execution definition choices and keeps them immutable', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertSucceeds(setDoc(doc(ownerDb, sessionExecPath), { ...validSessionExecution(), executedDefinition: 'reduced' }));
        await assertFails(updateDoc(doc(ownerDb, sessionExecPath), { executedDefinition: 'authored' }));
        await assertFails(setDoc(doc(ownerDb, `users/${ownerId}/session_executions/exec-invalid`), { ...validSessionExecution(), executionId: 'exec-invalid', executedDefinition: 'unknown' }));
        await assertSucceeds(setDoc(doc(ownerDb, `users/${ownerId}/session_executions/exec-authored`), { ...validSessionExecution(), executionId: 'exec-authored', executedDefinition: 'authored' }));
    });

    it.each([
        { kind: 'catalog', workoutId: 'workout-1', catalogVersion: 'v1' },
        { kind: 'external_plan', planId: 'plan-1', revision: 1, sessionId: 'session-1', contentHash: 'hash-1' },
        { kind: 'manual', definitionId: 'definition-1', revision: 1, contentHash: 'hash-1' },
        { kind: 'unplanned_fixture', fixtureId: 'fixture-1' },
    ])('requires every identity field in a $kind session source', async sessionSource => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertSucceeds(setDoc(doc(ownerDb, sessionExecPath), { ...validSessionExecution(), sessionSource }));
        for (const key of Object.keys(sessionSource)) {
            const incomplete: Record<string, unknown> = { ...sessionSource };
            delete incomplete[key];
            const executionId = `missing-${key}`;
            await assertFails(setDoc(doc(ownerDb, `users/${ownerId}/session_executions/${executionId}`), {
                ...validSessionExecution(), executionId, sessionSource: incomplete,
            }));
        }
    });

    it.each(['definitionRef', 'externalPlanRef'] as const)('requires every field in an occurrence %s', async refKey => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        const occurrence = refKey === 'definitionRef' ? validSessionOccurrence() : validExternalPlanSessionOccurrence();
        const reference: Record<string, unknown> = refKey === 'definitionRef'
            ? validSessionOccurrence().definitionRef : validExternalPlanSessionOccurrence().externalPlanRef;
        for (const key of Object.keys(reference)) {
            const incomplete = { ...reference };
            delete incomplete[key];
            const occurrenceId = `missing-${key}`;
            await assertFails(setDoc(doc(ownerDb, `users/${ownerId}/session_occurrences/${occurrenceId}`), {
                ...occurrence, occurrenceId, [refKey]: incomplete,
            }));
        }
    });

    function boundExternalOccurrence(overrides: Record<string, unknown> = {}): Record<string, unknown> {
        return {
            ...validExternalPlanSessionOccurrence(),
            occurrenceId: 'occ-ext-values',
            placementOrder: 0,
            windowBinding: {
                windowId: 'window-1', bundleId: 'bundle-1', order: 0,
                boundStartLocal: '07:00', boundEndLocal: '08:00',
                startInstant: '2026-08-18T05:00:00Z', endInstant: '2026-08-18T06:00:00Z',
            },
            ...overrides,
        };
    }

    function occurrenceWith(base: Record<string, unknown>, field: string, nested: Record<string, unknown>) {
        return { ...base, [field]: { ...(base[field] as Record<string, unknown>), ...nested } };
    }

    // Each case creates the document at its own path, so it fails only for the kept check it names.
    it.each([
        ['an unknown state (kept: the transition table and cross-document reads depend on it)', () => ({ ...validSessionOccurrence(), state: 'paused' })],
        ['an occurrenceId that does not match its path', () => ({ ...validSessionOccurrence(), occurrenceId: 'occ-other' })],
        ['a foreign userId', () => ({ ...validSessionOccurrence(), userId: otherUserId })],
        ['a missing updatedAt', () => { const o: Record<string, unknown> = { ...validSessionOccurrence() }; delete o.updatedAt; return o; }],
        ['a missing date', () => { const o: Record<string, unknown> = { ...validSessionOccurrence() }; delete o.date; return o; }],
        ['a missing authority', () => { const o: Record<string, unknown> = { ...validSessionOccurrence() }; delete o.authority; return o; }],
        ['neither ref', () => { const o: Record<string, unknown> = { ...validSessionOccurrence() }; delete o.definitionRef; return o; }],
        ['a definitionRef missing revision', () => {
            const ref: Record<string, unknown> = { ...validSessionOccurrence().definitionRef }; delete ref.revision;
            return { ...validSessionOccurrence(), definitionRef: ref };
        }],
        ['an externalPlanRef missing revision', () => {
            const o = boundExternalOccurrence();
            const ref: Record<string, unknown> = { ...(o.externalPlanRef as Record<string, unknown>) }; delete ref.revision;
            return { ...o, externalPlanRef: ref };
        }],
        ['an extra definitionRef key', () => occurrenceWith(validSessionOccurrence(), 'definitionRef', { extra: 1 })],
        ['an extra externalPlanRef key', () => occurrenceWith(boundExternalOccurrence(), 'externalPlanRef', { extra: 1 })],
        ['a planId over 64 characters', () => occurrenceWith(boundExternalOccurrence(), 'externalPlanRef', { planId: 'p'.repeat(65) })],
        ['a sessionId over 64 characters', () => occurrenceWith(boundExternalOccurrence(), 'externalPlanRef', { sessionId: 's'.repeat(65) })],
        ['a plan contentHash over 128 characters', () => occurrenceWith(boundExternalOccurrence(), 'externalPlanRef', { contentHash: 'c'.repeat(129) })],
        ['an extra windowBinding key', () => occurrenceWith(boundExternalOccurrence(), 'windowBinding', { extra: 1 })],
        ['a windowId over 128 characters', () => occurrenceWith(boundExternalOccurrence(), 'windowBinding', { windowId: 'w'.repeat(129) })],
        ['a bundleId over 128 characters', () => occurrenceWith(boundExternalOccurrence(), 'windowBinding', { bundleId: 'b'.repeat(129) })],
    ])('rejects a session occurrence with %s', async (_label, build) => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        const occurrence: Record<string, unknown> = build();
        const pathId = occurrence.occurrenceId === 'occ-other' ? 'occ-unplanned-1' : String(occurrence.occurrenceId);
        await assertFails(setDoc(doc(ownerDb, `users/${ownerId}/session_occurrences/${pathId}`), occurrence));
    });

    // Issue #1202 (ADR-0053): these value checks are owned by validateSessionOccurrence, which
    // every occurrence writer runs through assertValidSessionOccurrence before its write -- see
    // sessions/validation.test.ts, sessionOccurrenceService.test.ts and
    // manualRecommendationReplacementService.test.ts.
    it.each([
        ['an impossible date', () => ({ ...validSessionOccurrence(), date: '2026-02-30' })],
        ['an empty definitionId', () => occurrenceWith(validSessionOccurrence(), 'definitionRef', { definitionId: '' })],
        ['a zero definition revision', () => occurrenceWith(validSessionOccurrence(), 'definitionRef', { revision: 0 })],
        ['a zero plan revision', () => occurrenceWith(boundExternalOccurrence(), 'externalPlanRef', { revision: 0 })],
        ['a negative placementOrder', () => boundExternalOccurrence({ placementOrder: -1 })],
        ['a negative window order', () => occurrenceWith(boundExternalOccurrence(), 'windowBinding', { order: -1 })],
        ['an empty window bound', () => occurrenceWith(boundExternalOccurrence(), 'windowBinding', { boundStartLocal: '' })],
        ['an empty window instant', () => occurrenceWith(boundExternalOccurrence(), 'windowBinding', { endInstant: '' })],
    ])('accepts a session occurrence with %s at the rules boundary (validateSessionOccurrence owns it)', async (_label, build) => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        const occurrence = build();
        await assertSucceeds(setDoc(doc(ownerDb, `users/${ownerId}/session_occurrences/${String(occurrence.occurrenceId)}`), occurrence));
    });

    it('requires every external plan placement field', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        const placement = validExternalPlacement();
        for (const key of Object.keys(placement)) {
            const incomplete: Record<string, unknown> = { ...placement };
            delete incomplete[key];
            await assertFails(setDoc(doc(ownerDb, externalPlacementPath), incomplete));
        }
    });

    it('allows execution lifecycle with entry subcollection mutability while in_progress, and terminal immutability', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();

        // 1. Create in_progress execution
        await expect(assertSucceeds(setDoc(doc(ownerDb, sessionExecPath), validSessionExecution()))).resolves.toBeUndefined();

        // 2. Add entry while in progress
        await expect(assertSucceeds(setDoc(doc(ownerDb, sessionEntryPath), validSessionEntry()))).resolves.toBeUndefined();

        // 3. Update entry while in progress
        await expect(assertSucceeds(setDoc(doc(ownerDb, sessionEntryPath), {
            ...validSessionEntry(),
            payload: { kind: 'repetition', setIndex: 1, reps: 10, weightKg: 65, isWarmup: false },
        }))).resolves.toBeUndefined();

        // 4. Transition execution to completed
        const completedExec = {
            ...validSessionExecution(),
            state: 'completed',
            completedAt: '2026-08-18T10:45:00Z',
            updatedAt: '2026-08-18T10:45:00Z',
            sessionRpe: 7,
        };
        await expect(assertSucceeds(setDoc(doc(ownerDb, sessionExecPath), completedExec))).resolves.toBeUndefined();

        // 5. Terminal execution is immutable
        await assertFails(setDoc(doc(ownerDb, sessionExecPath), {
            ...completedExec,
            notes: 'Mutated after completion',
        }));

        // 6. Entries cannot be added or mutated once parent execution is completed
        await assertFails(setDoc(doc(ownerDb, `${sessionExecPath}/entries/entry-2`), {
            ...validSessionEntry(),
            id: 'entry-2',
        }));
    });

    it('enforces fitWorkoutFingerprint validation and immutability on session_executions', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        const validFp = 'fit-workout-v2:0123456789abcdef0123456789abcdef';
        const fpExecPath = `users/${ownerId}/session_executions/exec-fp-1`;

        // 1. Valid create with fitWorkoutFingerprint and kind
        const execWithFp = {
            ...validSessionExecution(),
            executionId: 'exec-fp-1',
            fitWorkoutFingerprint: validFp,
            fitWorkoutFingerprintKind: 'semantic_definition',
        };
        await expect(assertSucceeds(setDoc(doc(ownerDb, fpExecPath), execWithFp))).resolves.toBeUndefined();

        // 2. Transition state while keeping fitWorkoutFingerprint and kind unchanged succeeds
        await expect(assertSucceeds(setDoc(doc(ownerDb, fpExecPath), {
            ...execWithFp,
            state: 'completed',
            completedAt: '2026-08-18T10:45:00Z',
            updatedAt: '2026-08-18T10:45:00Z',
        }))).resolves.toBeUndefined();

        // 3. Mutating fitWorkoutFingerprint fails (immutability)
        const fpExec2Path = `users/${ownerId}/session_executions/exec-fp-2`;
        const execWithFp2 = {
            ...validSessionExecution(),
            executionId: 'exec-fp-2',
            fitWorkoutFingerprint: validFp,
            fitWorkoutFingerprintKind: 'semantic_definition',
        };
        await expect(assertSucceeds(setDoc(doc(ownerDb, fpExec2Path), execWithFp2))).resolves.toBeUndefined();

        await assertFails(updateDoc(doc(ownerDb, fpExec2Path), {
            fitWorkoutFingerprint: 'fit-workout-v2:fedcba9876543210fedcba9876543210',
            updatedAt: '2026-08-18T10:10:00Z',
        }));

        // 4. Mutating fitWorkoutFingerprintKind fails (immutability)
        await assertFails(updateDoc(doc(ownerDb, fpExec2Path), {
            fitWorkoutFingerprintKind: 'index_fallback',
            updatedAt: '2026-08-18T10:10:00Z',
        }));

        // 5. Creating with malformed fingerprint fails
        await assertFails(setDoc(doc(ownerDb, `users/${ownerId}/session_executions/exec-bad-fp`), {
            ...validSessionExecution(),
            executionId: 'exec-bad-fp',
            fitWorkoutFingerprint: 'malformed-fp',
            fitWorkoutFingerprintKind: 'semantic_definition',
        }));

        // 6. Creating with invalid kind fails
        await assertFails(setDoc(doc(ownerDb, `users/${ownerId}/session_executions/exec-bad-kind`), {
            ...validSessionExecution(),
            executionId: 'exec-bad-kind',
            fitWorkoutFingerprint: validFp,
            fitWorkoutFingerprintKind: 'invalid_kind',
        }));

        // 7. Fingerprint provenance is atomic: neither half may be persisted alone.
        await assertFails(setDoc(doc(ownerDb, `users/${ownerId}/session_executions/exec-fp-without-kind`), {
            ...validSessionExecution(),
            executionId: 'exec-fp-without-kind',
            fitWorkoutFingerprint: validFp,
        }));
        await assertFails(setDoc(doc(ownerDb, `users/${ownerId}/session_executions/exec-kind-without-fp`), {
            ...validSessionExecution(),
            executionId: 'exec-kind-without-fp',
            fitWorkoutFingerprintKind: 'semantic_definition',
        }));
    });

    it('allows a rest event while in_progress, rejects it once terminal, and enforces retry-only-same-instance updates (PR 3, training-occurrence plan)', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await expect(assertSucceeds(setDoc(doc(ownerDb, sessionExecPath), validSessionExecution()))).resolves.toBeUndefined();

        // Create while in progress.
        await expect(assertSucceeds(setDoc(doc(ownerDb, sessionRestEventPath), validSessionRestEvent()))).resolves.toBeUndefined();

        // A retried write for the same rest instance (identical afterEntryId/startedAt/
        // endReason/createdAt) is allowed -- this is what makes a duplicate client event
        // converge instead of duplicating.
        await expect(assertSucceeds(setDoc(doc(ownerDb, sessionRestEventPath), validSessionRestEvent()))).resolves.toBeUndefined();

        // The rest's own identity (afterEntryId/startedAt/endReason) is immutable on update.
        await assertFails(setDoc(doc(ownerDb, sessionRestEventPath), {
            ...validSessionRestEvent(), endReason: 'skipped',
        }));
        await assertFails(setDoc(doc(ownerDb, sessionRestEventPath), {
            ...validSessionRestEvent(), afterEntryId: 'entry-2',
        }));

        // Delete is never allowed.
        await assertFails(deleteDoc(doc(ownerDb, sessionRestEventPath)));

        // Cross-user denial.
        const otherDb = testEnvironment.authenticatedContext(otherUserId).firestore();
        await assertFails(getDoc(doc(otherDb, sessionRestEventPath)));
        await assertFails(setDoc(doc(otherDb, sessionRestEventPath), validSessionRestEvent()));

        // Once the execution is terminal, no new (or updated) rest event may be written.
        await expect(assertSucceeds(setDoc(doc(ownerDb, sessionExecPath), {
            ...validSessionExecution(), state: 'completed', completedAt: '2026-08-18T10:45:00Z', updatedAt: '2026-08-18T10:45:00Z',
        }))).resolves.toBeUndefined();
        await assertFails(setDoc(doc(ownerDb, `${sessionExecPath}/restEvents/rest-2`), {
            ...validSessionRestEvent(), id: 'rest-2', afterEntryId: 'entry-2',
        }));
    });

    it('rejects a malformed rest event', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await expect(assertSucceeds(setDoc(doc(ownerDb, sessionExecPath), validSessionExecution()))).resolves.toBeUndefined();

        await assertFails(setDoc(doc(ownerDb, sessionRestEventPath), { ...validSessionRestEvent(), actualSeconds: -1 }));
        await assertFails(setDoc(doc(ownerDb, sessionRestEventPath), { ...validSessionRestEvent(), endReason: 'not_a_real_reason' }));
        await assertFails(setDoc(doc(ownerDb, sessionRestEventPath), { ...validSessionRestEvent(), id: 'wrong-id' }));
    });

    it('enforces session_execution_locks as a server-side single-winner claim (#663)', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        const otherDb = testEnvironment.authenticatedContext(otherUserId).firestore();
        const lockPath = `users/${ownerId}/session_execution_locks/rx-2026-08-18-nohash`;
        const execution = validSessionExecution();
        const execution2Path = `users/${ownerId}/session_executions/exec-2`;
        const execution2 = {
            ...validSessionExecution(),
            executionId: 'exec-2',
            startedAt: '2026-08-18T11:00:00Z',
            updatedAt: '2026-08-18T11:00:00Z',
        };
        const validLock = {
            userId: ownerId,
            executionId: execution.executionId,
            date: execution.date,
            allowCompletedReplacement: false,
            updatedAt: '2026-08-18T10:00:00Z',
            schemaVersion: 1,
        };

        // This is the exact offline fallback shape: neither doc exists yet, then one atomic
        // batch creates the execution and its lock. getAfter() must see the paired execution.
        const firstClaim = writeBatch(ownerDb);
        firstClaim.set(doc(ownerDb, sessionExecPath), execution);
        firstClaim.set(doc(ownerDb, lockPath), validLock);
        await expect(assertSucceeds(firstClaim.commit())).resolves.toBeUndefined();

        // A second blind/offline batch cannot steal an in-progress slot, and atomicity means
        // its otherwise-valid execution document is rolled back with the rejected lock move.
        const racingClaim = writeBatch(ownerDb);
        racingClaim.set(doc(ownerDb, execution2Path), execution2);
        racingClaim.set(doc(ownerDb, lockPath), {
            ...validLock,
            executionId: 'exec-2',
            updatedAt: '2026-08-18T11:00:00Z',
        });
        await assertFails(racingClaim.commit());
        expect((await getDoc(doc(ownerDb, execution2Path))).exists()).toBe(false);

        // Completing the old execution still does not permit an implicit duplicate.
        await expect(assertSucceeds(setDoc(doc(ownerDb, sessionExecPath), {
            ...execution,
            state: 'completed',
            completedAt: '2026-08-18T10:45:00Z',
            updatedAt: '2026-08-18T10:45:00Z',
        }))).resolves.toBeUndefined();
        const unconfirmedRedo = writeBatch(ownerDb);
        unconfirmedRedo.set(doc(ownerDb, execution2Path), execution2);
        unconfirmedRedo.set(doc(ownerDb, lockPath), {
            ...validLock,
            executionId: 'exec-2',
            updatedAt: '2026-08-18T11:00:00Z',
        });
        await assertFails(unconfirmedRedo.commit());
        expect((await getDoc(doc(ownerDb, execution2Path))).exists()).toBe(false);

        // Explicit redo may atomically create a second execution and move the pointer.
        const confirmedRedo = writeBatch(ownerDb);
        confirmedRedo.set(doc(ownerDb, execution2Path), execution2);
        confirmedRedo.set(doc(ownerDb, lockPath), {
            ...validLock,
            executionId: 'exec-2',
            allowCompletedReplacement: true,
            updatedAt: '2026-08-18T11:00:00Z',
        });
        await expect(assertSucceeds(confirmedRedo.commit())).resolves.toBeUndefined();

        // A dangling pointer is repairable. This also proves the rules short-circuit the
        // missing-resource read instead of turning a deleted target into permission-denied.
        await testEnvironment.withSecurityRulesDisabled(async context => {
            await deleteDoc(doc(context.firestore(), execution2Path));
        });
        const execution3Path = `users/${ownerId}/session_executions/exec-3`;
        const execution3 = {
            ...validSessionExecution(),
            executionId: 'exec-3',
            startedAt: '2026-08-18T12:00:00Z',
            updatedAt: '2026-08-18T12:00:00Z',
        };
        const repairClaim = writeBatch(ownerDb);
        repairClaim.set(doc(ownerDb, execution3Path), execution3);
        repairClaim.set(doc(ownerDb, lockPath), {
            ...validLock,
            executionId: 'exec-3',
            updatedAt: '2026-08-18T12:00:00Z',
        });
        await expect(assertSucceeds(repairClaim.commit())).resolves.toBeUndefined();

        // Shape, ownership, target identity, and anchor deletion stay fail-closed.
        await assertFails(setDoc(doc(ownerDb, lockPath), { ...validLock, userId: otherUserId }));
        await assertFails(setDoc(doc(ownerDb, lockPath), { ...validLock, executionId: '' }));
        await assertFails(setDoc(doc(ownerDb, lockPath), { ...validLock, date: '2026-08-19' }));
        await assertFails(setDoc(doc(ownerDb, lockPath), { ...validLock, extraField: true }));
        await assertFails(setDoc(doc(otherDb, lockPath), validLock));
        await assertFails(getDoc(doc(otherDb, lockPath)));
        await assertFails(deleteDoc(doc(ownerDb, lockPath)));
    });

    it('rejects an execution with an incomplete or unknown source reference', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertFails(setDoc(doc(ownerDb, `${sessionExecPath}-bad-source`), {
            ...validSessionExecution(),
            executionId: 'exec-1-bad-source',
            sessionSource: { kind: 'manual', definitionId: 'def-full-body' },
        }));
    });

    it('rejects malformed performed-entry payloads while the execution is in progress', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await expect(assertSucceeds(setDoc(doc(ownerDb, sessionExecPath), validSessionExecution()))).resolves.toBeUndefined();
        await assertFails(setDoc(doc(ownerDb, sessionEntryPath), {
            ...validSessionEntry(),
            payload: { kind: 'repetition', setIndex: 0, reps: 0 },
        }));
    });

    it('accepts a carried load on a distance entry and rejects a negative one', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await expect(assertSucceeds(setDoc(doc(ownerDb, sessionExecPath), validSessionExecution()))).resolves.toBeUndefined();
        await expect(assertSucceeds(setDoc(doc(ownerDb, sessionEntryPath), {
            ...validSessionEntry(),
            payload: { kind: 'distance', meters: 40, durationSeconds: 35, loadKg: 48 },
        }))).resolves.toBeUndefined();
        await assertFails(setDoc(doc(ownerDb, sessionEntryPath), {
            ...validSessionEntry(),
            payload: { kind: 'distance', meters: 40, loadKg: -1 },
        }));
    });

    it('records a recorded athlete choice (D-MCHOICE) while in progress, rejects it once terminal or cross-user, and rejects a malformed one', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        const validChoiceEntry = {
            id: 'entry-choice-1',
            executionId: 'exec-1',
            stepId: 'step-str-1',
            selectedOptionId: 'reduce-squat-load',
            completedAt: '2026-08-18T10:05:00Z',
            createdAt: '2026-08-18T10:05:00Z',
            updatedAt: '2026-08-18T10:05:00Z',
            payload: { kind: 'choice', choiceId: 'choice-squat-warmup', optionId: 'reduce-squat-load', reason: 'Warm-up felt heavy' },
        };

        await expect(assertSucceeds(setDoc(doc(ownerDb, sessionExecPath), validSessionExecution()))).resolves.toBeUndefined();

        // Recorded while in progress.
        await expect(assertSucceeds(setDoc(
            doc(ownerDb, `${sessionExecPath}/entries/entry-choice-1`),
            validChoiceEntry,
        ))).resolves.toBeUndefined();

        // Malformed: missing optionId.
        await assertFails(setDoc(doc(ownerDb, `${sessionExecPath}/entries/entry-choice-2`), {
            ...validChoiceEntry,
            id: 'entry-choice-2',
            payload: { kind: 'choice', choiceId: 'choice-squat-warmup' },
        }));

        // Another user cannot write into this execution's entries at all.
        const otherDb = testEnvironment.authenticatedContext(otherUserId).firestore();
        await assertFails(setDoc(doc(otherDb, `${sessionExecPath}/entries/entry-choice-3`), {
            ...validChoiceEntry,
            id: 'entry-choice-3',
        }));

        // Terminal immutability: no new choice entry once the execution is completed.
        await expect(assertSucceeds(setDoc(doc(ownerDb, sessionExecPath), {
            ...validSessionExecution(),
            state: 'completed',
            completedAt: '2026-08-18T10:45:00Z',
            updatedAt: '2026-08-18T10:45:00Z',
        }))).resolves.toBeUndefined();
        await assertFails(setDoc(doc(ownerDb, `${sessionExecPath}/entries/entry-choice-4`), {
            ...validChoiceEntry,
            id: 'entry-choice-4',
        }));
    });

    it('allows an owner to record and revise a session response, and rejects a cross-user read/write', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await expect(assertSucceeds(setDoc(doc(ownerDb, sessionResponsePath), validSessionResponse()))).resolves.toBeUndefined();

        // Edits preserve provenance: only non-tissue facts and updatedAt may change.
        await expect(assertSucceeds(setDoc(doc(ownerDb, sessionResponsePath), {
            ...validSessionResponse(),
            sessionRpe: 8,
            note: 'legs felt heavier than expected',
            updatedAt: '2026-08-18T11:00:00Z',
        }))).resolves.toBeUndefined();

        // Another user can neither read nor write this response.
        const otherDb = testEnvironment.authenticatedContext(otherUserId).firestore();
        await assertFails(getDoc(doc(otherDb, sessionResponsePath)));
        await assertFails(setDoc(doc(otherDb, sessionResponsePath), validSessionResponse()));
    });

    it('rejects an edit that changes sourceSession, window, date or createdAt (provenance)', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await expect(assertSucceeds(setDoc(doc(ownerDb, sessionResponsePath), validSessionResponse()))).resolves.toBeUndefined();

        await assertFails(setDoc(doc(ownerDb, sessionResponsePath), {
            ...validSessionResponse(),
            sourceSession: { kind: 'strength', id: 'strength-1', date: '2026-08-18' },
        }));
        await assertFails(setDoc(doc(ownerDb, sessionResponsePath), { ...validSessionResponse(), date: '2026-08-19' }));
        // A window change that is valid on its own (same-day later_day) still fails: the
        // update rule keeps window equal to the create-validated value.
        await assertFails(setDoc(doc(ownerDb, sessionResponsePath), { ...validSessionResponse(), window: 'later_day' }));
        await assertFails(setDoc(doc(ownerDb, sessionResponsePath), { ...validSessionResponse(), createdAt: '2026-08-19T00:00:00Z' }));
    });

    // Issue #1202 (ADR-0053): the window/date ordering, the window enum, the dates, the
    // sourceSession values and the sessionRpe/completedFraction/unexpectedFatigue values are
    // owned by validateSessionResponse and validateSessionResponseFacts
    // (responses/validation.ts), which SessionResponseService runs before every write -- see
    // responses/validation.test.ts and sessionResponseService.test.ts.
    it.each([
        ['a same-day next_morning response', { window: 'next_morning' }],
        ['a next-day later_day response', { window: 'later_day', date: '2026-08-19' }],
        ['an unknown window', { window: 'next_week' }],
        ['an impossible date', { date: '2026-02-30' }],
        ['an unknown sourceSession kind', { sourceSession: { kind: 'manual', id: 'exec-1', date: '2026-08-18' } }],
        ['an empty sourceSession id', { sourceSession: { kind: 'execution', id: '', date: '2026-08-18' } }],
        ['a malformed checkinRef date', { checkinRef: { date: '18-08-2026' } }],
        ['an out-of-range sessionRpe', { sessionRpe: 11 }],
        ['an out-of-range completedFraction', { completedFraction: 1.5 }],
        ['a non-boolean unexpectedFatigue', { unexpectedFatigue: 'yes' }],
    ])('accepts %s at the rules boundary (validateSessionResponse owns it)', async (_label, override) => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await expect(assertSucceeds(setDoc(doc(ownerDb, sessionResponsePath), {
            ...validSessionResponse(), ...override,
        }))).resolves.toBeUndefined();
    });

    // Each case creates resp-1 directly, so it fails only for the kept check it names.
    it.each([
        ['an extra field', { unexpectedField: true }],
        ['a foreign userId', { userId: otherUserId }],
        ['a responseId that does not match its path', { responseId: 'resp-2' }],
        ['an extra sourceSession key', { sourceSession: { kind: 'execution', id: 'exec-1', date: '2026-08-18', extra: 1 } }],
        ['a missing sourceSession key', { sourceSession: { kind: 'execution', id: 'exec-1' } }],
        ['an extra checkinRef key', { checkinRef: { date: '2026-08-18', extra: 1 } }],
        ['an empty checkinRef', { checkinRef: {} }],
        ['a note over 2000 characters', { note: 'x'.repeat(2001) }],
        ['a techniqueNote over 2000 characters', { techniqueNote: 'x'.repeat(2001) }],
        ['a non-string updatedAt (the launch claim compares it)', { updatedAt: 5 }],
    ])('rejects a session response with %s', async (_label, override) => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertFails(setDoc(doc(ownerDb, sessionResponsePath), { ...validSessionResponse(), ...override }));
    });

    it('rejects an edit that adds or changes occurrenceId after creation (provenance)', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await expect(assertSucceeds(setDoc(doc(ownerDb, sessionOccPath), validSessionOccurrence()))).resolves.toBeUndefined();
        await expect(assertSucceeds(setDoc(doc(ownerDb, `users/${ownerId}/session_occurrences/occ-unplanned-2`), {
            ...validSessionOccurrence(), occurrenceId: 'occ-unplanned-2',
        }))).resolves.toBeUndefined();

        // Created with no occurrenceId (e.g. a companion/unplanned execution) -- an edit
        // cannot retroactively grant it selection authority by adding one.
        await expect(assertSucceeds(setDoc(doc(ownerDb, sessionResponsePath), validSessionResponse()))).resolves.toBeUndefined();
        await assertFails(setDoc(doc(ownerDb, sessionResponsePath), {
            ...validSessionResponse(), occurrenceId: 'occ-unplanned-1',
        }));

        // Created with an occurrenceId -- an edit cannot swap it for a different one.
        const withOccurrencePath = `${sessionResponsePath}-with-occ`;
        await expect(assertSucceeds(setDoc(doc(ownerDb, withOccurrencePath), {
            ...validSessionResponse(), responseId: 'resp-1-with-occ', occurrenceId: 'occ-unplanned-1',
        }))).resolves.toBeUndefined();
        await assertFails(setDoc(doc(ownerDb, withOccurrencePath), {
            ...validSessionResponse(), responseId: 'resp-1-with-occ', occurrenceId: 'occ-unplanned-2',
        }));
    });

    it('rejects a response whose occurrenceId does not reference a real occurrence of this user', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        // No session_occurrences/occ-unplanned-1 document has been written in this test.
        await assertFails(setDoc(doc(ownerDb, sessionResponsePath), {
            ...validSessionResponse(),
            occurrenceId: 'occ-unplanned-1',
        }));

        await expect(assertSucceeds(setDoc(doc(ownerDb, sessionOccPath), validSessionOccurrence()))).resolves.toBeUndefined();
        await expect(assertSucceeds(setDoc(doc(ownerDb, sessionResponsePath), {
            ...validSessionResponse(),
            occurrenceId: 'occ-unplanned-1',
        }))).resolves.toBeUndefined();
    });

    // --- ADR-0039: Hunger 1-10 on check-in ---
    it('allows check-in hunger values, leaving hunger validation to validateCheckin', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        // Valid hunger endpoints 1 and 10 with timing
        await expect(assertSucceeds(setDoc(doc(ownerDb, checkinPath), {
            ...validCheckinWithSessionResponse(),
            hunger1To10: 1,
            hungerTiming: 'morning_pre_breakfast',
        }))).resolves.toBeUndefined();

        await expect(assertSucceeds(setDoc(doc(ownerDb, checkinPath), {
            ...validCheckinWithSessionResponse(),
            hunger1To10: 10,
            hungerTiming: 'other',
        }))).resolves.toBeUndefined();

        // Valid cleared state
        await expect(assertSucceeds(setDoc(doc(ownerDb, checkinPath), {
            ...validCheckinWithSessionResponse(),
            hunger1To10: null,
            hungerTiming: null,
        }))).resolves.toBeUndefined();

        // Issue #1201: the hunger range/integer check is owned by engine/validation.ts
        // validateCheckin (checkinService.upsertCheckin); see validation.hunger.test.ts.
        // The rules accept these values.
        for (const malformed of [
            { hunger1To10: 0, hungerTiming: 'morning_pre_breakfast' },
            { hunger1To10: 5.5, hungerTiming: 'morning_pre_breakfast' },
        ]) {
            await assertSucceeds(setDoc(doc(ownerDb, checkinPath), { ...validCheckinWithSessionResponse(), ...malformed }));
        }

        // The hunger/timing coupling stays in the rules: upsertCheckin merges, so only the
        // rules see the merged document.
        await assertFails(setDoc(doc(ownerDb, checkinPath), {
            ...validCheckinWithSessionResponse(),
            hunger1To10: 5,
        }));
        await assertFails(setDoc(doc(ownerDb, checkinPath), {
            ...validCheckinWithSessionResponse(),
            hungerTiming: 'morning_pre_breakfast',
        }));
        await assertSucceeds(setDoc(doc(ownerDb, checkinPath), {
            ...validCheckinWithSessionResponse(),
            hunger1To10: 5,
            hungerTiming: 'morning_pre_breakfast',
        }));
        // A merge payload that is coupled on its own can still decouple the merged document.
        await assertSucceeds(setDoc(doc(ownerDb, checkinPath), { hunger1To10: 6 }, { merge: true }));
        await assertFails(setDoc(doc(ownerDb, checkinPath), { hungerTiming: null }, { merge: true }));
    });

    // --- ADR-0042: Nutrition tracking adherence on check-in ---
    it('allows check-in nutritionAdherenceYesterday values, leaving the enum to validateCheckin', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        const validValues = ['fully_tracked', 'mostly_tracked', 'minimal', 'untracked', 'fasted'] as const;

        for (const val of validValues) {
            await expect(assertSucceeds(setDoc(doc(ownerDb, checkinPath), {
                ...validCheckinWithSessionResponse(),
                nutritionAdherenceYesterday: val,
            }))).resolves.toBeUndefined();
        }

        // Valid null / cleared
        await expect(assertSucceeds(setDoc(doc(ownerDb, checkinPath), {
            ...validCheckinWithSessionResponse(),
            nutritionAdherenceYesterday: null,
        }))).resolves.toBeUndefined();

        // Issue #1201: the adherence enum is owned by validateCheckin
        // (validation.nutritionAdherence.test.ts); the rules accept other values.
        await assertSucceeds(setDoc(doc(ownerDb, checkinPath), {
            ...validCheckinWithSessionResponse(),
            nutritionAdherenceYesterday: 'partially_tracked',
        }));
    });

    it('rejects cross-user access to check-ins carrying nutritionAdherenceYesterday', async () => {
        await testEnvironment.withSecurityRulesDisabled(async context => {
            await setDoc(doc(context.firestore(), checkinPath), {
                ...validCheckinWithSessionResponse(),
                nutritionAdherenceYesterday: 'fasted',
            });
        });
        const otherDb = testEnvironment.authenticatedContext(otherUserId).firestore();
        await assertFails(getDoc(doc(otherDb, checkinPath)));
        await assertFails(setDoc(doc(otherDb, checkinPath), {
            ...validCheckinWithSessionResponse(),
            nutritionAdherenceYesterday: 'fasted',
        }));
    });

    // --- ADR-0039: Anthropometry entries ---
    const anthropometryPath = `users/${ownerId}/anthropometry_entries/entry-1`;

    function validAnthropometryEntryDoc() {
        return {
            id: 'entry-1',
            userId: ownerId,
            date: '2026-09-14',
            observedAt: '2026-09-14T06:00:00Z',
            protocol: 'home_anthropometry@1',
            context: {
                morningPostVoidPreIntake: true,
                trainingBeforeMeasurement: false,
                respiratoryState: 'relaxed_normal_expiration',
                posture: 'standing_relaxed',
                clothing: 'minimal_or_bare_skin',
            },
            measurements: [
                { metricId: 'waist_minimum_cm', unit: 'cm', readings: [82.0, 82.4], value: 82.2 },
            ],
            schemaVersion: 1,
            revision: 1,
            createdAt: '2026-09-14T06:00:00Z',
            updatedAt: '2026-09-14T06:00:00Z',
        };
    }

    it('allows owner-scoped reads but denies every direct SDK mutation', async () => {
        await testEnvironment.withSecurityRulesDisabled(async context => {
            await setDoc(doc(context.firestore(), anthropometryPath), validAnthropometryEntryDoc());
        });
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await expect(assertSucceeds(getDoc(doc(ownerDb, anthropometryPath)))).resolves.toBeDefined();

        await assertFails(setDoc(doc(ownerDb, `${anthropometryPath}-new`), {
            ...validAnthropometryEntryDoc(),
            id: 'entry-new',
        }));
        await assertFails(setDoc(doc(ownerDb, anthropometryPath), {
            ...validAnthropometryEntryDoc(),
            revision: 2,
        }));
        await assertFails(deleteDoc(doc(ownerDb, anthropometryPath)));
    });

    it('rejects cross-user anthropometry access', async () => {
        await testEnvironment.withSecurityRulesDisabled(async context => {
            await setDoc(doc(context.firestore(), anthropometryPath), validAnthropometryEntryDoc());
        });
        const otherDb = testEnvironment.authenticatedContext(otherUserId).firestore();
        await assertFails(getDoc(doc(otherDb, anthropometryPath)));
        await assertFails(setDoc(doc(otherDb, anthropometryPath), validAnthropometryEntryDoc()));
        await assertFails(deleteDoc(doc(otherDb, anthropometryPath)));
    });

});
