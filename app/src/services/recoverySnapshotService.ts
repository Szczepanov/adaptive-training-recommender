import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import type { DailyRecoverySnapshot } from '../engine/models';
import type { DataState } from '../engine/dataState';
import { localDataService } from './localDataService';
import { parseRecoverySnapshot } from '../persistence/parsers/decisionInputs';

export class RecoverySnapshotService {
    async getRecoverySnapshotState(userId: string, date: string): Promise<DataState<DailyRecoverySnapshot>> {
        const documentPath = `users/${userId}/daily_recovery_snapshots/${date}`;
        try {
            const scopedRef = doc(db, 'users', userId, 'daily_recovery_snapshots', date);
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

    async getRecoverySnapshotByDate(userId: string, date: string): Promise<DailyRecoverySnapshot | null> {
        const state = await this.getRecoverySnapshotState(userId, date);
        return state.status === 'AVAILABLE' ? state.data : null;
    }
}

export const recoverySnapshotService = new RecoverySnapshotService();
