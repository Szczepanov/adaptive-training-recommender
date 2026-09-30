import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, it } from 'vitest';
import {
    assertFails,
    assertSucceeds,
    initializeTestEnvironment,
    type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, setDoc, updateDoc, writeBatch } from 'firebase/firestore';

const emulatorDescribe = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
let testEnvironment: RulesTestEnvironment;

type TestFirestore = ReturnType<ReturnType<RulesTestEnvironment['authenticatedContext']>['firestore']>;

function omit(record: Record<string, unknown>, ...keys: string[]): Record<string, unknown> {
    return Object.fromEntries(Object.entries(record).filter(([key]) => !keys.includes(key)));
}

const ownerId = 'athlete-trials-owner';
const otherUserId = 'athlete-trials-other';
const protocolId = 'field-standing-broad-jump';
const protocolRevision = 1;
const protocolPath = `users/${ownerId}/measurement_protocols/${protocolId}/revisions/${protocolRevision}`;
const attemptId = 'attempt-jump-1';
const attemptPath = `users/${ownerId}/assessment_attempts/${attemptId}`;
const metricId = 'standing_broad_jump_distance_cm';
const observationKey = `${attemptId}:${metricId}`;
const observationPath = `users/${ownerId}/metric_observations/${observationKey}`;
const revision1Path = `${observationPath}/revisions/1`;

function validCapture() {
    return {
        plannedTrials: 3,
        maxTrials: 6,
        fields: [
            { id: 'distance_cm', label: 'Distance', valueKind: 'number', unit: 'cm', required: true, minimum: 1, maximum: 400 },
        ],
        reducers: [
            { kind: 'max_valid', metricId: 'standing_broad_jump_distance_cm', fieldId: 'distance_cm' },
        ],
        reducerVersion: 'assessment-reducer-v1',
    };
}

function validProtocol(overrides: Record<string, unknown> = {}) {
    return {
        id: protocolId,
        revision: protocolRevision,
        title: 'Standing broad jump',
        intent: 'testing',
        metricIds: [metricId],
        instructions: [{ id: 'stance', text: 'Static two-foot stance.' }],
        comparisonContext: {
            required: ['measurement_method_id', 'equipment_setup_id'],
            seriesDefining: ['measurement_method_id', 'equipment_setup_id'],
            contextOnly: [] as string[],
            canonicalizationVersion: 'comparison-series-v1',
        },
        familiarization: { required: false, minimumExposures: 0 },
        burden: 'low',
        expectedRecoveryHours: 24,
        invalidationRules: ['Stepped backward'],
        capture: validCapture(),
        createdAt: '2026-09-30T00:00:00.000Z',
        ...overrides,
    };
}

/** Summary-only protocol (no capture contract): manual canonical values remain allowed. */
function summaryProtocol(id: string, overrides: Record<string, unknown> = {}) {
    const protocol: Record<string, unknown> = validProtocol({ id, ...overrides });
    delete protocol.capture;
    return protocol;
}

function validAttempt(state: 'scheduled' | 'in_progress' | 'completed' | 'abandoned' = 'in_progress') {
    const startedAt = state !== 'scheduled' ? '2026-10-19T07:00:00.000Z' : undefined;
    const completedAt = state === 'completed' ? '2026-10-19T07:30:00.000Z' : undefined;
    return {
        id: attemptId,
        protocolRef: { id: protocolId, revision: protocolRevision },
        scheduledDate: '2026-10-19',
        ...(startedAt ? { startedAt } : {}),
        ...(completedAt ? { completedAt } : {}),
        state,
        purpose: 'baseline',
    };
}

function validTrial(ordinal = 1, correctionIndex = 0, overrides: Record<string, unknown> = {}) {
    const id = correctionIndex === 0 ? `trial-${ordinal}` : `trial-${ordinal}-c${correctionIndex}`;
    return {
        id,
        assessmentAttemptId: attemptId,
        ordinal,
        correctionIndex,
        ...(correctionIndex > 0 ? {
            supersedesTrialId: correctionIndex === 1 ? `trial-${ordinal}` : `trial-${ordinal}-c${correctionIndex - 1}`,
            correctionReason: 'Measurement error corrected',
        } : {}),
        validity: 'valid',
        values: { distance_cm: 235 + ordinal },
        context: {},
        createdAt: '2026-10-19T07:15:00.000Z',
        ...overrides,
    };
}

