/**
 * Recommendation audit budget regression harness (issue #435 & #953).
 *
 * Goals:
 *  - Verify all lineage boundaries across create / unchanged re-save /
 *    decision-change+archive for the normal bounded audit.
 *  - Keep the Firestore container boundary covered: a maximum of 64 entries and
 *    knowledgeLineage required for v4.
 *  - Demonstrate headroom across real-shape fixtures and scenarios (S1-S6)
 *    at >= 40 pad terms (~20% expression budget headroom).
 *  - Prove D3 fix: wholesale replacement on decision change prevents stale audit provenance.
 *
 * Run from app/ with FIRESTORE_EMULATOR_HOST set:
 *   npx firebase --project demo-audit-budget emulators:exec --only firestore \
 *     "npx vitest run src/emulator/recommendationAuditBudget.emulator.test.ts"
 *
 * Set AUDIT_BUDGET_BASE to a git SHA to load rules from that commit instead of
 * the working copy (useful for baseline vs. candidate comparison).
 * Set AUDIT_BUDGET_MEASURE=1 to measure exact headroom via binary search.
 */

import { readFileSync, appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
    assertFails,
    assertSucceeds,
    initializeTestEnvironment,
    type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
    deleteField,
    doc,
    getDoc,
    setDoc,
    updateDoc,
    writeBatch,
} from 'firebase/firestore';
import type {
    DailyRecommendation,
    SessionAdjustment,
} from '../engine/models';
import type { WorkoutPrescription } from '../workouts/models';
import type { SessionReferenceBinding } from '../sessions/models';
import { validateRecommendation } from '../engine/validationCore';

const emulatorDescribe = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;

const owner = 'audit-budget-owner';
const date = '2026-09-01';
const path = `users/${owner}/daily_recommendations/${date}`;

// ──────────────────────────────────────────────────────────────────────────────
// Padding probe utilities (issue #953)
// ──────────────────────────────────────────────────────────────────────────────

const PAD_THRESHOLD = 40;
const PAD_FN = '    function zzp50() {\n      return ' + Array.from({ length: 50 }, () => '(1 == 1)').join(' && ') + ';\n    }\n';

function pad(n: number): string {
    const a = Math.floor(n / 50);
    const b = n % 50;
    const parts = [
        ...Array.from({ length: a }, () => 'zzp50()'),
        ...Array.from({ length: b }, () => '(1 == 1)'),
    ];
    return parts.length ? parts.join(' && ') : 'true';
}

