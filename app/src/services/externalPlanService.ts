import { collection, doc, getDoc, getDocs, setDoc, type DocumentData } from 'firebase/firestore';
import { getDb } from '../firebase';
import type {
    ExternalPlanHeader,
    ExternalPlanPlacement,
    ExternalTrainingPlan,
} from '../engine/models';
import type { DataIssue, DataState } from '../engine/dataState';
import { validateExternalPlanPlacement, validateExternalTrainingPlan } from '../engine/validation';
import { computeContentHash } from '../engine/externalPlanHash';
import { getErrorCode, getErrorMessage } from '../utils/errors';

/** Re-exported so existing callers keep one import site. The implementation lives in
 * `engine/externalPlanHash.ts` because `replay.ts` verifies against it and must not pull
 * a Firestore-bound module into the audit path. */
export { computeContentHash } from '../engine/externalPlanHash';

export interface ImportResult {
    header: ExternalPlanHeader;
    plan: ExternalTrainingPlan;
}

/** User-scoped persistence for externally-authored plans. A stored revision is immutable:
 * this service only ever creates one, never updates or deletes it. Rescheduling belongs to
 * the placement overlay, and an AI adjustment is a new revision. */
export class ExternalPlanService {
    private headerRef(userId: string, planId: string) {
        return doc(getDb(), 'users', userId, 'external_plans', planId);
    }

    private revisionRef(userId: string, planId: string, revision: number) {
        return doc(getDb(), 'users', userId, 'external_plans', planId, 'revisions', String(revision));
    }

    private placementRef(userId: string, planId: string) {
        return doc(getDb(), 'users', userId, 'external_plans', planId, 'placement', 'current');
    }

    /**
     * Validates and stores one revision. Rejects before writing anything: a plan that is
     * only partly understood must not be half-stored, because a silently dropped session
     * is a session the athlete believes was imported.
     *
     * `supersededFrom` records the date this revision takes effect. Days already
     * adjudicated keep their persisted recommendations and audits regardless.
     */
    async import(userId: string, raw: unknown, supersededFrom: string | null = null): Promise<DataState<ImportResult>> {
        const parsed = validateExternalTrainingPlan(raw);
        if (!parsed.isValid || !parsed.data) {
            const issues: DataIssue[] = parsed.errors.map(error => ({
                code: 'schema-validation-failed',
                field: error.field,
                documentPath: `users/${userId}/external_plans/${typeof (raw as { planId?: unknown })?.planId === 'string' ? (raw as { planId: string }).planId : 'unknown'}`,
            }));
            return { status: 'INVALID', issues };
        }

        const plan = parsed.data;
        try {
            const existing = await getDoc(this.headerRef(userId, plan.planId));
            if (existing.exists()) {
                const storedRevision = existing.data().revision;
                if (typeof storedRevision === 'number' && plan.revision <= storedRevision) {
                    return {
                        status: 'INVALID',
                        issues: [{
                            code: 'revision-not-newer',
                            field: 'revision',
                            documentPath: `users/${userId}/external_plans/${plan.planId}`,
                        }],
                    };
                }
            }

            const now = new Date().toISOString();
            const header: ExternalPlanHeader = {
                userId,
                planId: plan.planId,
                revision: plan.revision,
                title: plan.title,
                startDate: plan.startDate,
                weekCount: plan.weekCount,
                contentHash: await computeContentHash(plan),
                importedAt: now,
                supersededFrom,
                updatedAt: now,
            };

            // Revision first: a header pointing at a revision that failed to write would
            // claim an import that cannot be read back or replayed.
            await setDoc(this.revisionRef(userId, plan.planId, plan.revision), plan as unknown as DocumentData);
            await setDoc(this.headerRef(userId, plan.planId), header as unknown as DocumentData);
            return { status: 'AVAILABLE', data: { header, plan }, revision: header.contentHash };
        } catch (error: unknown) {
            console.error('[ExternalPlanService.import] Failed:', error);
            return {
                status: 'UNAVAILABLE',
                operation: 'import external plan',
                retryable: getErrorCode(error) !== 'permission-denied',
                message: getErrorMessage(error),
            };
        }
    }

    async getHeaderState(userId: string, planId: string): Promise<DataState<ExternalPlanHeader>> {
        try {
            const snapshot = await getDoc(this.headerRef(userId, planId));
            if (!snapshot.exists()) return { status: 'MISSING' };
            const data = snapshot.data() as ExternalPlanHeader;
            if (data.userId !== userId) {
                return { status: 'INVALID', issues: [{ code: 'owner-mismatch', documentPath: `users/${userId}/external_plans/${planId}` }] };
            }
            if (data.planId !== planId) {
                return { status: 'INVALID', issues: [{ code: 'path-identity-mismatch', field: 'planId', documentPath: `users/${userId}/external_plans/${planId}` }] };
            }
            return { status: 'AVAILABLE', data, revision: data.contentHash };
        } catch (error: unknown) {
            console.error('[ExternalPlanService.getHeaderState] Failed:', error);
            return {
                status: 'UNAVAILABLE',
                operation: 'read external plan header',
                retryable: getErrorCode(error) !== 'permission-denied',
                message: getErrorMessage(error),
            };
        }
    }

