/**
 * Recommendation audit budget regression harness (issue #435).
 *
 * Goals:
 *  - Verify all lineage boundaries across create / unchanged re-save /
 *    decision-change+archive for the normal bounded audit.
 *  - Keep the Firestore container boundary covered: a maximum of 64 entries and
 *    knowledgeLineage required for v4. Per-reference validation lives at the
 *    TypeScript persistence boundary (validationRecommendation.test.ts).
 *  - Demonstrate headroom by confirming the combined-true / size=64 create still
 *    succeeds (positive control for future-field proof).
 *
 * Run from app/ with FIRESTORE_EMULATOR_HOST set:
 *   npx firebase --project demo-audit-budget emulators:exec --only firestore \
 *     "npx vitest run src/emulator/recommendationAuditBudget.emulator.test.ts"
 *
 * Set AUDIT_BUDGET_BASE to a git SHA to load rules from that commit instead of
 * the working copy (useful for baseline vs. candidate comparison).
 * Set AUDIT_BUDGET_CREATE_ONLY=1 to skip the update/archive steps for faster
 * iteration.
 */

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { afterAll, beforeAll, describe, it } from 'vitest';
import {
    assertFails,
    assertSucceeds,
    initializeTestEnvironment,
    type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, setDoc, writeBatch } from 'firebase/firestore';

const emulatorDescribe = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;

const owner = 'audit-budget-owner';
const date = '2026-09-01';
const path = `users/${owner}/daily_recommendations/${date}`;

// ──────────────────────────────────────────────────────────────────────────────
// Fixture builders
// ──────────────────────────────────────────────────────────────────────────────

/** Minimal valid session binding used as both a top-level and audit-copy session. */
const binding = {
    sessionSource: { kind: 'unplanned_fixture', fixtureId: 'synthetic' },
    prescriptionHash: 'synthetic-hash',
    occurrenceId: 'synthetic-occurrence',
};

/**
 * Build a v4 recommendation fixture with the given lineage size.
 *
 * @param size     Number of knowledgeLineage entries (0 ... 64).
 * @param combined When true, populate all optional audit sub-fields.
 * @param lineage  Override the generated lineage list (for negative cases).
 */
function recommendation(
    size: number,
    combined: boolean,
    lineage?: Array<{ claimId: string; version: number }>,
) {
    const knowledgeLineage =
        lineage ??
        Array.from({ length: size }, (_, i) => ({
            claimId: `claim.${size - i}`,
            version: 1,
        }));

    return {
        userId: owner,
        date,
        templateId: 'easy_01',
        templateTitle: 'Easy',
        category: 'Easy Endurance',
        modality: 'Cycling',
        mode: 'train',
        rationale: 'Synthetic budget fixture',
        schemaVersion: 4,
        revision: 1,
        createdAt: '2026-09-01T06:00:00Z',
        updatedAt: '2026-09-01T06:00:00Z',
        adherence: {
            respondedAt: null,
            followed: null,
            actualModality: null,
            actualDurationMin: null,
            skipped: false,
            notes: null,
        },
        ...(combined
            ? {
                  primarySession: binding,
                  additionalSessions: Array.from({ length: 4 }, () => binding),
              }
            : {}),
        recommendationAudit: {
            policyVersion: 'synthetic',
            evaluatedAt: '2026-09-01T06:00:00Z',
            decisionContextRevision: 'history-v1:synthetic',
            safetyStatus: 'complete',
            history: {
                completedEventCount: 0,
                unmatchedEventCount: 0,
                sourceStatuses: {
                    activities: 'AVAILABLE',
                    recommendations: 'AVAILABLE',
                    manualTraining: 'MISSING',
                },
            },
            envelope: {
                safetyRestrictedModalityCount: 0,
                planMaxAllowableTier: 'Easy',
            },
            candidateScores: [],
            knowledgeLineage,
            ...(combined
                ? {
                      primarySession: binding,
                      additionalSessions: Array.from({ length: 4 }, () => binding),
                      plannedDose: { volume: 1, intensity: 1 },
                      executionDose: { volume: 1, intensity: 1 },
                      droppedContributorObjectives: [],
                      externalPlan: {
                          planId: 'synthetic',
                          revision: 1,
                          sessionId: 's1',
                          contentHash: 'a'.repeat(64),
                      },
                      subjectiveDrift: {
                          estimatorId: 'synthetic',
                          estimatorPolicyVersion: 'synthetic',
                          historyThroughDateExclusive: date,
                          recentRecordedDays: 7,
                          longRecordedDays: 28,
                          contribution: 0,
                          decisionRelevant: false,
                          perMetricContributions: {
                              readiness: 0,
                              sleepQuality: 0,
                              fatigue: 0,
                              soreness: 0,
                              mentalStress: 0,
                              motivation: 0,
                          },
                      },
                  }
                : {}),
        },
    };
}

