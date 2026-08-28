import {
    doc,
    getDoc,
    setDoc,
    writeBatch,
    collection,
    getDocs,
    type Firestore,
} from 'firebase/firestore';
import { getDb } from '../firebase';
import type { DataState } from '../engine/dataState';
import type { SessionDefinition } from '../sessions/models';
import { parseSessionDefinitionRevisionDocument } from '../persistence/parsers/sessionDefinition';
import { hashSessionDefinition } from '../sessions/sessionDefinitionHash';
import { validateSessionDefinition } from '../sessions/validation';

export interface SessionDefinitionHeader {
    userId: string;
    definitionId: string;
    title: string;
    latestRevision: number;
    dominantModality?: string;
    /** Missing only on headers written before template archiving existed; read as active. */
    status: 'active' | 'archived';
    archivedAt?: string;
    createdAt: string;
    updatedAt: string;
}

export interface SavedSessionDefinitionRevision {
    header: SessionDefinitionHeader;
    contentHash: string;
}

export class SessionDefinitionService {
    private readonly db: Firestore;

    constructor(db: Firestore = getDb()) {
        this.db = db;
    }

    private headerRef(userId: string, definitionId: string) {
        return doc(this.db, 'users', userId, 'session_definitions', definitionId);
    }

    private revisionRef(userId: string, definitionId: string, revision: number) {
        return doc(
            this.db,
            'users',
            userId,
            'session_definitions',
            definitionId,
            'revisions',
            String(revision),
        );
    }

    async saveDefinitionRevision(
        userId: string,
        definition: SessionDefinition,
    ): Promise<SavedSessionDefinitionRevision> {
        const validation = validateSessionDefinition(definition);
        if (!validation.ok) {
            throw new Error(validation.issues.map(issue => `${issue.path}: ${issue.message}`).join('\n'));
        }
        const contentHash = await hashSessionDefinition(definition);
        const now = new Date().toISOString();
        const existingHeader = await getDoc(this.headerRef(userId, definition.id));
        const existing = existingHeader.exists() ? existingHeader.data() as Partial<SessionDefinitionHeader> : null;
        if (existing && typeof existing.latestRevision === 'number' && definition.revision <= existing.latestRevision) {
            throw new Error(`Definition revision ${definition.revision} must advance latest revision ${existing.latestRevision}`);
        }
        const header: SessionDefinitionHeader = {
            userId,
            definitionId: definition.id,
            title: definition.title,
            latestRevision: definition.revision,
            ...(definition.dominantModality ? { dominantModality: definition.dominantModality } : {}),
            status: existing?.status === 'archived' ? 'archived' : 'active',
            ...(existing?.status === 'archived' && typeof existing.archivedAt === 'string' ? { archivedAt: existing.archivedAt } : {}),
            createdAt: typeof existing?.createdAt === 'string' ? existing.createdAt : now,
            updatedAt: now,
        };

        const revisionPayload = {
            ...definition,
            userId,
            definitionId: definition.id,
            revision: definition.revision,
            contentHash,
            createdAt: now,
        };

        // The revision and pointer are one logical write. Rules retain the create-only
        // guard on revisions, so a stale writer cannot overwrite historical bytes.
        const batch = writeBatch(this.db);
        batch.set(this.revisionRef(userId, definition.id, definition.revision), revisionPayload);
        batch.set(this.headerRef(userId, definition.id), header, { merge: true });
        await batch.commit();
        return { header, contentHash };
    }

    async getDefinitionHeader(userId: string, definitionId: string): Promise<DataState<SessionDefinitionHeader>> {
        const path = `users/${userId}/session_definitions/${definitionId}`;
        try {
            const snap = await getDoc(this.headerRef(userId, definitionId));
            if (!snap.exists()) return { status: 'MISSING' };
            const data = snap.data() as Record<string, unknown>;
            if (
                data.userId === userId &&
                data.definitionId === definitionId &&
                Number.isInteger(data.latestRevision) && (data.latestRevision as number) >= 1 &&
                typeof data.title === 'string' &&
                typeof data.createdAt === 'string' &&
                typeof data.updatedAt === 'string' &&
                (data.status === undefined || data.status === 'active' || data.status === 'archived') &&
                (data.archivedAt === undefined || typeof data.archivedAt === 'string') &&
                (data.status !== 'archived' || typeof data.archivedAt === 'string') &&
                (data.status !== 'active' || data.archivedAt === undefined)
            ) {
                return {
                    status: 'AVAILABLE',
                    data: {
                        userId,
                        definitionId,
                        title: data.title as string,
                        latestRevision: data.latestRevision as number,
                        ...(typeof data.dominantModality === 'string' ? { dominantModality: data.dominantModality } : {}),
                        status: data.status === 'archived' ? 'archived' : 'active',
                        ...(typeof data.archivedAt === 'string' ? { archivedAt: data.archivedAt } : {}),
                        createdAt: data.createdAt as string,
                        updatedAt: data.updatedAt as string,
                    },
                    revision: null,
                };
            }
            return {
                status: 'INVALID',
                issues: [{ code: 'invalid-header', documentPath: path }],
            };
        } catch (err: unknown) {
            const code = (err as { code?: string })?.code;
            if (code === 'permission-denied') throw err;
            return { status: 'UNAVAILABLE', operation: 'getDefinitionHeader', retryable: true };
        }
    }