    /** Re-validates on read. A revision that no longer satisfies the contract -- because
     * the contract moved, or the document was tampered with -- is `INVALID`, never coerced. */
    async getRevisionState(userId: string, planId: string, revision: number): Promise<DataState<ExternalTrainingPlan>> {
        const documentPath = `users/${userId}/external_plans/${planId}/revisions/${revision}`;
        try {
            const snapshot = await getDoc(this.revisionRef(userId, planId, revision));
            if (!snapshot.exists()) return { status: 'MISSING' };
            const parsed = validateExternalTrainingPlan(snapshot.data());
            if (!parsed.isValid || !parsed.data) {
                return {
                    status: 'INVALID',
                    issues: parsed.errors.map(error => ({
                        code: 'schema-validation-failed',
                        field: error.field,
                        documentPath,
                    })),
                };
            }
            // The immutable revision's identity is part of replay provenance. A valid plan
            // stored under the wrong path is still invalid evidence: trusting its internal
            // identifiers would let the path requested by the audit and the bytes actually
            // replayed disagree about which revision was adjudicated.
            if (parsed.data.planId !== planId || parsed.data.revision !== revision) {
                return {
                    status: 'INVALID',
                    issues: [{
                        code: 'path-identity-mismatch',
                        field: parsed.data.planId !== planId ? 'planId' : 'revision',
                        documentPath,
                    }],
                };
            }
            return { status: 'AVAILABLE', data: parsed.data, revision: String(revision) };
        } catch (error: unknown) {
            return { status: 'UNAVAILABLE', operation: 'read external plan revision', retryable: getErrorCode(error) !== 'permission-denied' };
        }
    }

    async listPlanIds(userId: string): Promise<DataState<string[]>> {
        try {
            const snapshot = await getDocs(collection(getDb(), 'users', userId, 'external_plans'));
            return { status: 'AVAILABLE', data: snapshot.docs.map(item => item.id).sort(), revision: null };
        } catch (error: unknown) {
            return { status: 'UNAVAILABLE', operation: 'list external plans', retryable: getErrorCode(error) !== 'permission-denied' };
        }
    }

    async getPlacementState(userId: string, planId: string): Promise<DataState<ExternalPlanPlacement>> {
        try {
            const snapshot = await getDoc(this.placementRef(userId, planId));
            if (!snapshot.exists()) return { status: 'MISSING' };
            const parsed = validateExternalPlanPlacement(snapshot.data());
            if (!parsed.isValid || !parsed.data) {
                return {
                    status: 'INVALID',
                    issues: parsed.errors.map(error => ({
                        code: 'schema-validation-failed',
                        field: error.field,
                        documentPath: `users/${userId}/external_plans/${planId}/placement/current`,
                    })),
                };
            }
            if (parsed.data.userId !== userId) {
                return { status: 'INVALID', issues: [{ code: 'owner-mismatch', documentPath: `users/${userId}/external_plans/${planId}/placement/current` }] };
            }
            if (parsed.data.planId !== planId) {
                return { status: 'INVALID', issues: [{ code: 'path-identity-mismatch', field: 'planId', documentPath: `users/${userId}/external_plans/${planId}/placement/current` }] };
            }
            return { status: 'AVAILABLE', data: parsed.data, revision: parsed.data.updatedAt };
        } catch (error: unknown) {
            return { status: 'UNAVAILABLE', operation: 'read external plan placement', retryable: getErrorCode(error) !== 'permission-denied' };
        }
    }

    /** The overlay is the only mutable part of an imported plan. */
    async savePlacement(userId: string, placement: Omit<ExternalPlanPlacement, 'userId' | 'updatedAt'>): Promise<ExternalPlanPlacement> {
        const stored: ExternalPlanPlacement = { ...placement, userId, updatedAt: new Date().toISOString() };
        const parsed = validateExternalPlanPlacement(stored);
        if (!parsed.isValid) {
            throw new Error(`Invalid placement overlay: ${parsed.errors.map(error => `${error.field}: ${error.message}`).join('; ')}`);
        }
        await setDoc(this.placementRef(userId, placement.planId), stored as unknown as DocumentData);
        return stored;
    }
}

export const externalPlanService = new ExternalPlanService();