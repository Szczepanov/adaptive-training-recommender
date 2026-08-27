import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AutomaticIdentityAssessment, IdentityReviewEvent } from '../observations/identityModels';

const firestore = vi.hoisted(() => ({
    collection: vi.fn(),
    doc: vi.fn(),
    getDoc: vi.fn(),
    getDocs: vi.fn(),
    query: vi.fn((value: unknown) => value),
    runTransaction: vi.fn(),
    serverTimestamp: vi.fn(() => ({ sentinel: 'server-timestamp' })),
    where: vi.fn(),
}));
vi.mock('firebase/firestore', () => firestore);
vi.mock('../firebase', () => ({ getDb: vi.fn(() => ({ id: 'db' })) }));

import {
    IdentityPersistenceService,
    parseAutomaticIdentityAssessment,
    parseIdentityPassportCurrent,
    parseIdentityPassportVersion,
    parseIdentityReviewEvent,
} from './identityPersistence';

function passportCore() {
    return {
        schemaVersion: 1,
        passportVersion: '2026-08-27.1',
        policyVersion: 'identity-v1-shadow',
        featureSchemaVersion: 'identity-features-v1',
        anchorPolicy: {
            primaryProvider: 'garmin',
            primaryTransport: 'garmin_direct',
            role: 'PERSONAL_DEVICE_ANCHOR',
            requireIndependentLineage: true,
        },
        sourceProfiles: {},
        crossSourceProfiles: {},
        calibration: {
            manualUserCount: 0,
            manualNotUserCount: 0,
            mixedOccupancyCount: 0,
            uncertainCount: 0,
            shadowWindowStart: null,
            shadowWindowEnd: null,
        },
        createdAt: '2026-08-27T06:00:00.000Z',
    };
}

function assessment(overrides: Partial<AutomaticIdentityAssessment> = {}): AutomaticIdentityAssessment {
    return {
        id: 'assessment-1',
        sourceNightKey: '2026-08-27',
        sharedSource: { provider: 'eight_sleep', transport: 'google_health' },
        automaticStatus: 'UNCERTAIN',
        identityScore: 0.73,
        confidenceTier: 'MODERATE',
        reasonCodes: ['SESSION_TIMING_DISCORDANT'],
        passportVersion: '2026-08-27.1',
        policyVersion: 'identity-v1-shadow',
        featureSchemaVersion: 'identity-features-v1',
        assessedAt: '2026-08-27T06:00:00.000Z',
        sharedBundleRef: {
            id: '2026-08-27_eight_sleep_google_health',
            provider: 'eight_sleep',
            transport: 'google_health',
            revision: 2,
            sourcePayloadHash: 'sha256:shared',
            lineageKey: 'eight_sleep:pod-side:a',
        },
        anchorBundleRefs: [],
        ...overrides,
    };
}

function review(overrides: Partial<IdentityReviewEvent> = {}): IdentityReviewEvent {
    return {
        id: 'review-1',
        assessmentId: 'assessment-1',
        schemaVersion: 1,
        label: 'USER',
        occupancyAttestation: 'EXCLUSIVE',
        supersedesReviewEventId: null,
        recordedAt: '2026-08-27T08:00:00.000Z',
        source: 'user_ui',
        ...overrides,
    };
}

function snapshot(value: unknown | null) {
    return {
        exists: () => value !== null,
        data: () => value,
    };
}

