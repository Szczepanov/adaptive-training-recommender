import { describe, it, expect } from 'vitest';
import {
    isRecoverySnapshotStale,
    isSyncRequestStale,
    isSyncRequestInFlight,
    SNAPSHOT_STALE_AFTER_MS,
    INCOMPLETE_SNAPSHOT_STALE_AFTER_MS,
    STALE_AFTER_MS,
    BACKFILL_PROCESSING_STALE_AFTER_MS,
} from './garminSyncStaleness';
import type { DailyRecoverySnapshot } from '../engine/models';

function createMockSnapshot(overrides: Partial<DailyRecoverySnapshot> = {}): DailyRecoverySnapshot {
    return {
        userId: 'u1',
        date: '2026-08-23',
        raw: {
            restingHr: 52,
            hrvOvernightAvg: 65,
            hrvStatus: 'balanced',
            respirationAvg: 14.5,
            bodyBatteryWake: 90,
            bodyBatteryChange: 50,
            sleepScore: 88,
            sleepDurationSec: 28800,
            totalSteps: 8500,
            last3DaysHardSessionsCount: 1,
            yesterdayTraining: null,
        },
        derived: {
            baselineComputationVersion: 3,
            sleepScore7dAvg: 85,
            sleepScore28dAvg: 82,
            restingHr7dAvg: 53,
            restingHr28dAvg: 52,
            hrv7dAvg: 64,
            hrv28dAvg: 65,
            respiration7dAvg: 14.5,
            respiration28dAvg: 14.6,
            steps7dAvg: 9000,
            steps28dAvg: 9200,
            deltas: {
                sleepScoreVs7d: 3,
                sleepScoreVs28d: 6,
                restingHrVs7d: -1,
                restingHrVs28d: 0,
                hrvVs7d: 1,
                hrvVs28d: 0,
                respirationVs7d: 0,
                respirationVs28d: -0.1,
            },
        },
        source: {
            garminSyncedAt: '2026-08-23T06:00:00.000Z',
            sourceSchemaVersion: 3,
            timezone: 'Europe/Warsaw',
        },
        dataQuality: {
            sleepScoreAvailable: true,
            restingHrAvailable: true,
            hrvAvailable: true,
            baseline7dReady: true,
            baseline28dReady: true,
        },
        ...overrides,
    };
}

