import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, type Firestore } from 'firebase/firestore';
import { TEMPLATES } from '../engine/templates';
import type { Recommendation } from '../engine/models';

const dbHolder = vi.hoisted(() => ({ db: null as Firestore | null }));
vi.mock('../firebase', () => ({ getDb: () => dbHolder.db }));

import { RecommendationService } from '../services/recommendationService';
import { ManualRecommendationReplacementService } from '../services/manualRecommendationReplacementService';
import { DecisionJournalService } from '../services/decisionJournalService';

const emulatorDescribe = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
const USER_ID = 'athlete-ledger-mode-no-writes';
const DATE = '2026-11-12';
const NOW = '2026-11-12T06:00:00.000Z';

emulatorDescribe('Ledger mode daily_recommendations write suppression (#1167 P2-5)', () => {
    let testEnvironment: RulesTestEnvironment;
    let db: Firestore;

    beforeAll(async () => {
        testEnvironment = await initializeTestEnvironment({
            projectId: 'demo-ledger-mode-no-writes',
            firestore: { rules: readFileSync('firestore.rules', 'utf8') },
        });
        db = testEnvironment.authenticatedContext(USER_ID).firestore() as unknown as Firestore;
        dbHolder.db = db;
    });

    afterEach(async () => { await testEnvironment.clearFirestore(); });
    afterAll(async () => { await testEnvironment.cleanup(); });

    it('writes no daily_recommendations, decision_contexts, or decision_journal docs when engineRecommendationsEnabled is false', async () => {
        await setDoc(doc(db, `users/${USER_ID}/preferences/profile`), {
            userId: USER_ID,
            engineRecommendationsEnabled: false,
            preferredRecoveryStyle: 'mixed',
            defaultWeekdayTimeMin: 45,
            defaultWeekendTimeMin: 60,
            preferredTimeOfDay: 'flexible',
            preferredModalities: [],
            avoidedModalities: [],
            explanationVerbosity: 'detailed',
            conservativeBias: false,
            preferredUnits: { distance: 'km', weight: 'kg', temperature: 'celsius' },
            schemaVersion: 1,
            createdAt: NOW,
            updatedAt: NOW,
        });

        const recService = new RecommendationService();
        const rec = {
            template: TEMPLATES[0],
            mode: 'train',
            rationale: 'Should not persist in ledger mode',
        } as unknown as Recommendation;

        expect(await recService.saveRecommendation(USER_ID, DATE, rec)).toBeNull();
        expect(await recService.saveNotApplicableContext(USER_ID, DATE, 'missing')).toBe(false);
        // No day document is seeded, so this only shows recordAdherence stays quiet here; the
        // guard-before-read for adherence is proven in recommendationService.test.ts.
        expect(await recService.recordAdherence(USER_ID, DATE, { followed: true })).toBeNull();

        const replacementService = new ManualRecommendationReplacementService(db);
        await expect(replacementService.replaceRecommendationOccurrence(USER_ID, DATE, {
            definitionId: 'manual-def',
            revision: 1,
            contentHash: 'a'.repeat(64),
        })).rejects.toThrow('disabled in ledger mode');

        const journalService = new DecisionJournalService();
        await expect(journalService.recordMorningEntry(USER_ID, DATE, {
            externalVerdict: 'proceed',
            sawEngineVerdictFirst: false,
        })).rejects.toThrow('disabled in ledger mode');

        expect((await getDoc(doc(db, `users/${USER_ID}/daily_recommendations/${DATE}`))).exists()).toBe(false);
        expect((await getDoc(doc(db, `users/${USER_ID}/daily_recommendations/${DATE}/decision_contexts/0`))).exists()).toBe(false);
        expect((await getDoc(doc(db, `users/${USER_ID}/decision_journal/${DATE}`))).exists()).toBe(false);
    });
});
