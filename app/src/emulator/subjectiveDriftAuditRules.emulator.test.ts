/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';

const emulatorDescribe = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
let env: RulesTestEnvironment;
const userId = 'drift-audit-athlete';
const path = `users/${userId}/daily_recommendations/2026-08-16`;

function driftAudit() {
    return {
        estimatorId: 'subjective-baseline-v1-mean-stdev-7-28',
        historyThroughDateExclusive: '2026-08-16',
        recentRecordedDays: 7,
        longRecordedDays: 28,
        contribution: 1.2,
        perMetricContributions: {
            readiness: 0.2,
            sleepQuality: 0.2,
            fatigue: 0.2,
            soreness: 0.2,
            mentalStress: 0.2,
            motivation: 0.2,
        },
        decisionRelevant: true,
    };
}

function recommendation() {
    return {
        userId,
        date: '2026-08-16',
        templateId: 'easy_01',
        templateTitle: 'Easy Ride',
        category: 'Easy Endurance',
        modality: 'Cycling',
        mode: 'modify',
        rationale: 'Compact rationale.',
        schemaVersion: 3,
        createdAt: '2026-08-16T06:00:00Z',
        updatedAt: '2026-08-16T06:00:00Z',
        adherence: {
            respondedAt: null,
            followed: null,
            actualModality: null,
            actualDurationMin: null,
            skipped: false,
            notes: null,
        },
        recommendationAudit: {
            policyVersion: '2026-08-external-plan-provenance-v1',
            evaluatedAt: '2026-08-16T06:00:00Z',
            decisionContextRevision: 'history-v1:2026-08-16:7:none:none',
            safetyStatus: 'complete',
            history: {
                completedEventCount: 0,
                unmatchedEventCount: 0,
                sourceStatuses: { activities: 'AVAILABLE', recommendations: 'AVAILABLE', manualTraining: 'MISSING' },
            },
            envelope: { safetyRestrictedModalityCount: 0, planMaxAllowableTier: 'Easy' },
            candidateScores: [],
            subjectiveDrift: driftAudit(),
        },
    };
}

emulatorDescribe('Phase 9.7 subjective drift recommendation audit rules', () => {
    beforeAll(async () => {
        env = await initializeTestEnvironment({
            projectId: 'demo-adaptive-training-subjective-drift',
            firestore: { rules: readFileSync('firestore.rules', 'utf8') },
        });
    });
    afterEach(async () => env.clearFirestore());
    afterAll(async () => env.cleanup());

    it('accepts the compact normalized subjective drift audit shape', async () => {
        const db = env.authenticatedContext(userId).firestore();
        await expect(assertSucceeds(setDoc(doc(db, path), recommendation()))).resolves.toBeUndefined();
    });

    it('rejects raw history or any unknown field inside subjectiveDrift', async () => {
        const db = env.authenticatedContext(userId).firestore();
        const value = recommendation();
        (value.recommendationAudit.subjectiveDrift as any).rawHistory = [{ readiness: 3 }];
        await assertFails(setDoc(doc(db, path), value));
    });

    it('rejects incomplete, negative, or unbounded per-metric maps', async () => {
        const db = env.authenticatedContext(userId).firestore();
        for (const mutation of [
            (d: any) => { delete d.perMetricContributions.motivation; },
            (d: any) => { d.perMetricContributions.fatigue = -0.1; },
            (d: any) => { d.perMetricContributions.soreness = 21; },
            (d: any) => { d.perMetricContributions.extra = 0; },
        ]) {
            const value = recommendation();
            mutation(value.recommendationAudit.subjectiveDrift);
            await assertFails(setDoc(doc(db, path), value));
        }
    });

    it('rejects impossible coverage, malformed history boundary, and an unbounded total', async () => {
        const db = env.authenticatedContext(userId).firestore();
        for (const patch of [
            { recentRecordedDays: 29, longRecordedDays: 28 },
            { recentRecordedDays: -1 },
            { longRecordedDays: 367 },
            { historyThroughDateExclusive: '16-08-2026' },
            { contribution: -1 },
            { contribution: 121 },
        ]) {
            const value = recommendation();
            Object.assign(value.recommendationAudit.subjectiveDrift, patch);
            await assertFails(setDoc(doc(db, path), value));
        }
    });

    it('keeps the audit write-once when decision fields are unchanged', async () => {
        const db = env.authenticatedContext(userId).firestore();
        await assertSucceeds(setDoc(doc(db, path), recommendation()));
        const mutated = recommendation();
        mutated.recommendationAudit.subjectiveDrift.contribution = 1.3;
        mutated.recommendationAudit.subjectiveDrift.perMetricContributions.readiness = 0.3;
        await assertFails(setDoc(doc(db, path), mutated));
    });
});