describe('garminSyncStaleness', () => {
    describe('isSyncRequestInFlight', () => {
        it('returns true for pending and processing', () => {
            expect(isSyncRequestInFlight({ userId: 'u1', status: 'pending', requestedAt: '2026-08-23T08:00:00Z' })).toBe(true);
            expect(isSyncRequestInFlight({ userId: 'u1', status: 'processing', requestedAt: '2026-08-23T08:00:00Z' })).toBe(true);
        });

        it('returns false for completed, failed, or null', () => {
            expect(isSyncRequestInFlight(null)).toBe(false);
            expect(isSyncRequestInFlight({ userId: 'u1', status: 'completed', requestedAt: '2026-08-23T08:00:00Z' })).toBe(false);
            expect(isSyncRequestInFlight({ userId: 'u1', status: 'failed', requestedAt: '2026-08-23T08:00:00Z' })).toBe(false);
        });
    });

    describe('isSyncRequestStale', () => {
        const baseMs = Date.parse('2026-08-23T08:00:00.000Z');

        it('returns false if not in flight', () => {
            expect(isSyncRequestStale(null, baseMs)).toBe(false);
            expect(isSyncRequestStale({ userId: 'u1', status: 'completed', requestedAt: '2026-08-23T08:00:00Z' }, baseMs + STALE_AFTER_MS + 1000)).toBe(false);
        });

        it('returns false if within stale window', () => {
            const req = { userId: 'u1', status: 'pending' as const, requestedAt: '2026-08-23T08:00:00.000Z' };
            expect(isSyncRequestStale(req, baseMs + 60_000)).toBe(false);
        });

        it('returns true if beyond stale window', () => {
            const req = { userId: 'u1', status: 'pending' as const, requestedAt: '2026-08-23T08:00:00.000Z' };
            expect(isSyncRequestStale(req, baseMs + STALE_AFTER_MS + 1000)).toBe(true);
        });

        it('measures ordinary processing requests from claimedAt using the normal window', () => {
            const req = {
                userId: 'u1',
                status: 'processing' as const,
                requestType: 'sync' as const,
                requestedAt: '2026-08-23T07:50:00.000Z',
                claimedAt: '2026-08-23T08:00:00.000Z',
            };
            // 2 minutes after claimedAt -> not stale even though requestedAt was 12 min ago
            expect(isSyncRequestStale(req, baseMs + 2 * 60 * 1000)).toBe(false);
            // 6 minutes after claimedAt -> stale
            expect(isSyncRequestStale(req, baseMs + 6 * 60 * 1000)).toBe(true);
        });

        it('keeps a claimed backfill live for the backend execution-lease window', () => {
            const req = {
                userId: 'u1',
                status: 'processing' as const,
                requestType: 'initial_backfill' as const,
                requestedAt: '2026-08-23T07:45:00.000Z',
                claimedAt: '2026-08-23T08:00:00.000Z',
                days: 56,
            };

            expect(isSyncRequestStale(req, baseMs + 10 * 60 * 1000)).toBe(false);
            expect(isSyncRequestStale(req, baseMs + BACKFILL_PROCESSING_STALE_AFTER_MS + 1000)).toBe(true);
        });

        it('still lets callers explicitly override the request-aware stale window', () => {
            const req = {
                userId: 'u1',
                status: 'processing' as const,
                requestType: 'backfill' as const,
                requestedAt: '2026-08-23T07:45:00.000Z',
                claimedAt: '2026-08-23T08:00:00.000Z',
                days: 56,
            };

            expect(isSyncRequestStale(req, baseMs + 6 * 60 * 1000, STALE_AFTER_MS)).toBe(true);
        });
    });

    describe('isRecoverySnapshotStale', () => {
        const targetDate = '2026-08-23';
        const syncIso = '2026-08-23T06:00:00.000Z';
        const syncMs = Date.parse(syncIso);

        it('returns true when snapshot is null or undefined', () => {
            expect(isRecoverySnapshotStale(null, targetDate)).toBe(true);
            expect(isRecoverySnapshotStale(undefined, targetDate)).toBe(true);
        });

        it('returns true when snapshot date does not match target date', () => {
            const snapshot = createMockSnapshot({ date: '2026-08-22' });
            expect(isRecoverySnapshotStale(snapshot, targetDate, syncMs + 10_000)).toBe(true);
        });

        it('returns true when garminSyncedAt is missing or invalid', () => {
            const snapshot = createMockSnapshot({
                source: { garminSyncedAt: 'invalid-date', sourceSchemaVersion: 3, timezone: 'Europe/Warsaw' },
            });
            expect(isRecoverySnapshotStale(snapshot, targetDate, syncMs + 10_000)).toBe(true);
        });

        it('returns false when complete snapshot was synced within 60 minutes', () => {
            const snapshot = createMockSnapshot({
                source: { garminSyncedAt: syncIso, sourceSchemaVersion: 3, timezone: 'Europe/Warsaw' },
            });
            // 30 minutes after sync
            expect(isRecoverySnapshotStale(snapshot, targetDate, syncMs + 30 * 60 * 1000)).toBe(false);
            // 59 minutes after sync
            expect(isRecoverySnapshotStale(snapshot, targetDate, syncMs + 59 * 60 * 1000)).toBe(false);
        });

        it('returns true when complete snapshot was synced 60 or more minutes ago', () => {
            const snapshot = createMockSnapshot({
                source: { garminSyncedAt: syncIso, sourceSchemaVersion: 3, timezone: 'Europe/Warsaw' },
            });
            // 60 minutes after sync
            expect(isRecoverySnapshotStale(snapshot, targetDate, syncMs + SNAPSHOT_STALE_AFTER_MS)).toBe(true);
            // 3 hours after sync
            expect(isRecoverySnapshotStale(snapshot, targetDate, syncMs + 3 * 60 * 60 * 1000)).toBe(true);
        });

        it('returns false for incomplete snapshot if synced under 5 minutes ago', () => {
            const incompleteSnapshot = createMockSnapshot({
                raw: {
                    ...createMockSnapshot().raw,
                    sleepScore: null,
                },
                dataQuality: {
                    ...createMockSnapshot().dataQuality,
                    sleepScoreAvailable: false,
                },
                source: { garminSyncedAt: syncIso, sourceSchemaVersion: 3, timezone: 'Europe/Warsaw' },
            });
            // 3 minutes after sync
            expect(isRecoverySnapshotStale(incompleteSnapshot, targetDate, syncMs + 3 * 60 * 1000)).toBe(false);
        });

        it('returns true for incomplete snapshot if synced 5 or more minutes ago', () => {
            const incompleteSnapshot = createMockSnapshot({
                raw: {
                    ...createMockSnapshot().raw,
                    sleepScore: null,
                },
                dataQuality: {
                    ...createMockSnapshot().dataQuality,
                    sleepScoreAvailable: false,
                },
                source: { garminSyncedAt: syncIso, sourceSchemaVersion: 3, timezone: 'Europe/Warsaw' },
            });
            // 5 minutes after sync
            expect(isRecoverySnapshotStale(incompleteSnapshot, targetDate, syncMs + INCOMPLETE_SNAPSHOT_STALE_AFTER_MS)).toBe(true);
        });
    });
});
