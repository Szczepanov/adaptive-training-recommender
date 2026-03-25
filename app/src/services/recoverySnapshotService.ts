import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import type { DailyRecoverySnapshot } from '../engine/models';
import { localDataService } from './localDataService';

export class RecoverySnapshotService {
    async getRecoverySnapshotByDate(userId: string, date: string): Promise<DailyRecoverySnapshot | null> {
        try {
            const localSnapshot = await localDataService.getRecoverySnapshot(date, userId);
            if (localSnapshot) {
                return localSnapshot;
            }

            const scopedRef = doc(db, 'users', userId, 'daily_recovery_snapshots', date);
            const scopedSnap = await getDoc(scopedRef);
            if (scopedSnap.exists()) {
                return scopedSnap.data() as DailyRecoverySnapshot;
            }

            const legacyRef = doc(db, 'daily_recovery_snapshot', date);
            const legacySnap = await getDoc(legacyRef);
            if (legacySnap.exists()) {
                const snapshot = legacySnap.data() as DailyRecoverySnapshot;
                if (snapshot.userId === userId) {
                    return snapshot;
                }
            }

            return null;
        } catch (error) {
            console.error('Error fetching recovery snapshot:', error);
            return null;
        }
    }
}

export const recoverySnapshotService = new RecoverySnapshotService();