function validHead(headRevision = 1) {
    return {
        observationKey,
        assessmentAttemptId: attemptId,
        metricId,
        headRevision,
        createdAt: '2026-10-19T07:35:00.000Z',
        updatedAt: '2026-10-19T07:35:00.000Z',
    };
}

function validDerivedRevision(overrides: Record<string, unknown> = {}) {
    return {
        observationKey,
        revision: 1,
        metricId,
        value: 238,
        unit: 'cm',
        observedAt: '2026-10-19T07:30:00.000Z',
        source: 'derived',
        protocolRef: { id: protocolId, revision: protocolRevision },
        comparisonSeriesKey: 'a'.repeat(64),
        comparisonCanonicalizationVersion: 'comparison-series-v1',
        assessmentAttemptId: attemptId,
        validity: 'valid',
        context: { measurement_method_id: 'tape', equipment_setup_id: 'track' },
        derivedFromEvidenceRefs: [
            { kind: 'assessment_trial', assessmentAttemptId: attemptId, trialId: 'trial-1' },
        ],
        algorithmVersion: 'assessment-reducer-v1',
        createdAt: '2026-10-19T07:35:00.000Z',
        ...overrides,
    };
}

emulatorDescribe('Assessment trial and derivation Firestore rules (ADR-0046)', () => {
    beforeAll(async () => {
        const rulesContent = readFileSync(resolve(process.cwd(), 'firestore.rules'), 'utf8');
        testEnvironment = await initializeTestEnvironment({
            projectId: 'demo-adaptive-training-ov-trials',
            firestore: { rules: rulesContent },
        });
    });

    afterEach(async () => {
        await testEnvironment.clearFirestore();
    });

    afterAll(async () => {
        await testEnvironment.cleanup();
    });

    async function seedProtocolAndAttempt(attemptState: 'scheduled' | 'in_progress' | 'completed' | 'abandoned' = 'in_progress') {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertSucceeds(setDoc(doc(ownerDb, protocolPath), validProtocol()));
        await assertSucceeds(setDoc(doc(ownerDb, attemptPath), validAttempt(attemptState)));
        return ownerDb;
    }

    /** Seeds a summary-only protocol + completed attempt; returns paths for a revision-1 write. */
    async function seedSummaryAttempt(suffix: string, metric = metricId) {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        const summaryId = `proto-summary-${suffix}`;
        const summaryAttemptId = `attempt-summary-${suffix}`;
        await assertSucceeds(setDoc(
            doc(ownerDb, `users/${ownerId}/measurement_protocols/${summaryId}/revisions/1`),
            summaryProtocol(summaryId, { metricIds: [metric] }),
        ));
        await assertSucceeds(setDoc(doc(ownerDb, `users/${ownerId}/assessment_attempts/${summaryAttemptId}`), {
            ...validAttempt('completed'),
            id: summaryAttemptId,
            protocolRef: { id: summaryId, revision: 1 },
        }));
        const key = `${summaryAttemptId}:${metric}`;
        const headPath = `users/${ownerId}/metric_observations/${key}`;
        return {
            ownerDb,
            headPath,
            revisionPath: `${headPath}/revisions/1`,
            head: { ...validHead(1), observationKey: key, assessmentAttemptId: summaryAttemptId, metricId: metric },
            /** A manual revision-1 payload for this attempt; overrides may re-add derivation fields. */
            revision: (overrides: Record<string, unknown> = {}) => {
                return {
                    ...omit(validDerivedRevision(), 'derivedFromEvidenceRefs', 'algorithmVersion'),
                    observationKey: key,
                    metricId: metric,
                    assessmentAttemptId: summaryAttemptId,
                    protocolRef: { id: summaryId, revision: 1 },
                    source: 'manual',
                    ...overrides,
                };
            },
        };
    }

    function commitRevision1(ownerDb: TestFirestore, revisionPath: string, headPath: string, revision: object, head: object) {
        const batch = writeBatch(ownerDb);
        batch.set(doc(ownerDb, revisionPath), revision);
        batch.set(doc(ownerDb, headPath), head);
        return batch.commit();
    }

    it('allows protocol with valid capture and rejects malformed capture', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();

        // Valid capture accepted
        await assertSucceeds(setDoc(doc(ownerDb, protocolPath), validProtocol()));

        // Malformed capture: maxTrials > 30 rejected
        const tooManyTrials = validProtocol({
            id: 'proto-too-many-trials',
            capture: { ...validCapture(), maxTrials: 31 },
        });
        await assertFails(setDoc(doc(ownerDb, `users/${ownerId}/measurement_protocols/proto-too-many-trials/revisions/1`), tooManyTrials));

        // Malformed capture: fields empty rejected
        const emptyFields = validProtocol({
            id: 'proto-empty-fields',
            capture: { ...validCapture(), fields: [] },
        });
        await assertFails(setDoc(doc(ownerDb, `users/${ownerId}/measurement_protocols/proto-empty-fields/revisions/1`), emptyFields));

        // Malformed capture: unsupported reducerVersion rejected
        const badVersion = validProtocol({
            id: 'proto-bad-version',
            capture: { ...validCapture(), reducerVersion: 'assessment-reducer-v2' },
        });
        await assertFails(setDoc(doc(ownerDb, `users/${ownerId}/measurement_protocols/proto-bad-version/revisions/1`), badVersion));
    });

    it('accepts new comparison dimensions in measurement protocol comparisonContext', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        const protocolWithNewDims = validProtocol({
            comparisonContext: {
                required: ['measurement_method_id', 'equipment_setup_id'],
                seriesDefining: ['measurement_method_id', 'equipment_setup_id'],
                contextOnly: [] as string[],
                canonicalizationVersion: 'comparison-series-v1',
            },
        });
        await assertSucceeds(setDoc(doc(ownerDb, protocolPath), protocolWithNewDims));
    });

    it('accepts all 12 registry metrics and correct units on protocols and observations, and rejects wrong unit', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        const registryMetrics: [string, string][] = [
            ['cycling_tt_20m_mean_power_w', 'W'],
            ['cycling_tt_4m_mean_power_w', 'W'],
            ['cycling_submax_mean_hr_bpm', 'bpm'],
            ['cycling_submax_rpe', 'rpe'],
            ['strength_1rm_kg', 'kg'],
            ['sprint_elapsed_time_s', 's'],
            ['cycling_5s_peak_power_w', 'W'],
            ['standing_broad_jump_distance_cm', 'cm'],
            ['wall_touch_cmj_height_cm', 'cm'],
            ['seated_medball_throw_distance_m', 'm'],
            ['cycling_sprint_1s_peak_power_w', 'W'],
            ['cycling_sprint_5s_mean_power_w', 'W'],
        ];

        for (const [mId, unit] of registryMetrics) {
            const protoDocId = `proto-${mId}`;
            const protoDocPath = `users/${ownerId}/measurement_protocols/${protoDocId}/revisions/1`;
            // Summary-only protocol: a capture protocol would (correctly) reject manual values.
            await assertSucceeds(setDoc(doc(ownerDb, protoDocPath), summaryProtocol(protoDocId, { metricIds: [mId] })));

            const aId = `attempt-${mId}`;
            const aPath = `users/${ownerId}/assessment_attempts/${aId}`;
            await assertSucceeds(setDoc(doc(ownerDb, aPath), {
                id: aId,
                protocolRef: { id: protoDocId, revision: 1 },
                state: 'completed',
                startedAt: '2026-10-19T07:00:00.000Z',
                completedAt: '2026-10-19T07:30:00.000Z',
                purpose: 'baseline',
            }));

            const obsKey = `${aId}:${mId}`;
            const oPath = `users/${ownerId}/metric_observations/${obsKey}`;
            const revPath = `${oPath}/revisions/1`;

            const batch = writeBatch(ownerDb);
            batch.set(doc(ownerDb, revPath), {
                observationKey: obsKey,
                revision: 1,
                metricId: mId,
                value: 100,
                unit,
                observedAt: '2026-10-19T07:30:00.000Z',
                source: 'manual',
                protocolRef: { id: protoDocId, revision: 1 },
                comparisonSeriesKey: 'b'.repeat(64),
                comparisonCanonicalizationVersion: 'comparison-series-v1',
                assessmentAttemptId: aId,
                validity: 'valid',
                context: { measurement_method_id: 'method', equipment_setup_id: 'setup' },
                createdAt: '2026-10-19T07:35:00.000Z',
            });
            batch.set(doc(ownerDb, oPath), {
                observationKey: obsKey,
                assessmentAttemptId: aId,
                metricId: mId,
                headRevision: 1,
                createdAt: '2026-10-19T07:35:00.000Z',
                updatedAt: '2026-10-19T07:35:00.000Z',
            });
            await assertSucceeds(batch.commit());
        }

        // Wrong unit rejected: the same revision-1 write succeeds only with the registry unit.
        const unitCase = await seedSummaryAttempt('unit');
        await assertFails(commitRevision1(unitCase.ownerDb, unitCase.revisionPath, unitCase.headPath,
            unitCase.revision({ value: 2.38, unit: 'm' }), unitCase.head));
        await assertSucceeds(commitRevision1(unitCase.ownerDb, unitCase.revisionPath, unitCase.headPath,
            unitCase.revision({ value: 238, unit: 'cm' }), unitCase.head));
    });

    it('allows trial create on in_progress attempt and enforces trial immutability (denies update and delete)', async () => {
        const ownerDb = await seedProtocolAndAttempt('in_progress');
        const trialPath = `${attemptPath}/trials/trial-1`;

        await assertSucceeds(setDoc(doc(ownerDb, trialPath), validTrial(1)));

        // Update denied
        await assertFails(updateDoc(doc(ownerDb, trialPath), { values: { distance_cm: 250 } }));

        // Delete denied
        await assertFails(deleteDoc(doc(ownerDb, trialPath)));
    });

    it('denies cross-user trial read and write', async () => {
        const ownerDb = await seedProtocolAndAttempt('in_progress');
        const trialPath = `${attemptPath}/trials/trial-1`;
        await assertSucceeds(setDoc(doc(ownerDb, trialPath), validTrial(1)));

        const otherDb = testEnvironment.authenticatedContext(otherUserId).firestore();
        await assertFails(getDoc(doc(otherDb, trialPath)));
        await assertFails(setDoc(doc(otherDb, `${attemptPath}/trials/trial-2`), validTrial(2)));
    });

    it('rejects unknown fields, wrong id formula, ordinal > maxTrials, and protocols without capture', async () => {
        const ownerDb = await seedProtocolAndAttempt('in_progress');

        // Unknown field
        await assertFails(setDoc(doc(ownerDb, `${attemptPath}/trials/trial-1`), {
            ...validTrial(1),
            unsupportedField: 'unexpected',
        }));

        // Wrong id formula (id does not match trial-{ordinal})
        await assertFails(setDoc(doc(ownerDb, `${attemptPath}/trials/custom-trial-id`), {
            ...validTrial(1),
            id: 'custom-trial-id',
        }));

        // Ordinal > maxTrials (maxTrials is 6 in validCapture)
        await assertFails(setDoc(doc(ownerDb, `${attemptPath}/trials/trial-7`), validTrial(7)));

        // Protocol without capture
        const noCaptureProtocol = validProtocol({ id: 'proto-no-capture' });
        delete (noCaptureProtocol as { capture?: unknown }).capture;
        await assertSucceeds(setDoc(doc(ownerDb, `users/${ownerId}/measurement_protocols/proto-no-capture/revisions/1`), noCaptureProtocol));

        const noCaptureAttempt = {
            ...validAttempt('in_progress'),
            id: 'attempt-no-capture',
            protocolRef: { id: 'proto-no-capture', revision: 1 },
        };
        await assertSucceeds(setDoc(doc(ownerDb, `users/${ownerId}/assessment_attempts/attempt-no-capture`), noCaptureAttempt));

        await assertFails(setDoc(
            doc(ownerDb, `users/${ownerId}/assessment_attempts/attempt-no-capture/trials/trial-1`),
            { ...validTrial(1), assessmentAttemptId: 'attempt-no-capture' },
        ));
    });

    it('denies new ordinal on completed attempt but admits valid correction', async () => {
        const ownerDb = await seedProtocolAndAttempt('in_progress');
        const trial1Path = `${attemptPath}/trials/trial-1`;
        await assertSucceeds(setDoc(doc(ownerDb, trial1Path), validTrial(1)));

        // Transition attempt to completed
        await assertSucceeds(updateDoc(doc(ownerDb, attemptPath), {
            state: 'completed',
            completedAt: '2026-10-19T07:30:00.000Z',
        }));

        // New ordinal on completed attempt denied
        await assertFails(setDoc(doc(ownerDb, `${attemptPath}/trials/trial-2`), validTrial(2)));

        // Correction of existing trial-1 admitted
        const correctionPath = `${attemptPath}/trials/trial-1-c1`;
        await assertSucceeds(setDoc(doc(ownerDb, correctionPath), validTrial(1, 1)));
    });

    it('denies trial writes on scheduled and abandoned attempts', async () => {
        const ownerDb = await seedProtocolAndAttempt('scheduled');
        await assertFails(setDoc(doc(ownerDb, `${attemptPath}/trials/trial-1`), validTrial(1)));

        await testEnvironment.clearFirestore();

        const ownerDbAbandoned = await seedProtocolAndAttempt('abandoned');
        await assertFails(setDoc(doc(ownerDbAbandoned, `${attemptPath}/trials/trial-1`), validTrial(1)));
    });

    it('denies correction without existing superseded trial', async () => {
        const ownerDb = await seedProtocolAndAttempt('in_progress');
        // trial-1 does NOT exist
        const correctionPath = `${attemptPath}/trials/trial-1-c1`;
        await assertFails(setDoc(doc(ownerDb, correctionPath), validTrial(1, 1)));
    });

    it('allows correction and original in the same batch via existsAfter', async () => {
        const ownerDb = await seedProtocolAndAttempt('in_progress');
        const batch = writeBatch(ownerDb);
        batch.set(doc(ownerDb, `${attemptPath}/trials/trial-1`), validTrial(1, 0));
        batch.set(doc(ownerDb, `${attemptPath}/trials/trial-1-c1`), validTrial(1, 1));
        await assertSucceeds(batch.commit());
    });

    it('denies duplicate correction index (fork) because trial documents are immutable', async () => {
        const ownerDb = await seedProtocolAndAttempt('in_progress');
        await assertSucceeds(setDoc(doc(ownerDb, `${attemptPath}/trials/trial-1`), validTrial(1, 0)));
        await assertSucceeds(setDoc(doc(ownerDb, `${attemptPath}/trials/trial-1-c1`), validTrial(1, 1)));

        // Trying to overwrite trial-1-c1 denied
        await assertFails(setDoc(doc(ownerDb, `${attemptPath}/trials/trial-1-c1`), {
            ...validTrial(1, 1),
            values: { distance_cm: 299 },
        }));
    });

    it('accepts a trial-derived observation only with typed refs and the protocol reducer version', async () => {
        const ownerDb = await seedProtocolAndAttempt('in_progress');
        await assertSucceeds(setDoc(doc(ownerDb, `${attemptPath}/trials/trial-1`), validTrial(1)));

        const neither = omit(validDerivedRevision(), 'derivedFromEvidenceRefs');
        await assertFails(commitRevision1(ownerDb, revision1Path, observationPath, neither, validHead(1)));
        await assertFails(commitRevision1(ownerDb, revision1Path, observationPath,
            validDerivedRevision({ algorithmVersion: 'assessment-reducer-v0' }), validHead(1)));
        await assertSucceeds(commitRevision1(ownerDb, revision1Path, observationPath, validDerivedRevision(), validHead(1)));
    });

    it('rejects hand-typed manual canonical values for a trial-capture protocol', async () => {
        const ownerDb = await seedProtocolAndAttempt('completed');
        const manual = omit(validDerivedRevision(), 'derivedFromEvidenceRefs', 'algorithmVersion');
        await assertFails(commitRevision1(ownerDb, revision1Path, observationPath, { ...manual, source: 'manual' }, validHead(1)));
        await assertSucceeds(commitRevision1(ownerDb, revision1Path, observationPath, validDerivedRevision(), validHead(1)));
    });

    it('rejects a trial-derived observation on an abandoned attempt', async () => {
        const ownerDb = await seedProtocolAndAttempt('abandoned');
        await assertFails(commitRevision1(ownerDb, revision1Path, observationPath, validDerivedRevision(), validHead(1)));
    });

    it('rejects a non-derived observation carrying derivation fields on a summary-only protocol', async () => {
        const summary = await seedSummaryAttempt('manual-refs');
        const refs = [{ kind: 'assessment_trial', assessmentAttemptId: 'attempt-summary-manual-refs', trialId: 'trial-1' }];
        await assertFails(commitRevision1(summary.ownerDb, summary.revisionPath, summary.headPath,
            summary.revision({ derivedFromEvidenceRefs: refs, algorithmVersion: 'assessment-reducer-v1' }), summary.head));
        await assertSucceeds(commitRevision1(summary.ownerDb, summary.revisionPath, summary.headPath,
            summary.revision(), summary.head));
    });

    it('still accepts a legacy observation-derived revision on a summary-only protocol', async () => {
        const summary = await seedSummaryAttempt('legacy');
        await assertSucceeds(commitRevision1(summary.ownerDb, summary.revisionPath, summary.headPath,
            summary.revision({ source: 'derived', derivedFromObservationIds: ['prior-obs-id-1'], algorithmVersion: 'legacy-derivation-v1' }),
            summary.head));
    });
});
