/**
 * Persistence service for athlete-authored home anthropometry entries.
 *
 * Governed by ADR-0039 D-BC-PERSIST and BC0.3.
 */

import {
    collection,
    doc,
    getDoc,
    getDocs,
    orderBy,
    query,
    where,
} from 'firebase/firestore';
import { getAuthInstance, getDb } from '../firebase';
import type { AnthropometryEntry } from '../anthropometry/models';
import { validateAnthropometryEntry } from '../anthropometry/validation';

function validationFields(errors: readonly { field: string }[]): string[] {
    return Array.from(new Set(errors.map(error => error.field)));
}

function validationFieldSummary(errors: readonly { field: string }[]): string {
    return validationFields(errors).join(', ');
}

/**
 * Explicit malformed-persistence signal. It deliberately carries only structural field
 * paths, never raw anthropometric values (ADR-0039 D-BC-PRIVACY).
 */
export class AnthropometryDataValidationError extends Error {
    readonly code = 'invalid-anthropometry-data' as const;
    readonly entryId: string;
    readonly fields: readonly string[];

    constructor(entryId: string, fields: readonly string[]) {
        super(`Invalid anthropometry data for entry ${entryId}; fields: ${fields.join(', ')}`);
        this.name = 'AnthropometryDataValidationError';
        this.entryId = entryId;
        this.fields = fields;
    }
}

interface AnthropometryWriteErrorOptions {
    code: string;
    status?: number;
    retryable?: boolean;
    requestId?: string;
    fields?: readonly string[];
}

/**
 * Safe mutation failure from the server-authoritative write API. It retains structured
 * diagnostics only; neither server nor browser error paths echo anthropometric values.
 */
export class AnthropometryWriteError extends Error {
    readonly code: string;
    readonly status?: number;
    readonly retryable?: boolean;
    readonly requestId?: string;
    readonly fields: readonly string[];

    constructor(message: string, options: AnthropometryWriteErrorOptions) {
        super(message);
        this.name = 'AnthropometryWriteError';
        this.code = options.code;
        this.status = options.status;
        this.retryable = options.retryable;
        this.requestId = options.requestId;
        this.fields = options.fields ?? [];
    }
}

function asRecord(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
}

function safeStringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((field): field is string => typeof field === 'string') : [];
}

export class AnthropometryService {
    private collectionPath(userId: string): string {
        return `users/${userId}/anthropometry_entries`;
    }

    /**
     * Get a specific entry by entryId. Missing is null; malformed persistence is an
     * explicit error and is never collapsed into the same state as missing data.
     */
    async getEntry(userId: string, entryId: string): Promise<AnthropometryEntry | null> {
        const docRef = doc(getDb(), this.collectionPath(userId), entryId);
        const snap = await getDoc(docRef);
        if (!snap.exists()) return null;

        const validation = validateAnthropometryEntry(snap.data());
        if (!validation.isValid || !validation.data) {
            throw new AnthropometryDataValidationError(entryId, validationFields(validation.errors));
        }
        return validation.data;
    }

    /**
     * Query entries within a bounded date range [startDateInclusive, endDateInclusive].
     * A malformed row invalidates the read rather than being silently omitted from a trend.
     */
    async getEntriesInRange(
        userId: string,
        startDateInclusive: string,
        endDateInclusive: string,
    ): Promise<AnthropometryEntry[]> {
        const collRef = collection(getDb(), this.collectionPath(userId));
        const q = query(
            collRef,
            where('date', '>=', startDateInclusive),
            where('date', '<=', endDateInclusive),
            orderBy('date', 'asc'),
            orderBy('observedAt', 'asc'),
        );

        const snap = await getDocs(q);
        const entries: AnthropometryEntry[] = [];

        for (const docSnap of snap.docs) {
            const validation = validateAnthropometryEntry(docSnap.data());
            if (!validation.isValid || !validation.data) {
                throw new AnthropometryDataValidationError(docSnap.id, validationFields(validation.errors));
            }
            entries.push(validation.data);
        }

        return entries;
    }

    private validateEntryForWrite(entry: AnthropometryEntry): AnthropometryEntry {
        const validation = validateAnthropometryEntry(entry);
        if (!validation.isValid || !validation.data) {
            throw new Error(`Anthropometry validation failed for fields: ${validationFieldSummary(validation.errors)}`);
        }
        return validation.data;
    }

