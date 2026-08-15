import { collection, doc, getDoc, getDocs, setDoc, type DocumentData } from 'firebase/firestore';
import { getDb } from '../firebase';
import type {
    ExternalPlanHeader,
    ExternalPlanPlacement,
    ExternalTrainingPlan,
} from '../engine/models';
import type { DataIssue, DataState } from '../engine/dataState';
import { validateExternalTrainingPlan } from '../engine/validation';
import { getErrorCode } from '../utils/errors';

/** Stable ordering so the same document always hashes the same. `JSON.stringify` preserves
 * insertion order, which differs between a freshly-parsed import and a Firestore read. */
function canonicalise(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonicalise);
    if (value && typeof value === 'object') {
        return Object.fromEntries(
            Object.keys(value as Record<string, unknown>)
                .sort()
                .map(key => [key, canonicalise((value as Record<string, unknown>)[key])]),
        );
    }
    return value;
}

/** SHA-256 over the canonical JSON of a revision (ADR-0019 D-IMMUT). Persisted on the
 * header and, later, on the decision audit, so a replay can prove which bytes it read. */
export async function computeContentHash(plan: ExternalTrainingPlan): Promise<string> {
    const canonical = JSON.stringify(canonicalise(plan));
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
    return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('');
}

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
            return { status: 'UNAVAILABLE', operation: 'import external plan', retryable: getErrorCode(error) !== 'permission-denied' };
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
            return { status: 'AVAILABLE', data, revision: data.contentHash };
        } catch (error: unknown) {
            return { status: 'UNAVAILABLE', operation: 'read external plan header', retryable: getErrorCode(error) !== 'permission-denied' };
        }
    }

    /** Re-validates on read. A revision that no longer satisfies the contract -- because
     * the contract moved, or the document was tampered with -- is `INVALID`, never coerced. */
    async getRevisionState(userId: string, planId: string, revision: number): Promise<DataState<ExternalTrainingPlan>> {
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
                        documentPath: `users/${userId}/external_plans/${planId}/revisions/${revision}`,
                    })),
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
            const data = snapshot.data() as ExternalPlanPlacement;
            if (data.userId !== userId) {
                return { status: 'INVALID', issues: [{ code: 'owner-mismatch', documentPath: `users/${userId}/external_plans/${planId}/placement/current` }] };
            }
            return { status: 'AVAILABLE', data, revision: data.updatedAt };
        } catch (error: unknown) {
            return { status: 'UNAVAILABLE', operation: 'read external plan placement', retryable: getErrorCode(error) !== 'permission-denied' };
        }
    }

    /** The overlay is the only mutable part of an imported plan. */
    async savePlacement(userId: string, placement: Omit<ExternalPlanPlacement, 'userId' | 'updatedAt'>): Promise<ExternalPlanPlacement> {
        const stored: ExternalPlanPlacement = { ...placement, userId, updatedAt: new Date().toISOString() };
        await setDoc(this.placementRef(userId, placement.planId), stored as unknown as DocumentData);
        return stored;
    }
}

export const externalPlanService = new ExternalPlanService();