describe('identity persistence validation (PI6)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        firestore.doc.mockImplementation((_db: unknown, ...parts: string[]) => ({ path: parts.join('/') }));
        firestore.collection.mockImplementation((_db: unknown, ...parts: string[]) => ({ path: parts.join('/') }));
    });

    it('round-trips current and immutable passport shapes and enforces version/path identity', () => {
        const current = { ...passportCore(), updatedAt: '2026-08-27T07:00:00.000Z' };
        expect(parseIdentityPassportCurrent(current)).toBe(current);

        const version = {
            ...passportCore(),
            trainingSetHash: 'a'.repeat(64),
            trainingObservationCount: 42,
            trainingWindowStart: '2026-07-01',
            trainingWindowEnd: '2026-08-26',
            previousVersion: null,
            changeReason: 'INITIAL_BOOTSTRAP',
            algorithmVersion: 'passport-bootstrap-v1',
        };
        expect(parseIdentityPassportVersion(version, '2026-08-27.1')).toBe(version);
        expect(() => parseIdentityPassportVersion(version, 'different-version')).toThrow('version/path mismatch');
    });

    it('freezes automatic assessment evidence and rejects path or replay-metadata mismatches', () => {
        const parsed = parseAutomaticIdentityAssessment(assessment(), 'assessment-1');
        expect(Object.isFrozen(parsed)).toBe(true);
        expect(Object.isFrozen(parsed.sharedBundleRef)).toBe(true);
        expect(() => parseAutomaticIdentityAssessment(assessment(), 'assessment-2')).toThrow('id/path mismatch');
        expect(() => parseAutomaticIdentityAssessment(assessment({
            sharedBundleRef: { ...assessment().sharedBundleRef, revision: 0 },
        }))).toThrow('revision is invalid');
    });

    it('derives effective state from persisted append-only corrections without mutating assessment output', async () => {
        const automatic = assessment();
        const first = review();
        const correction = review({
            id: 'review-2',
            label: 'NOT_USER',
            occupancyAttestation: 'UNKNOWN',
            supersedesReviewEventId: 'review-1',
            recordedAt: '2026-08-27T09:00:00.000Z',
        });
        firestore.getDoc.mockResolvedValue(snapshot(automatic));
        firestore.getDocs.mockResolvedValue({
            docs: [
                { id: first.id, data: () => first },
                { id: correction.id, data: () => correction },
            ],
        });

        const projection = await new IdentityPersistenceService().getEffectiveProjection('u1', automatic.id);
        expect(projection?.decision).toEqual(expect.objectContaining({
            effectiveStatus: 'NOT_USER',
            authority: 'MANUAL_REVIEW',
            reviewEventId: 'review-2',
        }));
        expect(projection?.decision.eligibility.baselineLearning).toBe(false);
        expect(automatic.automaticStatus).toBe('UNCERTAIN');
    });

    it('creates a constrained user review only when its assessment exists', async () => {
        const transaction = {
            get: vi.fn(async (ref: { path: string }) => {
                if (ref.path.includes('health_identity_assessments')) return snapshot(assessment());
                return snapshot(null);
            }),
            set: vi.fn(),
        };
        firestore.runTransaction.mockImplementation(async (
            _db: unknown,
            callback: (tx: typeof transaction) => unknown,
        ) => callback(transaction));
        firestore.getDoc.mockResolvedValue(snapshot(review()));

        const created = await new IdentityPersistenceService().submitUserReview({
            userId: 'u1',
            id: 'review-1',
            assessmentId: 'assessment-1',
            label: 'USER',
            occupancyAttestation: 'EXCLUSIVE',
            supersedesReviewEventId: null,
        });
        expect(created).toEqual(review());
        expect(transaction.set).toHaveBeenCalledOnce();
    });

    it('accepts an exact idempotent retry but rejects changed content under the same event id', async () => {
        const existing = review();
        const transaction = {
            get: vi.fn(async (ref: { path: string }) => {
                if (ref.path.includes('health_identity_assessments')) return snapshot(assessment());
                return snapshot(existing);
            }),
            set: vi.fn(),
        };
        firestore.runTransaction.mockImplementation(async (
            _db: unknown,
            callback: (tx: typeof transaction) => unknown,
        ) => callback(transaction));
        const service = new IdentityPersistenceService();
        const params = {
            userId: 'u1', id: existing.id, assessmentId: existing.assessmentId,
            label: existing.label, occupancyAttestation: existing.occupancyAttestation,
            supersedesReviewEventId: existing.supersedesReviewEventId,
        } as const;
        await expect(service.submitUserReview(params)).resolves.toEqual(existing);
        await expect(service.submitUserReview({ ...params, label: 'UNCERTAIN', occupancyAttestation: 'UNKNOWN' }))
            .rejects.toThrow('different content');
        expect(transaction.set).not.toHaveBeenCalled();
    });

    it('enforces semantic attestation and parseable server-ordering timestamps', async () => {
        const service = new IdentityPersistenceService();
        await expect(service.submitUserReview({
            userId: 'u1', id: 'bad-1', assessmentId: 'assessment-1', label: 'USER',
            occupancyAttestation: 'MIXED', supersedesReviewEventId: null,
        })).rejects.toThrow('requires exclusive');
        expect(() => parseIdentityReviewEvent(review({ recordedAt: 'not-a-date' })))
            .toThrow();
        expect(parseIdentityReviewEvent({
            ...review(),
            recordedAt: { toDate: () => new Date('2026-08-27T08:00:00.000Z') },
        }).recordedAt).toBe('2026-08-27T08:00:00.000Z');
        expect(firestore.runTransaction).not.toHaveBeenCalled();
    });
});