// ──────────────────────────────────────────────────────────────────────────────
// Budget stress matrix
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Lineage sizes that cover every chunk boundary (8/16/32/64) and the sizes
 * immediately before and after each boundary, plus the trivial cases.
 * P0 item 5: "lineage lengths 0/1/2/7/8/9/15/16/17/31/32/33/63/64"
 */
const BOUNDARY_SIZES = [0, 1, 2, 7, 8, 9, 15, 16, 17, 31, 32, 33, 63, 64];

emulatorDescribe('Recommendation audit budget', () => {
    let environment: RulesTestEnvironment;

    beforeAll(async () => {
        const rules = process.env.AUDIT_BUDGET_BASE
            ? execFileSync(
                  'git',
                  ['show', `${process.env.AUDIT_BUDGET_BASE}:app/firestore.rules`],
                  { encoding: 'utf8' },
              )
            : readFileSync('firestore.rules', 'utf8');
        environment = await initializeTestEnvironment({
            projectId: 'demo-audit-budget',
            firestore: { rules },
        });
    });

    afterAll(async () => {
        await environment?.cleanup();
    });

    // ── P0 stress matrix ─────────────────────────────────────────────────────

    describe('normal bounded audit', () => {
        for (const size of BOUNDARY_SIZES) {
            it(`size=${size}: create then re-save then decision-change+archive`, async () => {
                    await environment.clearFirestore();
                    const db = environment.authenticatedContext(owner).firestore();
                    const original = recommendation(size, false);

                    // create
                    await assertSucceeds(setDoc(doc(db, path), original));
                    console.log(`PASS create  size=${size}`);

                    if (process.env.AUDIT_BUDGET_CREATE_ONLY) return;

                    // unchanged re-save (audit equality must hold)
                    await assertSucceeds(
                        setDoc(doc(db, path), { ...original, updatedAt: '2026-09-01T07:00:00Z' }),
                    );
                    console.log(`PASS re-save size=${size}`);

                    // decision-change + atomic archive (mirrors recommendationService.ts)
                    const batch = writeBatch(db);
                    const {
                        templateId,
                        templateTitle,
                        category,
                        modality,
                        mode,
                        rationale,
                        recommendationAudit,
                    } = original;
                    batch.set(doc(db, `${path}/revisions/1`), {
                        revision: 1,
                        templateId,
                        templateTitle,
                        category,
                        modality,
                        mode,
                        rationale,
                        recommendationAudit,
                    });
                    batch.set(doc(db, path), {
                        ...original,
                        revision: 2,
                        rationale: 'New decision',
                    });
                    await assertSucceeds(batch.commit());
                    console.log(`PASS archive size=${size}`);
            });
        }
    });

    // ── Unsorted valid IDs ────────────────────────────────────────────────────

    it('accepts unsorted valid lineage IDs (client need not sort)', async () => {
        await environment.clearFirestore();
        const db = environment.authenticatedContext(owner).firestore();
        const unsortedLineage = [
            { claimId: 'z.claim', version: 1 },
            { claimId: 'a.claim', version: 2 },
            { claimId: 'm.claim', version: 1 },
        ];
        await assertSucceeds(
            setDoc(doc(db, path), recommendation(0, false, unsortedLineage)),
        );
    });

    // ── P4 negative cases ─────────────────────────────────────────────────────

    describe('P4 negative cases', () => {
        it('rejects 65 lineage entries (exceeds maximum of 64)', async () => {
            await environment.clearFirestore();
            const db = environment.authenticatedContext(owner).firestore();
            const lineage65 = Array.from({ length: 65 }, (_, i) => ({
                claimId: `claim.${i}`,
                version: 1,
            }));
            await assertFails(
                setDoc(doc(db, path), recommendation(0, false, lineage65)),
            );
        });

        it('rejects missing knowledgeLineage in schema v4', async () => {
            await environment.clearFirestore();
            const db = environment.authenticatedContext(owner).firestore();
            const rec = recommendation(0, false);
            const auditWithoutLineage: Record<string, unknown> = {
                ...rec.recommendationAudit,
            };
            delete auditWithoutLineage.knowledgeLineage;
            await assertFails(
                setDoc(doc(db, path), { ...rec, recommendationAudit: auditWithoutLineage }),
            );
        });

    });

    // ── Future-field proof / headroom demonstration ───────────────────────────
    // The dense, four-additional-session create is the largest supported audit shape.
    // A regression here means the write path has re-hit Firestore's evaluator ceiling.

    it('headroom proof: combined=true size=64 create succeeds (worst-case positive control)', async () => {
        await environment.clearFirestore();
        const db = environment.authenticatedContext(owner).firestore();
        await assertSucceeds(setDoc(doc(db, path), recommendation(64, true)));
        console.log('PASS headroom proof: combined=true size=64');
    });
});
