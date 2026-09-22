/**
 * Nutrition data service for querying and subscribing to user-scoped nutrition observations.
 * Path: users/{userId}/nutrition_days/{daySourceId}
 */

import { collection, getDocs, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { getDb } from '../firebase';
import type { NutritionDay } from './models';
import type { DataIssue, DataState } from '../engine/dataState';
import { isValidDate } from '../engine/validation';
import { isPermissionDeniedError } from '../utils/errors';

function isObject(val: unknown): val is Record<string, unknown> {
    return typeof val === 'object' && val !== null && !Array.isArray(val);
}

function isNullableNonNegativeNumber(val: unknown): boolean {
    return val === null || val === undefined || (typeof val === 'number' && Number.isFinite(val) && val >= 0);
}

/**
 * Validates and parses a raw Firestore nutrition document into a typed NutritionDay.
 * Returns INVALID with specific issues when fields have invalid types or date is malformed.
 */
export function parseNutritionDayDoc(
    raw: unknown,
    documentPath: string,
): DataState<NutritionDay> {
    if (!isObject(raw)) {
        return { status: 'INVALID', issues: [{ code: 'not-an-object', documentPath }] };
    }

    const issues: DataIssue[] = [];

    // 1. schemaVersion: optional, but if present must be positive integer
    if (
        raw.schemaVersion !== undefined &&
        (typeof raw.schemaVersion !== 'number' || !Number.isInteger(raw.schemaVersion) || raw.schemaVersion < 1)
    ) {
        issues.push({
            code: 'unsupported-schema-version',
            field: 'schemaVersion',
            documentPath,
            ...(typeof raw.schemaVersion === 'number' ? { schemaVersion: raw.schemaVersion } : {}),
        });
    }

    // 2. Date: logicalDate or date, must be valid YYYY-MM-DD
    const rawDate = raw.logicalDate ?? raw.date;
    if (typeof rawDate !== 'string' || !isValidDate(rawDate)) {
        issues.push({ code: 'invalid-date', field: 'date', documentPath });
    }

    // 3. energyIntakeKcal: must be null, undefined, or non-negative finite number
    if (!isNullableNonNegativeNumber(raw.energyIntakeKcal)) {
        issues.push({ code: 'invalid-numeric-field', field: 'energyIntakeKcal', documentPath });
    }

    // 4. hasIntakeData
    if (raw.hasIntakeData !== undefined && typeof raw.hasIntakeData !== 'boolean') {
        issues.push({ code: 'invalid-type', field: 'hasIntakeData', documentPath });
    }

    // 5. isPartial / isPartialDay
    if (raw.isPartial !== undefined && typeof raw.isPartial !== 'boolean') {
        issues.push({ code: 'invalid-type', field: 'isPartial', documentPath });
    }
    if (raw.isPartialDay !== undefined && typeof raw.isPartialDay !== 'boolean') {
        issues.push({ code: 'invalid-type', field: 'isPartialDay', documentPath });
    }

    // 6. confidenceScore
    if (
        raw.confidenceScore !== undefined &&
        (typeof raw.confidenceScore !== 'number' ||
            !Number.isFinite(raw.confidenceScore) ||
            raw.confidenceScore < 0 ||
            raw.confidenceScore > 1)
    ) {
        issues.push({ code: 'invalid-numeric-field', field: 'confidenceScore', documentPath });
    }

    // 7. source: if present, validate object and string fields
    if (raw.source !== undefined && raw.source !== null) {
        if (!isObject(raw.source)) {
            issues.push({ code: 'invalid-type', field: 'source', documentPath });
        } else {
            if (raw.source.provider !== undefined && typeof raw.source.provider !== 'string') {
                issues.push({ code: 'invalid-type', field: 'source.provider', documentPath });
            }
            if (raw.source.transport !== undefined && typeof raw.source.transport !== 'string') {
                issues.push({ code: 'invalid-type', field: 'source.transport', documentPath });
            }
            if (
                raw.source.origin !== undefined &&
                raw.source.origin !== null &&
                typeof raw.source.origin !== 'string'
            ) {
                issues.push({ code: 'invalid-type', field: 'source.origin', documentPath });
            }
        }
    }
    if (raw.provider !== undefined && typeof raw.provider !== 'string') {
        issues.push({ code: 'invalid-type', field: 'provider', documentPath });
    }
    if (raw.transport !== undefined && typeof raw.transport !== 'string') {
        issues.push({ code: 'invalid-type', field: 'transport', documentPath });
    }

    // 8. energyExpenditureKcal
    if (raw.energyExpenditureKcal !== undefined && raw.energyExpenditureKcal !== null) {
        if (!isObject(raw.energyExpenditureKcal)) {
            issues.push({ code: 'invalid-type', field: 'energyExpenditureKcal', documentPath });
        } else {
            const exp = raw.energyExpenditureKcal as Record<string, unknown>;
            if (!isNullableNonNegativeNumber(exp.resting)) {
                issues.push({ code: 'invalid-numeric-field', field: 'energyExpenditureKcal.resting', documentPath });
            }
            if (!isNullableNonNegativeNumber(exp.active)) {
                issues.push({ code: 'invalid-numeric-field', field: 'energyExpenditureKcal.active', documentPath });
            }
            if (!isNullableNonNegativeNumber(exp.total)) {
                issues.push({ code: 'invalid-numeric-field', field: 'energyExpenditureKcal.total', documentPath });
            }
        }
    }

    // 9. Flat and nested macronutrients
    const flatMacros = [
        { key: 'proteinG', val: raw.proteinG },
        { key: 'carbohydrateG', val: raw.carbohydrateG },
        { key: 'fatG', val: raw.fatG },
        { key: 'fiberG', val: raw.fiberG },
    ];
    for (const { key, val } of flatMacros) {
        if (!isNullableNonNegativeNumber(val)) {
            issues.push({ code: 'invalid-numeric-field', field: key, documentPath });
        }
    }
    if (raw.macronutrients !== undefined && raw.macronutrients !== null) {
        if (!isObject(raw.macronutrients)) {
            issues.push({ code: 'invalid-type', field: 'macronutrients', documentPath });
        } else {
            const macros = raw.macronutrients as Record<string, unknown>;
            if (!isNullableNonNegativeNumber(macros.proteinGrams)) {
                issues.push({ code: 'invalid-numeric-field', field: 'macronutrients.proteinGrams', documentPath });
            }
            if (!isNullableNonNegativeNumber(macros.carbsGrams)) {
                issues.push({ code: 'invalid-numeric-field', field: 'macronutrients.carbsGrams', documentPath });
            }
            if (!isNullableNonNegativeNumber(macros.fatGrams)) {
                issues.push({ code: 'invalid-numeric-field', field: 'macronutrients.fatGrams', documentPath });
            }
            if (!isNullableNonNegativeNumber(macros.fiberGrams)) {
                issues.push({ code: 'invalid-numeric-field', field: 'macronutrients.fiberGrams', documentPath });
            }
        }
    }

    // 10. Flat and nested micronutrients
    const flatMicros = [
        { key: 'sodiumMg', val: raw.sodiumMg },
        { key: 'potassiumMg', val: raw.potassiumMg },
        { key: 'waterMl', val: raw.waterMl },
    ];
    for (const { key, val } of flatMicros) {
        if (!isNullableNonNegativeNumber(val)) {
            issues.push({ code: 'invalid-numeric-field', field: key, documentPath });
        }
    }
    if (raw.micronutrients !== undefined && raw.micronutrients !== null) {
        if (!isObject(raw.micronutrients)) {
            issues.push({ code: 'invalid-type', field: 'micronutrients', documentPath });
        } else {
            const micros = raw.micronutrients as Record<string, unknown>;
            if (!isNullableNonNegativeNumber(micros.sodiumMg)) {
                issues.push({ code: 'invalid-numeric-field', field: 'micronutrients.sodiumMg', documentPath });
            }
            if (!isNullableNonNegativeNumber(micros.potassiumMg)) {
                issues.push({ code: 'invalid-numeric-field', field: 'micronutrients.potassiumMg', documentPath });
            }
            if (!isNullableNonNegativeNumber(micros.waterMl)) {
                issues.push({ code: 'invalid-numeric-field', field: 'micronutrients.waterMl', documentPath });
            }
        }
    }

    if (issues.length > 0) {
        return { status: 'INVALID', issues };
    }

    return {
        status: 'AVAILABLE',
        data: mapNutritionDocToNutritionDay(raw),
        revision: typeof raw.rawPayloadHash === 'string' ? raw.rawPayloadHash : null,
    };
}

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
            const issues: DataIssue[] = [];
            for (const docSnap of snapshot.docs) {
                const data = docSnap.data();
                const docPath = `users/${userId}/nutrition_days/${docSnap.id}`;
                const parsed = parseNutritionDayDoc(data, docPath);
                if (parsed.status === 'AVAILABLE') {
                    if (parsed.data.date < startDateInclusive || parsed.data.date > endDateInclusive) {
                        issues.push({ code: 'row-outside-requested-range', documentPath: docPath, field: 'date' });
                        continue;
                    }
                    days.push(parsed.data);
                } else if (parsed.status === 'INVALID') {
                    issues.push(...parsed.issues);
                }
            }

            if (issues.length > 0) return { status: 'INVALID', issues };
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
                    const docPath = `users/${userId}/nutrition_days/${docSnap.id}`;
                    const parsed = parseNutritionDayDoc(data, docPath);
                    if (parsed.status === 'AVAILABLE') {
                        days.push(parsed.data);
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
