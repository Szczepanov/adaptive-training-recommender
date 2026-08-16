/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, deleteDoc } from 'firebase/firestore';

const emulatorDescribe = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
let testEnvironment: RulesTestEnvironment;

const ownerId = 'athlete-a';
const otherUserId = 'athlete-b';
const recommendationPath = `users/${ownerId}/daily_recommendations/2026-08-07`;
const fixedActivityPath = `users/${ownerId}/fixed_activities/activity-1`;
const planBlockPath = `users/${ownerId}/plan_blocks/trip-august`;
const trainingIntentProfilePath = `users/${ownerId}/training_intent/profile`;
const preferencesPath = `users/${ownerId}/preferences/profile`;
const goalPath = `users/${ownerId}/goals/goal-1`;
const externalPlanPath = `users/${ownerId}/external_plans/autumn-block`;
const externalRevisionPath = `${externalPlanPath}/revisions/1`;
const externalPlacementPath = `${externalPlanPath}/placement/current`;
const decisionJournalPath = `users/${ownerId}/decision_journal/2026-08-07`;

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

function validExternalPlacement() {
    return {
        userId: ownerId, planId: 'autumn-block', revision: 1,
        assignments: [{ sessionId: 'w1-a', date: '2026-08-18', status: 'planned' }],
        updatedAt: '2026-08-15T06:00:00Z',
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
        // evaluatedAt is real-time in production (buildRecommendationAudit defaults to
        // `new Date().toISOString()`), so two audits for the *same* decision are never
        // byte-identical across separate saves. Tests that want to prove a same-decision
        // resave is accepted must reuse one literal audit object across before/after, not
        // call this factory twice -- calling it twice with different evaluatedAt values is
        // exactly the real-world "different audit" case.
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

    it('allows a well-formed goal taper and rejects a malformed taper object', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertSucceeds(setDoc(doc(ownerDb, goalPath), validGoal()));
        await assertFails(setDoc(doc(ownerDb, `${goalPath}-bad`), { ...validGoal(), taper: { startDate: 123 } }));
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

    it('accepts an audit carrying external plan provenance, and rejects a malformed one', async () => {
        // Every externally-planned day writes this field. Omitting it from the audit's
        // hasOnly list denied the write outright, and Home only warns on a failed save --
        // so the whole mode would have silently persisted nothing.
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        const external = validRecommendation();
        external.recommendationAudit.externalPlan = {
            planId: 'autumn-block', revision: 2, sessionId: 'w1-threshold', contentHash: 'a'.repeat(64),
        };
        await assertSucceeds(setDoc(doc(ownerDb, recommendationPath), external));

        for (const broken of [
            { planId: 'autumn-block', revision: 2, sessionId: 'w1-threshold' },
            { planId: 'autumn-block', revision: 0, sessionId: 'w1-threshold', contentHash: 'abc' },
            { planId: 'autumn-block', revision: '2', sessionId: 'w1-threshold', contentHash: 'abc' },
            { planId: 'autumn-block', revision: 2, sessionId: 'w1-threshold', contentHash: 'abc', extra: true },
        ]) {
            const malformed = validRecommendation();
            malformed.recommendationAudit.externalPlan = broken;
            await assertFails(setDoc(doc(ownerDb, `${recommendationPath}`), malformed));
        }
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
        });
        batch.set(doc(ownerDb, recommendationPath) as any, {
            ...validRecommendation(),
            templateId: 'hard_01',
            revision: 2,
        }, { merge: true });

        await assertFails(batch.commit());
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
        // Regression guard: the archived audit and the new top-level audit must be
        // DIFFERENT objects (as they always are in production -- evaluatedAt is real-time
        // per decision). A test that reuses one literal audit for both would pass even if
        // auditWriteOnce() wrongly froze the audit for the document's entire lifetime
        // instead of just for the current (unchanged) decision.
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
        // Same decision fields, same revision, and -- critically -- the exact same audit
        // object recommendationService.ts must preserve rather than resend a freshly
        // recomputed one (see saveRecommendation()'s recommendationAudit condition).
        await expect(assertSucceeds(
            setDoc(doc(ownerDb, recommendationPath), { ...original, revision: 1 }, { merge: true }),
        )).resolves.toBeUndefined();
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
        // Writing to the owner's document path as a different authenticated user.
        await assertFails(setDoc(doc(otherDb, fixedActivityPath), validFixedActivity()));
        // Writing under otherUserId's own path but forging userId to the real owner's id.
        await assertFails(setDoc(doc(otherDb, `users/${otherUserId}/fixed_activities/activity-2`), { ...validFixedActivity(), userId: ownerId }));
    });

    it('rejects a fixed activity with an out-of-range durationMin', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertFails(setDoc(doc(ownerDb, fixedActivityPath), { ...validFixedActivity(), durationMin: 0 }));
        await assertFails(setDoc(doc(ownerDb, fixedActivityPath), { ...validFixedActivity(), durationMin: 1500 }));
    });

    it('rejects a fixed activity with an expectedCost value above 1', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertFails(setDoc(doc(ownerDb, fixedActivityPath), { ...validFixedActivity(), expectedCost: { systemic: 1.5 } }));
    });

    it('rejects a fixed activity with an unknown environment', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertFails(setDoc(doc(ownerDb, fixedActivityPath), { ...validFixedActivity(), environment: 'space' }));
    });

    it('rejects a fixed activity with an oversized equipment list', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertFails(setDoc(doc(ownerDb, fixedActivityPath), { ...validFixedActivity(), equipment: Array.from({ length: 21 }, (_, i) => `item-${i}`) }));
    });

    it('allows a fixed activity with a valid availabilityContextOverride (Phase 6.2b / D6-B)', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await expect(assertSucceeds(setDoc(doc(ownerDb, fixedActivityPath), {
            ...validFixedActivity(),
            availabilityContextOverride: { environment: 'indoor', equipment: ['indoor_bike'] },
        }))).resolves.toBeUndefined();
    });

    it('rejects a fixed activity with an unknown environment inside availabilityContextOverride', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertFails(setDoc(doc(ownerDb, fixedActivityPath), {
            ...validFixedActivity(),
            availabilityContextOverride: { environment: 'space' },
        }));
    });

    it('rejects a fixed activity with an unrecognized key inside availabilityContextOverride', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertFails(setDoc(doc(ownerDb, fixedActivityPath), {
            ...validFixedActivity(),
            availabilityContextOverride: { environment: 'indoor', extra: true },
        }));
    });

    it('rejects a fixed activity with a malformed date', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertFails(setDoc(doc(ownerDb, fixedActivityPath), { ...validFixedActivity(), date: '08/12/2026' }));
    });

    it('rejects a fixed activity with a YYYY-MM-DD-shaped but calendar-impossible date', async () => {
        // Regex-only shape validation would accept this; a direct authenticated write
        // (bypassing validation.ts's client-side isValidDate) must still be rejected.
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertFails(setDoc(doc(ownerDb, fixedActivityPath), { ...validFixedActivity(), date: '2026-02-30' }));
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

    it('allows an owner to create a valid authored travel plan block and rejects malformed ranges or doses', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await expect(assertSucceeds(setDoc(doc(ownerDb, planBlockPath), validPlanBlock()))).resolves.toBeUndefined();
        await assertFails(setDoc(doc(ownerDb, `${planBlockPath}-inverted`), { ...validPlanBlock(), endDate: '2026-08-18' }));
        await assertFails(setDoc(doc(ownerDb, `${planBlockPath}-impossible`), { ...validPlanBlock(), startDate: '2026-02-30' }));
        await assertFails(setDoc(doc(ownerDb, `${planBlockPath}-dose`), { ...validPlanBlock(), intensityScale: 1.1 }));
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

    it('makes a stored revision create-only, so an audited decision stays verifiable', async () => {
        await testEnvironment.withSecurityRulesDisabled(async context => {
            await setDoc(doc(context.firestore(), externalRevisionPath), validExternalPlanRevision());
        });
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        // Even the owner cannot rewrite or remove a revision the content hash points at.
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
            schema: 'adaptive-training-recommender/external-plan@2',
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
    });

    it('allows canonical unavailable modalities and rejects unsupported values', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertSucceeds(setDoc(doc(ownerDb, preferencesPath), validPreferences()));
        await assertFails(setDoc(doc(ownerDb, preferencesPath), {
            ...validPreferences(), unavailableModalities: ['None'],
        }));
    });

    it('enforces ownership, integer capacity, exact shape and immutable creation time for training intent profiles', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        const valid = validTrainingIntentProfile();
        await expect(assertSucceeds(setDoc(doc(ownerDb, trainingIntentProfilePath), valid))).resolves.toBeUndefined();
        await assertFails(setDoc(doc(ownerDb, `${trainingIntentProfilePath}-fractional`), {
            ...valid, weeklyCommitment: { ...valid.weeklyCommitment, targetSessions: 2.5 },
        }));
        await assertFails(setDoc(doc(ownerDb, `${trainingIntentProfilePath}-range`), {
            ...valid, weeklyCommitment: { minSessions: 4, targetSessions: 3, maxSessions: 4 },
        }));
        await assertFails(setDoc(doc(ownerDb, `${trainingIntentProfilePath}-mode`), { ...valid, planningMode: 'unsupported' }));
        await assertFails(setDoc(doc(ownerDb, `${trainingIntentProfilePath}-org`), { ...valid, organizationPreference: 'manual' }));
        await assertFails(setDoc(doc(ownerDb, `${trainingIntentProfilePath}-extra-field`), { ...valid, surprise: true }));
        await assertFails(setDoc(doc(ownerDb, trainingIntentProfilePath), { ...valid, createdAt: '2099-01-01T00:00:00Z' }, { merge: true }));
        const otherDb = testEnvironment.authenticatedContext(otherUserId).firestore();
        await assertFails(getDoc(doc(otherDb, trainingIntentProfilePath)));
    });

    it('rejects re-saving the same decision with a different audit than what is stored', async () => {
        // If a client resent a freshly recomputed audit for an unchanged decision (the bug
        // this guards against), the audit would differ only in evaluatedAt/etc. -- this must
        // still be rejected, since decision fields (templateId/mode/rationale/...) are equal.
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
        // Unknown verdict value.
        await assertFails(setDoc(doc(ownerDb, `${decisionJournalPath}-bad-verdict`), {
            ...validDecisionJournalEntry(), externalVerdict: 'maybe',
        }));
        // Unrecognized field -- closed key set, this is evidence not a free-form document.
        await assertFails(setDoc(doc(ownerDb, `${decisionJournalPath}-extra-field`), {
            ...validDecisionJournalEntry(), surprise: true,
        }));
        // Missing required field.
        const withoutSawFirst: Record<string, unknown> = validDecisionJournalEntry();
        delete withoutSawFirst.sawEngineVerdictFirst;
        await assertFails(setDoc(doc(ownerDb, `${decisionJournalPath}-missing-field`), withoutSawFirst));
        // Document id / userId disagree with the path.
        await assertFails(setDoc(doc(ownerDb, decisionJournalPath), { ...validDecisionJournalEntry(), date: '2026-08-08' }));
        await assertFails(setDoc(doc(ownerDb, decisionJournalPath), { ...validDecisionJournalEntry(), userId: otherUserId }));
        // Foreign-owned: writing under the other user's own path but forging userId.
        const otherDb = testEnvironment.authenticatedContext(otherUserId).firestore();
        await assertFails(setDoc(
            doc(otherDb, `users/${otherUserId}/decision_journal/2026-08-07`),
            { ...validDecisionJournalEntry(), userId: ownerId },
        ));
    });

    it('rejects cross-user decision journal reads and writes', async () => {
        await testEnvironment.withSecurityRulesDisabled(async context => {
            await setDoc(doc(context.firestore(), decisionJournalPath), validDecisionJournalEntry());
        });
        const otherDb = testEnvironment.authenticatedContext(otherUserId).firestore();
        await assertFails(getDoc(doc(otherDb, decisionJournalPath)));
        await assertFails(setDoc(doc(otherDb, decisionJournalPath), validDecisionJournalEntry(), { merge: true }));
    });

    it('allows the evening update to record actualVerdict, and rejects tampering with sawEngineVerdictFirst or createdAt', async () => {
        await testEnvironment.withSecurityRulesDisabled(async context => {
            await setDoc(doc(context.firestore(), decisionJournalPath), validDecisionJournalEntry());
        });
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();

        // Legitimate evening write: adds actualVerdict, bumps updatedAt.
        await expect(assertSucceeds(setDoc(doc(ownerDb, decisionJournalPath), {
            ...validDecisionJournalEntry(), actualVerdict: 'scale', updatedAt: '2026-08-07T20:00:00Z',
        }))).resolves.toBeUndefined();

        // sawEngineVerdictFirst is the anchoring telemetry -- must be immutable on update.
        await assertFails(setDoc(doc(ownerDb, decisionJournalPath), {
            ...validDecisionJournalEntry(), sawEngineVerdictFirst: true,
        }));

        // createdAt is likewise immutable on update.
        await assertFails(setDoc(doc(ownerDb, decisionJournalPath), {
            ...validDecisionJournalEntry(), createdAt: '2099-01-01T00:00:00Z',
        }));
    });

    it('allows an owner to delete their own decision journal entry', async () => {
        await testEnvironment.withSecurityRulesDisabled(async context => {
            await setDoc(doc(context.firestore(), decisionJournalPath), validDecisionJournalEntry());
        });
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await expect(assertSucceeds(deleteDoc(doc(ownerDb, decisionJournalPath)))).resolves.toBeUndefined();
    });
});