function rulesWithPadding(baseRules: string, n: number): string {
    const padStr = pad(n);
    let patched = baseRules.replace(
        '    function isOwner(userId) {',
        PAD_FN + '    function isOwner(userId) {',
    );
    const targetBlockRegex = /(match \/users\/\{userId\}\/daily_recommendations\/\{date\} \{[\s\S]*?allow create: if )([^;]+);([\s\S]*?allow update: if )([^;]+);/;
    if (!targetBlockRegex.test(patched)) {
        throw new Error('Unable to anchor daily_recommendations block in rules for padding probe');
    }
    patched = patched.replace(targetBlockRegex, (_match, preCreate, createExpr, preUpdate, updateExpr) => {
        return `${preCreate}(${padStr}) && (${createExpr});${preUpdate}(${padStr}) && (${updateExpr});`;
    });
    return patched;
}

// ──────────────────────────────────────────────────────────────────────────────
// Legacy fixture builders (#435)
// ──────────────────────────────────────────────────────────────────────────────

/** Minimal valid session binding used as both a top-level and audit-copy session. */
const binding: SessionReferenceBinding = {
    sessionSource: { kind: 'unplanned_fixture', fixtureId: 'synthetic' },
    prescriptionHash: 'synthetic-hash',
    occurrenceId: 'synthetic-occurrence',
};

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
        mode: 'train' as const,
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
            ...(combined ? {
                decisionContext: {
                    path: `${path}/decision_contexts/1`,
                    revision: 1,
                    contentHash: 'a'.repeat(64),
                },
            } : {}),
            safetyStatus: 'complete' as const,
            history: {
                completedEventCount: 0,
                unmatchedEventCount: 0,
                sourceStatuses: {
                    activities: 'AVAILABLE' as const,
                    recommendations: 'AVAILABLE' as const,
                    manualTraining: 'MISSING' as const,
                },
            },
            envelope: {
                safetyRestrictedModalityCount: 0,
                planMaxAllowableTier: 'Easy' as const,
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
// Real-shape fixture builders (WP0.3 / issue #953)
// ──────────────────────────────────────────────────────────────────────────────

export function fixtureCatalog(): DailyRecommendation {
    const primarySession: SessionReferenceBinding = {
        sessionSource: {
            kind: 'catalog',
            workoutId: 'cycling_vo2_01',
            catalogVersion: 'v1',
        },
        occurrenceId: 'occ-cat-1',
        prescriptionHash: 'hash-cat-1',
        fitWorkoutFingerprint: 'fit-workout-v2:0123456789abcdef0123456789abcdef',
        fitWorkoutFingerprintKind: 'semantic_definition',
    };
    const prescription = {
        workoutId: 'cycling_vo2_01',
        displayBlocks: [
            {
                id: 'b1',
                name: 'Main',
                role: 'main',
                steps: [{ id: 's1', name: 'Interval', dose: '10m', targets: ['Zone 1'], cues: [] }],
            },
        ],
    } as unknown as WorkoutPrescription;
    const adjustment: SessionAdjustment = {
        direction: 'easier',
        tier: 1,
        originalTemplateId: 'mod_01',
        originalTemplateTitle: 'Moderate',
        rationale: 'Adjusted easier',
    };
    const knowledgeLineage = Array.from({ length: 64 }, (_, i) => ({
        claimId: `claim.${i}`,
        version: 1,
    }));
    const candidateScores = Array.from({ length: 64 }, (_, i) => ({
        templateId: `template_${i}`,
        utilityScore: 0.8,
        excludedReasons: [],
    }));

    const rec = {
        userId: owner,
        date,
        templateId: 'cycling_vo2_01',
        templateTitle: 'VO2 Max Intervals',
        category: 'High Intensity',
        modality: 'Cycling',
        mode: 'train' as const,
        engineVerdict: 'proceed' as const,
        rationale: 'Catalog recommendation with fingerprint',
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
        adjustment,
        prescription,
        primarySession,
        recommendationAudit: {
            policyVersion: 'synthetic-policy',
            evaluatedAt: '2026-09-01T06:00:00Z',
            decisionContextRevision: 'history-v1:synthetic',
            decisionContext: {
                path: `${path}/decision_contexts/1`,
                revision: 1,
                contentHash: 'a'.repeat(64),
            },
            safetyStatus: 'complete' as const,
            history: {
                completedEventCount: 0,
                unmatchedEventCount: 0,
                sourceStatuses: {
                    activities: 'AVAILABLE' as const,
                    recommendations: 'AVAILABLE' as const,
                    manualTraining: 'MISSING' as const,
                },
            },
            envelope: {
                safetyRestrictedModalityCount: 0,
                planMaxAllowableTier: 'Hard' as const,
            },
            plannedDose: { volume: 0.8, intensity: 0.9 },
            executionDose: { volume: 0.8, intensity: 0.9 },
            primarySession,
            droppedContributorObjectives: [],
            knowledgeLineage,
            candidateScores,
        },
    };
    const validation = validateRecommendation(rec);
    if (!validation.isValid) throw new Error('Invalid F-catalog fixture: ' + JSON.stringify(validation.errors));
    return rec as DailyRecommendation;
}

export function fixtureExternal(): DailyRecommendation {
    const base = fixtureCatalog();
    const primarySession: SessionReferenceBinding = {
        sessionSource: {
            kind: 'external_plan',
            planId: 'plan-ext-1',
            revision: 1,
            sessionId: 'session-ext-1',
            contentHash: 'b'.repeat(64),
        },
        occurrenceId: 'occ-ext-1',
        prescriptionHash: 'hash-ext-1',
    };
    const rec: Record<string, unknown> = {
        ...base,
        primarySession,
        recommendationAudit: {
            ...base.recommendationAudit!,
            primarySession,
            externalPlan: {
                planId: 'plan-ext-1',
                revision: 1,
                sessionId: 'session-ext-1',
                contentHash: 'b'.repeat(64),
            },
            authoredOccurrence: {
                occurrenceId: 'occ-ext-1',
                decision: 'proceed' as const,
            },
        },
    };
    delete rec.prescription;
    const validation = validateRecommendation(rec);
    if (!validation.isValid) throw new Error('Invalid F-external fixture: ' + JSON.stringify(validation.errors));
    return rec as unknown as DailyRecommendation;
}

export function fixtureRest(): DailyRecommendation {
    const base = fixtureCatalog();
    const rec: Record<string, unknown> = {
        ...base,
        templateId: 'rest_01',
        templateTitle: 'Rest',
        category: 'Rest',
        modality: 'Rest',
        mode: 'recover' as const,
        rationale: 'Authored rest day',
        recommendationAudit: {
            ...base.recommendationAudit!,
            externalRest: {
                planId: 'plan-rest-1',
                revision: 1,
                contentHash: 'c'.repeat(64),
                restDirectiveId: 'directive-1',
                date,
            },
            candidateScores: [],
        },
    };
    delete rec.prescription;
    delete rec.primarySession;
    delete (rec.recommendationAudit as Record<string, unknown>).primarySession;
    const validation = validateRecommendation(rec);
    if (!validation.isValid) throw new Error('Invalid F-rest fixture: ' + JSON.stringify(validation.errors));
    return rec as unknown as DailyRecommendation;
}

export function fixtureMaximal(): DailyRecommendation {
    const base = fixtureCatalog();
    const additionalSessions: SessionReferenceBinding[] = Array.from({ length: 4 }, (_, i) => ({
        sessionSource: { kind: 'unplanned_fixture', fixtureId: `add-fixture-${i}` },
        occurrenceId: `occ-add-${i}`,
        prescriptionHash: `hash-add-${i}`,
    }));
    const subjectiveDrift = {
        estimatorId: 'synthetic-estimator',
        estimatorPolicyVersion: 'drift-v1',
        historyThroughDateExclusive: date,
        recentRecordedDays: 7,
        longRecordedDays: 28,
        contribution: 0.1,
        decisionRelevant: true,
        perMetricContributions: {
            readiness: 0.1,
            sleepQuality: 0.1,
            fatigue: 0.1,
            soreness: 0.1,
            mentalStress: 0.1,
            motivation: 0.1,
        },
    };
    const identityDecision = {
        identityAssessmentId: 'assessment-max-1',
        automaticStatus: 'MATCH' as const,
        effectiveStatus: 'MATCH' as const,
        reviewEventId: null,
        identityPolicyVersion: 'identity-policy-v1',
        featureSchemaVersion: 1,
        passportVersion: 1,
        sharedBundleRef: { provider: 'garmin' as const, transport: 'direct' as const },
        anchorBundleRefs: [],
        selectedEffectiveSource: null,
        fallbackReason: null,
    };
    const rec = {
        ...base,
        additionalSessions,
        recommendationAudit: {
            ...base.recommendationAudit!,
            additionalSessions,
            subjectiveDrift,
            identityDecision,
        },
    };
    const validation = validateRecommendation(rec);
    if (!validation.isValid) throw new Error('Invalid F-maximal fixture: ' + JSON.stringify(validation.errors));
    return rec as unknown as DailyRecommendation;
}

export function buildContextDoc(rec: DailyRecommendation, revision: number, contentHash = 'a'.repeat(64)) {
    return {
        schemaVersion: 1,
        userId: owner,
        date,
        recommendationRevision: revision,
        evaluatedAt: rec.recommendationAudit?.evaluatedAt ?? '2026-09-01T06:00:00Z',
        policyVersion: rec.recommendationAudit?.policyVersion ?? 'synthetic-policy',
        captureVersion: 'same-day-capture-v1',
        appSource: { gitSha: 'abc123', dirty: false },
        minimumSafetyStatus: 'complete',
        evaluatorInputs: {},
        performedTrainingFacts: {
            asOfDate: date,
            windowDays: 7,
            revision: 'canonical-facts-v1:evergreen_general:synthetic',
            exposures: [],
            coverageCredits: [],
        },
        contentHash,
    };
}

export function buildArchiveDoc(rec: DailyRecommendation, revision = 1) {
    const raw = rec as unknown as Record<string, unknown>;
    const data: Record<string, unknown> = {
        revision,
        templateId: rec.templateId,
        templateTitle: rec.templateTitle,
        category: rec.category,
        modality: rec.modality,
        mode: rec.mode,
        rationale: rec.rationale,
    };
    if (raw.engineVerdict) data.engineVerdict = raw.engineVerdict;
    if (rec.prescription) data.prescription = rec.prescription;
    if (rec.primarySession) data.primarySession = rec.primarySession;
    if (rec.additionalSessions) data.additionalSessions = rec.additionalSessions;
    if (rec.recommendationAudit) data.recommendationAudit = rec.recommendationAudit;
    return data;
}

export async function executeScenario(
    env: RulesTestEnvironment,
    fixture: DailyRecommendation,
    scenario: 'S1' | 'S2' | 'S3' | 'S4' | 'S5' | 'S6',
): Promise<boolean> {
    await env.clearFirestore();
    const ctxDoc1 = buildContextDoc(fixture, 1, fixture.recommendationAudit?.decisionContext?.contentHash ?? 'a'.repeat(64));

    if (fixture.recommendationAudit?.identityDecision) {
        await env.withSecurityRulesDisabled(async ctx => {
            const adminDb = ctx.firestore();
            await setDoc(doc(adminDb, `users/${owner}/health_identity_assessments/assessment-max-1`), {
                id: 'assessment-max-1',
                automaticStatus: 'MATCH',
                policyVersion: 'identity-policy-v1',
                featureSchemaVersion: 1,
                passportVersion: 1,
                sharedBundleRef: { provider: 'garmin', transport: 'direct' },
                anchorBundleRefs: [],
                reasonCodes: [],
            });
        });
    }

    const db = env.authenticatedContext(owner).firestore();

    if (scenario === 'S1') {
        try {
            const batch = writeBatch(db);
            batch.set(doc(db, path), fixture);
            if (fixture.recommendationAudit?.decisionContext) {
                batch.set(doc(db, `${path}/decision_contexts/1`), ctxDoc1);
            }
            await batch.commit();
            return true;
        } catch (e: unknown) {
            console.error(`executeScenario S1 failed:`, e instanceof Error ? e.message : e);
            return false;
        }
    }

    // S2-S6: seed S1 first with rules disabled
    await env.withSecurityRulesDisabled(async ctx => {
        const adminDb = ctx.firestore();
        await setDoc(doc(adminDb, path), fixture);
        if (fixture.recommendationAudit?.decisionContext) {
            await setDoc(doc(adminDb, `${path}/decision_contexts/1`), ctxDoc1);
        }
    });

    try {
        if (scenario === 'S2') {
            const updateData = { ...fixture, updatedAt: '2026-09-01T07:00:00Z' };
            await setDoc(doc(db, path), updateData, { mergeFields: Object.keys(updateData) });
            return true;
        }

        if (scenario === 'S3') {
            const batch = writeBatch(db);
            batch.set(doc(db, `${path}/revisions/1`), buildArchiveDoc(fixture, 1));
            const nextAudit = {
                ...fixture.recommendationAudit!,
                evaluatedAt: '2026-09-01T07:00:00Z',
                decisionContext: {
                    path: `${path}/decision_contexts/2`,
                    revision: 2,
                    contentHash: 'b'.repeat(64),
                },
            };
            const nextDoc = {
                ...fixture,
                revision: 2,
                rationale: 'Updated decision rationale for S3',
                updatedAt: '2026-09-01T07:00:00Z',
                recommendationAudit: nextAudit,
            };
            batch.set(doc(db, path), nextDoc, { mergeFields: Object.keys(nextDoc) });
            batch.set(doc(db, `${path}/decision_contexts/2`), buildContextDoc(nextDoc, 2, 'b'.repeat(64)));
            await batch.commit();
            return true;
        }

        if (scenario === 'S4') {
            const batch = writeBatch(db);
            batch.set(doc(db, `${path}/revisions/1`), buildArchiveDoc(fixture, 1));
            const nextAudit = {
                ...fixture.recommendationAudit!,
                evaluatedAt: '2026-09-01T07:00:00Z',
            };
            delete (nextAudit as Record<string, unknown>).decisionContext;
            const nextDoc = {
                ...fixture,
                revision: 2,
                rationale: 'Fallback decision without context for S4',
                updatedAt: '2026-09-01T07:00:00Z',
                recommendationAudit: nextAudit,
            };
            batch.set(doc(db, path), nextDoc, { mergeFields: Object.keys(nextDoc) });
            await batch.commit();
            return true;
        }

        if (scenario === 'S5') {
            await updateDoc(doc(db, path), {
                adherence: {
                    respondedAt: '2026-09-01T12:00:00Z',
                    followed: true,
                    actualModality: 'Cycling',
                    actualDurationMin: 60,
                    skipped: false,
                    notes: 'Adherence completed',
                },
            });
            return true;
        }

        if (scenario === 'S6') {
            const batch = writeBatch(db);
            batch.set(doc(db, `${path}/revisions/1`), buildArchiveDoc(fixture, 1));
            const nextAudit = {
                ...fixture.recommendationAudit!,
                evaluatedAt: '2026-09-01T07:00:00Z',
            };
            delete (nextAudit as Record<string, unknown>).decisionContext;
            const nextDoc: Record<string, unknown> = {
                ...fixture,
                revision: 2,
                rationale: 'Decision dropped primarySession for S6',
                updatedAt: '2026-09-01T07:00:00Z',
                recommendationAudit: nextAudit,
                primarySession: deleteField(),
            };
            batch.set(doc(db, path), nextDoc, { mergeFields: Object.keys(nextDoc) });
            await batch.commit();
            return true;
        }
    } catch (e: unknown) {
        console.error(`executeScenario ${scenario} failed:`, e instanceof Error ? e.message : e);
        return false;
    }
    return false;
}

let probeSeq = 0;
async function measureHeadroom(
    baseRules: string,
    fixture: DailyRecommendation,
    scenario: 'S1' | 'S2' | 'S3' | 'S4' | 'S5' | 'S6',
): Promise<number> {
    const testWithN = async (n: number): Promise<boolean> => {
        const env = await initializeTestEnvironment({
            projectId: `demo-probe-${probeSeq++}`,
            firestore: { rules: rulesWithPadding(baseRules, n) },
        });
        try {
            return await executeScenario(env, fixture, scenario);
        } finally {
            await env.cleanup();
        }
    };

    if (!(await testWithN(0))) return -1;
    let lo = 0;
    let hi = 150;
    while (hi - lo > 1) {
        const mid = Math.floor((lo + hi) / 2);
        if (await testWithN(mid)) {
            lo = mid;
        } else {
            hi = mid - 1;
        }
    }
    if (hi > lo && (await testWithN(hi))) {
        return hi;
    }
    return lo;
}

const BOUNDARY_SIZES = [0, 1, 2, 7, 8, 9, 15, 16, 17, 31, 32, 33, 63, 64];

// ──────────────────────────────────────────────────────────────────────────────
// Test Suite
// ──────────────────────────────────────────────────────────────────────────────

emulatorDescribe('Recommendation audit budget', () => {
    let rawRules: string;
    let environment: RulesTestEnvironment;
    let paddedEnvironment: RulesTestEnvironment;

    beforeAll(async () => {
        rawRules = process.env.AUDIT_BUDGET_BASE
            ? execFileSync(
                  'git',
                  ['show', `${process.env.AUDIT_BUDGET_BASE}:app/firestore.rules`],
                  { encoding: 'utf8' },
              )
            : readFileSync('firestore.rules', 'utf8');

        environment = await initializeTestEnvironment({
            projectId: 'demo-audit-budget',
            firestore: { rules: rawRules },
        });

        paddedEnvironment = await initializeTestEnvironment({
            projectId: 'demo-audit-budget-padded',
            firestore: { rules: rulesWithPadding(rawRules, PAD_THRESHOLD) },
        });
    });

    afterAll(async () => {
        await environment?.cleanup();
        await paddedEnvironment?.cleanup();
    });

    // ── P0 stress matrix (#435) ──────────────────────────────────────────────

    describe('normal bounded audit', () => {
        for (const size of BOUNDARY_SIZES) {
            it(`size=${size}: create then re-save then decision-change+archive`, async () => {
                await environment.clearFirestore();
                const db = environment.authenticatedContext(owner).firestore();
                const original = recommendation(size, false);

                // create
                await assertSucceeds(setDoc(doc(db, path), original));

                if (process.env.AUDIT_BUDGET_CREATE_ONLY) return;

                // unchanged re-save
                await assertSucceeds(
                    setDoc(doc(db, path), { ...original, updatedAt: '2026-09-01T07:00:00Z' }, {
                        mergeFields: Object.keys({ ...original, updatedAt: '2026-09-01T07:00:00Z' }),
                    }),
                );

                // decision-change + atomic archive
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
                const next = {
                    ...original,
                    revision: 2,
                    rationale: 'New decision',
                };
                batch.set(doc(db, path), next, { mergeFields: Object.keys(next) });
                await assertSucceeds(batch.commit());
            });
        }
    });

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

    it('headroom proof: combined=true size=64 create succeeds (worst-case positive control)', async () => {
        await environment.clearFirestore();
        const db = environment.authenticatedContext(owner).firestore();
        const batch = writeBatch(db);
        batch.set(doc(db, path), recommendation(64, true));
        batch.set(doc(db, `${path}/decision_contexts/1`), {
            schemaVersion: 1,
            userId: owner,
            date,
            recommendationRevision: 1,
            evaluatedAt: '2026-09-01T06:00:00Z',
            policyVersion: 'synthetic',
            captureVersion: 'same-day-capture-v1',
            appSource: { gitSha: 'abc123', dirty: false },
            minimumSafetyStatus: 'complete',
            evaluatorInputs: {},
            performedTrainingFacts: {
                asOfDate: date, windowDays: 7, revision: 'canonical-facts-v1:evergreen_general:synthetic',
                exposures: [], coverageCredits: [],
            },
            contentHash: 'a'.repeat(64),
        });
        await assertSucceeds(batch.commit());
    });

    // ── Issue #953: Real-shape fixtures × Scenarios S1-S6 headroom gate ───────

    describe('real-shape fixtures under 40-term padding threshold (headroom >= 40 terms)', () => {
        const fixtures = [
            { name: 'F-catalog', build: fixtureCatalog },
            { name: 'F-external', build: fixtureExternal },
            { name: 'F-rest', build: fixtureRest },
            { name: 'F-maximal', build: fixtureMaximal },
        ];
        const scenarios: Array<'S1' | 'S2' | 'S3' | 'S4' | 'S5' | 'S6'> = [
            'S1', 'S2', 'S3', 'S4', 'S5', 'S6',
        ];

        for (const { name: fName, build } of fixtures) {
            for (const scenario of scenarios) {
                it(`${fName} × ${scenario}: succeeds with at least ${PAD_THRESHOLD} pad terms`, async () => {
                    const fixture = build();
                    const passes = await executeScenario(paddedEnvironment, fixture, scenario);
                    expect(passes, `${fName} × ${scenario} failed under ${PAD_THRESHOLD} pad terms padding`).toBe(true);
                });
            }
        }
    });

    // ── Issue #953 D3 proof: decision change and fallback audit integrity ─────

    describe('decision change and fallback audit integrity (D3)', () => {
        it('decision change wholesale replaces recommendationAudit with no stale externalPlan', async () => {
            await environment.clearFirestore();
            const db = environment.authenticatedContext(owner).firestore();
            const extFixture = fixtureExternal();
            const restFixture = fixtureRest();

            // S1 with external plan
            const b1 = writeBatch(db);
            b1.set(doc(db, path), extFixture);
            if (extFixture.recommendationAudit?.decisionContext) {
                b1.set(doc(db, `${path}/decision_contexts/1`), buildContextDoc(extFixture, 1));
            }
            await assertSucceeds(b1.commit());

            // Decision change to rest
            const batch = writeBatch(db);
            batch.set(doc(db, `${path}/revisions/1`), buildArchiveDoc(extFixture, 1));
            const nextAudit = {
                ...restFixture.recommendationAudit!,
                evaluatedAt: '2026-09-01T07:00:00Z',
                decisionContext: {
                    path: `${path}/decision_contexts/2`,
                    revision: 2,
                    contentHash: 'c'.repeat(64),
                },
            };
            const nextDoc = {
                ...restFixture,
                revision: 2,
                updatedAt: '2026-09-01T07:00:00Z',
                recommendationAudit: nextAudit,
            };
            batch.set(doc(db, path), nextDoc, { mergeFields: Object.keys(nextDoc) });
            batch.set(doc(db, `${path}/decision_contexts/2`), buildContextDoc(nextDoc, 2, 'c'.repeat(64)));
            await assertSucceeds(batch.commit());

            const stored = (await getDoc(doc(db, path))).data();
            expect(stored?.recommendationAudit?.externalRest).toBeDefined();
            expect(stored?.recommendationAudit?.externalPlan).toBeUndefined();
            expect(stored?.recommendationAudit?.authoredOccurrence).toBeUndefined();
        });

        it('no-context fallback revision wholesale replaces recommendationAudit with no stale decisionContext', async () => {
            await environment.clearFirestore();
            const db = environment.authenticatedContext(owner).firestore();
            const catFixture = fixtureCatalog();

            // S1 with context
            const ctxDoc = buildContextDoc(catFixture, 1);
            const b1 = writeBatch(db);
            b1.set(doc(db, path), catFixture);
            b1.set(doc(db, `${path}/decision_contexts/1`), ctxDoc);
            await assertSucceeds(b1.commit());

            // Decision change fallback (without context)
            const b2 = writeBatch(db);
            b2.set(doc(db, `${path}/revisions/1`), buildArchiveDoc(catFixture, 1));
            const auditWithoutContext = { ...catFixture.recommendationAudit!, evaluatedAt: '2026-09-01T07:00:00Z' };
            delete (auditWithoutContext as Record<string, unknown>).decisionContext;
            const fallbackDoc = {
                ...catFixture,
                revision: 2,
                rationale: 'Unbound fallback revision',
                updatedAt: '2026-09-01T07:00:00Z',
                recommendationAudit: auditWithoutContext,
            };
            b2.set(doc(db, path), fallbackDoc, { mergeFields: Object.keys(fallbackDoc) });
            await assertSucceeds(b2.commit());

            const stored = (await getDoc(doc(db, path))).data();
            expect(stored?.revision).toBe(2);
            expect(stored?.recommendationAudit?.decisionContext).toBeUndefined();
        });
    });

    // ── Optional exact measurement report (AUDIT_BUDGET_MEASURE=1) ───────────

    if (process.env.AUDIT_BUDGET_MEASURE) {
        describe('exact headroom measurement (AUDIT_BUDGET_MEASURE=1)', () => {
            it('measures exact pad term headroom for all fixtures and scenarios', async () => {
                const fixtures = [
                    { name: 'F-catalog', build: fixtureCatalog },
                    { name: 'F-external', build: fixtureExternal },
                    { name: 'F-rest', build: fixtureRest },
                    { name: 'F-maximal', build: fixtureMaximal },
                ];
                const scenarios: Array<'S1' | 'S2' | 'S3' | 'S4' | 'S5' | 'S6'> = [
                    'S1', 'S2', 'S3', 'S4', 'S5', 'S6',
                ];

                const results: string[] = [];
                results.push('\n| Fixture | Scenario | Headroom (pad terms) | Headroom (~expressions) |');
                results.push('|---|---|---|---|');

                for (const { name: fName, build } of fixtures) {
                    for (const scenario of scenarios) {
                        const fixture = build();
                        const terms = await measureHeadroom(rawRules, fixture, scenario);
                        const exprs = terms >= 0 ? `~${terms * 5}` : 'FAIL / OVER BUDGET';
                        results.push(`| ${fName} | ${scenario} | ${terms >= 0 ? terms : 'OVER'} | ${exprs} |`);
                    }
                }
                const report = results.join('\n');
                console.log(report);
                appendFileSync('headroom-report.txt', report + '\n');
            }, 600_000);
        });
    }
});