    private async authenticatedHeaders(userId: string, includeJsonContentType: boolean): Promise<Record<string, string>> {
        const currentUser = getAuthInstance().currentUser;
        if (!currentUser) {
            throw new AnthropometryWriteError('Your app session expired. Sign in again first.', {
                code: 'anthropometry.auth.no_session',
                retryable: false,
            });
        }
        if (currentUser.uid !== userId) {
            throw new AnthropometryWriteError('The active app session does not own this entry.', {
                code: 'anthropometry.auth.user_mismatch',
                retryable: false,
            });
        }
        return {
            Authorization: `Bearer ${await currentUser.getIdToken()}`,
            ...(includeJsonContentType ? { 'Content-Type': 'application/json' } : {}),
        };
    }

    private async mutation(
        userId: string,
        path: string,
        method: 'POST' | 'PUT',
        entry: AnthropometryEntry,
    ): Promise<AnthropometryEntry>;
    private async mutation(
        userId: string,
        path: string,
        method: 'DELETE',
    ): Promise<void>;
    private async mutation(
        userId: string,
        path: string,
        method: 'POST' | 'PUT' | 'DELETE',
        entry?: AnthropometryEntry,
    ): Promise<AnthropometryEntry | void> {
        let response: Response;
        try {
            response = await fetch(path, {
                method,
                headers: await this.authenticatedHeaders(userId, entry !== undefined),
                ...(entry ? { body: JSON.stringify({ entry }) } : {}),
            });
        } catch (error) {
            if (error instanceof AnthropometryWriteError) throw error;
            throw new AnthropometryWriteError('Could not reach the anthropometry save service. Check your connection and try again.', {
                code: 'anthropometry.network',
                retryable: true,
            });
        }

        if (response.status === 204) {
            if (entry !== undefined) {
                throw new AnthropometryWriteError('The server did not return the saved entry.', {
                    code: 'anthropometry.protocol.missing_entry',
                    status: response.status,
                    retryable: false,
                });
            }
            return;
        }
        const payload = asRecord(await response.json().catch(() => null));
        if (!response.ok) {
            throw new AnthropometryWriteError('Could not save the anthropometry entry.', {
                code: typeof payload.errorCode === 'string' ? payload.errorCode : `anthropometry.http_${response.status}`,
                status: response.status,
                retryable: typeof payload.retryable === 'boolean' ? payload.retryable : response.status >= 500,
                requestId: typeof payload.requestId === 'string'
                    ? payload.requestId
                    : response.headers.get('X-Request-ID') ?? undefined,
                fields: safeStringArray(payload.fields),
            });
        }

        const validation = validateAnthropometryEntry(payload.entry);
        if (!validation.isValid || !validation.data) {
            throw new AnthropometryDataValidationError(entry?.id ?? 'unknown', validationFields(validation.errors));
        }
        return validation.data;
    }

    /**
     * Create a new entry through the token-authenticated, server-authoritative API.
     */
    async createEntry(userId: string, entry: AnthropometryEntry): Promise<AnthropometryEntry> {
        const validated = this.validateEntryForWrite(entry);
        if (validated.userId !== userId) {
            throw new Error('Anthropometry user ID mismatch');
        }
        if (validated.revision !== 1) {
            throw new Error(`Initial entry revision must be 1, got ${entry.revision}`);
        }
        return this.mutation(userId, '/api/anthropometry/entries', 'POST', validated);
    }

    /**
     * Correct an existing anthropometry entry, advancing revision by 1.
     */
    async correctEntry(userId: string, entry: AnthropometryEntry): Promise<AnthropometryEntry> {
        const validated = this.validateEntryForWrite(entry);
        if (validated.userId !== userId) {
            throw new Error('Anthropometry user ID mismatch');
        }
        return this.mutation(
            userId,
            `/api/anthropometry/entries/${encodeURIComponent(validated.id)}`,
            'PUT',
            validated,
        );
    }

    /**
     * Delete an anthropometry entry.
     */
    async deleteEntry(userId: string, entryId: string): Promise<void> {
        await this.mutation(
            userId,
            `/api/anthropometry/entries/${encodeURIComponent(entryId)}`,
            'DELETE',
        );
    }
}

export const anthropometryService = new AnthropometryService();
