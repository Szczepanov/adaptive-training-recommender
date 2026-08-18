import {
    doc,
    getDoc,
    setDoc,
    collection,
    getDocs,
    type Firestore,
} from 'firebase/firestore';
import { getDb } from '../firebase';
import type { DataState } from '../engine/dataState';
import type { SessionDefinition } from '../sessions/models';
import { parseSessionDefinitionDocument } from '../persistence/parsers/sessionDefinition';

export interface SessionDefinitionHeader {
    userId: string;
    definitionId: string;
    title: string;
    latestRevision: number;
    dominantModality?: string;
    createdAt: string;
    updatedAt: string;
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
        contentHash: string,
    ): Promise<void> {
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

        // Write write-once revision first, then update header pointer
        await setDoc(this.revisionRef(userId, definition.id, definition.revision), revisionPayload);
        await setDoc(this.headerRef(userId, definition.id), header, { merge: true });
    }

    async getDefinitionHeader(userId: string, definitionId: string): Promise<DataState<SessionDefinitionHeader>> {
        const path = `users/${userId}/session_definitions/${definitionId}`;
        try {
            const snap = await getDoc(this.headerRef(userId, definitionId));
            if (!snap.exists()) return { status: 'MISSING' };
            const data = snap.data() as Record<string, unknown>;
            if (
                typeof data.userId === 'string' &&
                typeof data.definitionId === 'string' &&
                typeof data.latestRevision === 'number'
            ) {
                return {
                    status: 'AVAILABLE',
                    data: data as unknown as SessionDefinitionHeader,
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
            return parseSessionDefinitionDocument(snap.exists() ? snap.data() : undefined, path);
        } catch (err: unknown) {
            const code = (err as { code?: string })?.code;
            if (code === 'permission-denied') throw err;
            return { status: 'UNAVAILABLE', operation: 'getDefinitionRevision', retryable: true };
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
}

export const sessionDefinitionService = new SessionDefinitionService();
