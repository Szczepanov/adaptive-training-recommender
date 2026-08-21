import { collection, doc, getDoc, getDocs, orderBy, query, where } from 'firebase/firestore';
import { getDb } from '../firebase';
import type { DailyRecoverySnapshot } from '../engine/models';
import type { DataIssue, DataState } from '../engine/dataState';
import { isValidDate } from '../engine/validation';
import { localDataService } from './localDataService';
import { parseRecoverySnapshot } from '../persistence/parsers/decisionInputs';

export class RecoverySnapshotService {
    async getRecoverySnapshotState(userId: string, date: string): Promise<DataState<DailyRecoverySnapshot>> {
        const documentPath = `users/${userId}/daily_recovery_snapshots/${date}`;
        try {
            const scopedRef = doc(getDb(), 'users', userId, 'daily_recovery_snapshots', date);
            const scopedSnap = await getDoc(scopedRef);
            if (scopedSnap.exists()) {
                return parseRecoverySnapshot(scopedSnap.data(), documentPath, userId, date);
            }
        } catch {
            return { status: 'UNAVAILABLE', operation: 'read recovery snapshot', retryable: true };
        }

        // Development cache is only consulted after an authoritative Firestore miss;
        // a Firestore failure above is never hidden by fixture data.
        const localSnapshot = await localDataService.getRecoverySnapshot(date, userId);
        if (!localSnapshot) return { status: 'MISSING' };
        return parseRecoverySnapshot(localSnapshot, 'local/raw_cache.json', userId, date);
    }

    /**
     * Bounded canonical history read for HA2/HA3 composition. The range is half-open so the
     * evaluation date can be passed as `endDateExclusive` and therefore cannot enter its own
     * reference baseline. Unlike the single-day development fallback, history comes only from
     * canonical Firestore snapshots so replay provenance is explicit rather than fixture-mixed.
     */
    async getRecoverySnapshotsInRangeState(
        userId: string,
        startDateInclusive: string,
        endDateExclusive: string,
    ): Promise<DataState<DailyRecoverySnapshot[]>> {
        const rangePath = `users/${userId}/daily_recovery_snapshots`;
        if (!isValidDate(startDateInclusive) || !isValidDate(endDateExclusive) || startDateInclusive >= endDateExclusive) {
            return {
                status: 'INVALID',
                issues: [{ code: 'invalid-date-range', documentPath: rangePath, field: 'date' }],
            };
        }

        try {
            const ref = collection(getDb(), 'users', userId, 'daily_recovery_snapshots');
            const result = await getDocs(query(
                ref,
                where('date', '>=', startDateInclusive),
                where('date', '<', endDateExclusive),
                orderBy('date', 'asc'),
            ));
            if (result.empty) return { status: 'MISSING' };

            const snapshots: DailyRecoverySnapshot[] = [];
            const issues: DataIssue[] = [];
            const revisions: string[] = [];
            for (const item of result.docs) {
                const documentPath = `${rangePath}/${item.id}`;
                const parsed = parseRecoverySnapshot(item.data(), documentPath, userId, item.id);
                if (parsed.status !== 'AVAILABLE') {
                    if (parsed.status === 'INVALID') issues.push(...parsed.issues);
                    else issues.push({ code: `unexpected-${parsed.status.toLowerCase()}-range-row`, documentPath });
                    continue;
                }
                if (parsed.data.date < startDateInclusive || parsed.data.date >= endDateExclusive) {
                    issues.push({ code: 'row-outside-requested-range', documentPath, field: 'date' });
                    continue;
                }
                snapshots.push(parsed.data);
                revisions.push(parsed.revision ?? `${parsed.data.date}:${parsed.data.source.garminSyncedAt}:${parsed.data.derived.baselineComputationVersion}`);
            }

            if (snapshots.length === 0) {
                return issues.length > 0 ? { status: 'INVALID', issues } : { status: 'MISSING' };
            }
            return {
                status: 'AVAILABLE',
                data: snapshots,
                revision: revisions.sort().join('|') || null,
                ...(issues.length > 0 ? { issues } : {}),
            };
        } catch {
            return { status: 'UNAVAILABLE', operation: 'read recovery snapshot history', retryable: true };
        }
    }

    async getRecoverySnapshotByDate(userId: string, date: string): Promise<DailyRecoverySnapshot | null> {
        const state = await this.getRecoverySnapshotState(userId, date);
        return state.status === 'AVAILABLE' ? state.data : null;
    }
}

export const recoverySnapshotService = new RecoverySnapshotService();
