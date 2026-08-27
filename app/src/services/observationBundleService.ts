import {
    collection,
    doc,
    getDoc,
    getDocs,
    query,
    where,
    type Firestore,
} from 'firebase/firestore';
import type { HealthObservationDayBundle } from '../observations/models';

export class ObservationBundleService {
    private readonly db: Firestore;

    constructor(db: Firestore) {
        this.db = db;
    }

    async getHealthObservationDayBundle(
        userId: string,
        logicalDate: string,
        provider: string,
        transport: string,
    ): Promise<HealthObservationDayBundle | null> {
        const docId = `${logicalDate}_${provider}_${transport}`;
        const docRef = doc(this.db, 'users', userId, 'health_observation_days', docId);
        const snapshot = await getDoc(docRef);

        if (!snapshot.exists()) {
            return null;
        }

        return snapshot.data() as HealthObservationDayBundle;
    }

    async getHealthObservationBundlesInRange(
        userId: string,
        startDate: string,
        endDate: string,
        provider?: string,
        transport?: string,
    ): Promise<HealthObservationDayBundle[]> {
        const colRef = collection(this.db, 'users', userId, 'health_observation_days');
        const constraints = [
            where('logicalDate', '>=', startDate),
            where('logicalDate', '<=', endDate),
        ];

        if (provider) {
            constraints.push(where('provider', '==', provider));
        }
        if (transport) {
            constraints.push(where('transport', '==', transport));
        }

        const q = query(colRef, ...constraints);
        const snapshot = await getDocs(q);

        const bundles = snapshot.docs.map((d) => d.data() as HealthObservationDayBundle);
        bundles.sort((a, b) => a.logicalDate.localeCompare(b.logicalDate));
        return bundles;
    }
}
