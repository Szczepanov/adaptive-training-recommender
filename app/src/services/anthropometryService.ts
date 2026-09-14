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
    setDoc,
    deleteDoc,
    where,
} from 'firebase/firestore';
import { getDb } from '../firebase';
import type { AnthropometryEntry } from '../anthropometry/models';
import { validateAnthropometryEntry } from '../anthropometry/validation';

function validationFieldSummary(errors: readonly { field: string }[]): string {
    return Array.from(new Set(errors.map(error => error.field))).join(', ');
}

export class AnthropometryService {
    private collectionPath(userId: string): string {
        return `users/${userId}/anthropometry_entries`;
    }

    /**
     * Get a specific entry by entryId.
     */
    async getEntry(userId: string, entryId: string): Promise<AnthropometryEntry | null> {
        const docRef = doc(getDb(), this.collectionPath(userId), entryId);
        const snap = await getDoc(docRef);
        if (!snap.exists()) return null;

        const validation = validateAnthropometryEntry(snap.data());
        if (!validation.isValid || !validation.data) {
            console.warn(`[anthropometry] Malformed entry ${entryId} for user ${userId}, fields:`, validation.errors.map(e => e.field));
            return null;
        }
        return validation.data;
    }

    /**
     * Query entries within a bounded date range [startDateInclusive, endDateInclusive].
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
            if (validation.isValid && validation.data) {
                entries.push(validation.data);
            } else {
                console.warn(`[anthropometry] Omitting invalid entry ${docSnap.id}, fields:`, validation.errors.map(e => e.field));
            }
        }

        return entries;
    }

    /**
     * Create a new anthropometry entry. Requires revision === 1.
     */
    async createEntry(userId: string, entry: AnthropometryEntry): Promise<AnthropometryEntry> {
        const validation = validateAnthropometryEntry(entry);
        if (!validation.isValid || !validation.data) {
            throw new Error(`Anthropometry validation failed for fields: ${validationFieldSummary(validation.errors)}`);
        }
        if (entry.userId !== userId) {
            throw new Error('Anthropometry user ID mismatch');
        }
        if (entry.revision !== 1) {
            throw new Error(`Initial entry revision must be 1, got ${entry.revision}`);
        }

        const docRef = doc(getDb(), this.collectionPath(userId), entry.id);
        await setDoc(docRef, validation.data);
        return validation.data;
    }

    /**
     * Correct an existing anthropometry entry, advancing revision by 1.
     */
    async correctEntry(userId: string, entry: AnthropometryEntry): Promise<AnthropometryEntry> {
        const validation = validateAnthropometryEntry(entry);
        if (!validation.isValid || !validation.data) {
            throw new Error(`Anthropometry validation failed for fields: ${validationFieldSummary(validation.errors)}`);
        }
        if (entry.userId !== userId) {
            throw new Error('Anthropometry user ID mismatch');
        }

        const docRef = doc(getDb(), this.collectionPath(userId), entry.id);
        const existingSnap = await getDoc(docRef);
        if (!existingSnap.exists()) {
            throw new Error(`Cannot correct non-existent entry ${entry.id}`);
        }

        const existingData = existingSnap.data() as AnthropometryEntry;
        const expectedRevision = (existingData.revision ?? 1) + 1;
        if (entry.revision !== expectedRevision) {
            throw new Error(`Revision conflict: current revision is ${existingData.revision}, expected next revision ${expectedRevision}, got ${entry.revision}`);
        }

        const updatedEntry: AnthropometryEntry = {
            ...validation.data,
            createdAt: existingData.createdAt,
            updatedAt: new Date().toISOString(),
        };

        await setDoc(docRef, updatedEntry);
        return updatedEntry;
    }

    /**
     * Delete an anthropometry entry.
     */
    async deleteEntry(userId: string, entryId: string): Promise<void> {
        const docRef = doc(getDb(), this.collectionPath(userId), entryId);
        await deleteDoc(docRef);
    }
}

export const anthropometryService = new AnthropometryService();