    async getDefinitionRevision(
        userId: string,
        definitionId: string,
        revision: number,
    ): Promise<DataState<SessionDefinition>> {
        const path = `users/${userId}/session_definitions/${definitionId}/revisions/${revision}`;
        try {
            const snap = await getDoc(this.revisionRef(userId, definitionId, revision));
            const parsed = parseSessionDefinitionRevisionDocument(
                snap.exists() ? snap.data() : undefined,
                { userId, definitionId, revision },
                path,
            );
            if (parsed.status !== 'AVAILABLE') return parsed;
            if (await hashSessionDefinition(parsed.data.definition) !== parsed.data.contentHash) {
                return {
                    status: 'INVALID',
                    issues: [{ code: 'session-definition-hash-mismatch', documentPath: path, field: 'contentHash' }],
                };
            }
            return { status: 'AVAILABLE', data: parsed.data.definition, revision: String(revision) };
        } catch (err: unknown) {
            const code = (err as { code?: string })?.code;
            if (code === 'permission-denied') throw err;
            return { status: 'UNAVAILABLE', operation: 'getDefinitionRevision', retryable: true };
        }
    }

    async listDefinitionHeaders(userId: string): Promise<DataState<SessionDefinitionHeader[]>> {
        try {
            const snap = await getDocs(collection(this.db, 'users', userId, 'session_definitions'));
            const headers: SessionDefinitionHeader[] = [];
            for (const document of snap.docs) {
                const data = document.data() as Partial<SessionDefinitionHeader>;
                const latestRevision = data.latestRevision;
                if (
                    data.userId !== userId
                    || data.definitionId !== document.id
                    || typeof data.title !== 'string'
                    || !Number.isInteger(latestRevision)
                    || typeof data.createdAt !== 'string'
                    || typeof data.updatedAt !== 'string'
                    || (data.status !== undefined && data.status !== 'active' && data.status !== 'archived')
                    || (data.status === 'archived' && typeof data.archivedAt !== 'string')
                    || (data.status === 'active' && data.archivedAt !== undefined)
                ) {
                    return { status: 'INVALID', issues: [{ code: 'invalid-header', documentPath: document.ref.path }] };
                }
                headers.push({
                    userId,
                    definitionId: data.definitionId,
                    title: data.title,
                    latestRevision: latestRevision as number,
                    ...(typeof data.dominantModality === 'string' ? { dominantModality: data.dominantModality } : {}),
                    status: data.status === 'archived' ? 'archived' : 'active',
                    ...(typeof data.archivedAt === 'string' ? { archivedAt: data.archivedAt } : {}),
                    createdAt: data.createdAt,
                    updatedAt: data.updatedAt,
                });
            }
            return {
                status: 'AVAILABLE',
                data: headers.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
                revision: null,
            };
        } catch (err: unknown) {
            const code = (err as { code?: string })?.code;
            if (code === 'permission-denied') throw err;
            return { status: 'UNAVAILABLE', operation: 'listDefinitionHeaders', retryable: true };
        }
    }

    async listRevisions(userId: string, definitionId: string): Promise<number[]> {
        const coll = collection(this.db, 'users', userId, 'session_definitions', definitionId, 'revisions');
        const snap = await getDocs(coll);
        return snap.docs
            .map(d => parseInt(d.id, 10))
            .filter(n => !isNaN(n))
            .sort((a, b) => a - b);
    }

    async setDefinitionArchived(
        userId: string,
        definitionId: string,
        archived: boolean,
    ): Promise<SessionDefinitionHeader> {
        const current = await this.getDefinitionHeader(userId, definitionId);
        if (current.status === 'MISSING') throw new Error('The saved template no longer exists.');
        if (current.status !== 'AVAILABLE') throw new Error('The saved template cannot be updated safely.');

        const now = new Date().toISOString();
        const headerWithoutArchiveTime = { ...current.data };
        delete headerWithoutArchiveTime.archivedAt;
        const header: SessionDefinitionHeader = {
            ...headerWithoutArchiveTime,
            status: archived ? 'archived' : 'active',
            ...(archived ? { archivedAt: now } : {}),
            updatedAt: now,
        };
        await setDoc(this.headerRef(userId, definitionId), header);
        return header;
    }
}

export const sessionDefinitionService = new SessionDefinitionService();
