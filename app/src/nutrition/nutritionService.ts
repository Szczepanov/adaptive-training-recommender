/**
 * Nutrition data service for querying and subscribing to user-scoped nutrition observations.
 * Path: users/{userId}/nutrition_days/{daySourceId}
 */

import { collection, getDocs, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { getDb } from '../firebase';
import type { NutritionDay } from './models';
import type { DataState } from '../engine/dataState';
import { isPermissionDeniedError } from '../utils/errors';

/**
 * Maps a raw Firestore nutrition document to the client domain NutritionDay model.
 * Handles both flat backend DTO keys (logicalDate, provider, transport, proteinG, isPartial)
 * and nested client domain keys (source, macronutrients, isPartialDay).
 */
export function mapNutritionDocToNutritionDay(doc: Record<string, unknown>): NutritionDay {
    const rawDate = (doc.logicalDate || doc.date || '') as string;
    const sourceObj =
        typeof doc.source === 'object' && doc.source !== null ? (doc.source as Record<string, unknown>) : null;
    const provider = (doc.provider || sourceObj?.provider || 'unknown') as string;
    const transport = (doc.transport || sourceObj?.transport || 'unknown') as string;
    const rawOrigin = doc.origin ?? sourceObj?.origin ?? null;
    const origin = typeof rawOrigin === 'string' && rawOrigin.trim().length > 0 ? rawOrigin : null;

    const macrosObj = typeof doc.macronutrients === 'object' && doc.macronutrients !== null ? (doc.macronutrients as Record<string, unknown>) : null;
    const proteinGrams = (doc.proteinG ?? macrosObj?.proteinGrams ?? null) as number | null;
    const carbsGrams = (doc.carbohydrateG ?? macrosObj?.carbsGrams ?? null) as number | null;
    const fatGrams = (doc.fatG ?? macrosObj?.fatGrams ?? null) as number | null;
    const fiberGrams = (doc.fiberG ?? macrosObj?.fiberGrams ?? null) as number | null;

    const hasMacros = proteinGrams !== null || carbsGrams !== null || fatGrams !== null || fiberGrams !== null;

    const microsObj = typeof doc.micronutrients === 'object' && doc.micronutrients !== null ? (doc.micronutrients as Record<string, unknown>) : null;
    const expenditureObj =
        typeof doc.energyExpenditureKcal === 'object' && doc.energyExpenditureKcal !== null
            ? (doc.energyExpenditureKcal as Record<string, unknown>)
            : null;
    const energyIntakeKcal = (doc.energyIntakeKcal as number | null) ?? null;
    const hasIntakeData =
        typeof doc.hasIntakeData === 'boolean' ? doc.hasIntakeData : energyIntakeKcal !== null;

    return {
        schemaVersion: (doc.schemaVersion as number) ?? 1,
        date: rawDate,
        source: {
            provider,
            transport,
            origin,
        },
        loggedAt: (doc.loggedAt as string | null) ?? null,
        syncedAt: ((doc.ingestedAt || doc.syncedAt || '') as string),
        energyIntakeKcal,
        hasIntakeData,
        energyExpenditureKcal: expenditureObj
            ? {
                  resting: (expenditureObj.resting as number | null) ?? null,
                  active: (expenditureObj.active as number | null) ?? null,
                  total: (expenditureObj.total as number | null) ?? null,
              }
            : null,
        macronutrients: hasMacros
            ? {
                  proteinGrams,
                  carbsGrams,
                  fatGrams,
                  fiberGrams,
              }
            : null,
        micronutrients: {
            sodiumMg: (doc.sodiumMg ?? microsObj?.sodiumMg ?? null) as number | null,
            potassiumMg: (doc.potassiumMg ?? microsObj?.potassiumMg ?? null) as number | null,
            waterMl: (doc.waterMl ?? microsObj?.waterMl ?? null) as number | null,
        },
        isPartialDay: Boolean(doc.isPartial ?? doc.isPartialDay ?? false),
        confidenceScore: (doc.confidenceScore as number) ?? 1.0,
        rawPayloadHash: (doc.rawPayloadHash as string | null) ?? null,
    };
}

export class NutritionService {
    async getNutritionDaysState(
        userId: string,
        startDateInclusive: string,
        endDateInclusive: string,
    ): Promise<DataState<NutritionDay[]>> {
        if (!userId) return { status: 'MISSING' };

        try {
            const collRef = collection(getDb(), 'users', userId, 'nutrition_days');
            const q = query(
                collRef,
                where('logicalDate', '>=', startDateInclusive),
                where('logicalDate', '<=', endDateInclusive),
                orderBy('logicalDate', 'asc'),
            );
            const snapshot = await getDocs(q);
            if (snapshot.empty) return { status: 'MISSING' };

            const days: NutritionDay[] = [];
            for (const docSnap of snapshot.docs) {
                const data = docSnap.data();
                if (!data) continue;
                const mapped = mapNutritionDocToNutritionDay(data);
                if (mapped.date) {
                    days.push(mapped);
                }
            }

            if (days.length === 0) return { status: 'MISSING' };
            return { status: 'AVAILABLE', data: days, revision: null };
        } catch (error: unknown) {
            return {
                status: 'UNAVAILABLE',
                operation: 'read nutrition days',
                retryable: !isPermissionDeniedError(error),
            };
        }
    }

    /** Compatibility wrapper for display callers that intentionally collapse non-available
     * states to an empty list. New code that must distinguish missing from failed reads
     * should use getNutritionDaysState. */
    async getNutritionDays(
        userId: string,
        startDateInclusive: string,
        endDateInclusive: string,
    ): Promise<NutritionDay[]> {
        const state = await this.getNutritionDaysState(userId, startDateInclusive, endDateInclusive);
        return state.status === 'AVAILABLE' ? state.data : [];
    }

    subscribeToNutritionDays(
        userId: string,
        startDateInclusive: string,
        endDateInclusive: string,
        onUpdate: (days: NutritionDay[]) => void,
        onError?: (err: Error) => void,
    ): () => void {
        if (!userId) {
            onUpdate([]);
            return () => {};
        }

        const collRef = collection(getDb(), 'users', userId, 'nutrition_days');
        const q = query(
            collRef,
            where('logicalDate', '>=', startDateInclusive),
            where('logicalDate', '<=', endDateInclusive),
            orderBy('logicalDate', 'asc'),
        );

        return onSnapshot(
            q,
            (snapshot) => {
                const days: NutritionDay[] = [];
                for (const docSnap of snapshot.docs) {
                    const data = docSnap.data();
                    if (data) {
                        const mapped = mapNutritionDocToNutritionDay(data);
                        if (mapped.date) {
                            days.push(mapped);
                        }
                    }
                }
                onUpdate(days);
            },
            (err) => {
                console.error('[NutritionService] Snapshot listener error:', err);
                if (onError) onError(err);
            },
        );
    }
}

export const nutritionService = new NutritionService();
