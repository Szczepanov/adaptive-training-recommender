import { collection, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import type { UserConstraint } from '../engine/models';

/**
 * Read-only compatibility adapter for v1 constraint documents. It exists solely so
 * trainingSettingsService can perform its one-time, conservative migration. New
 * application code must use trainingSettingsService instead.
 */
export class LegacyConstraintService {
    async listConstraints(userId: string): Promise<UserConstraint[]> {
        const snapshot = await getDocs(collection(db, 'users', userId, 'constraints'));
        return snapshot.docs
            .map(item => item.data() as UserConstraint)
            .filter(item => item.userId === userId);
    }
}

export const constraintService = new LegacyConstraintService();
