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

/** Runtime guard for Firestore objects before any domain casts are applied. */
function isObject(val: unknown): val is Record<string, unknown> {
    return typeof val === 'object' && val !== null && !Array.isArray(val);
}

/** Accepts an omitted/null numeric observation or a finite non-negative value. */
function isNullableNonNegativeNumber(val: unknown): boolean {
    return val === null || val === undefined || (typeof val === 'number' && Number.isFinite(val) && val >= 0);
}

/** Source identifiers are required to be real non-empty strings when persisted. */
function isNonEmptyString(val: unknown): val is string {
    return typeof val === 'string' && val.trim().length > 0;
}

/**
 * Validates and parses a raw Firestore nutrition document into a typed NutritionDay.
 * The persisted DTO is schema v1; malformed or contradictory compatibility fields fail
 * closed as INVALID rather than being coerced into "unknown" provenance or empty values.
 */
export function parseNutritionDayDoc(
    raw: unknown,
    documentPath: string,
): DataState<NutritionDay> {
    if (!isObject(raw)) {
        return { status: 'INVALID', issues: [{ code: 'not-an-object', documentPath }] };
    }

    const issues: DataIssue[] = [];

    // The backend NutritionDayDTO currently persists schemaVersion=1 only.
    if (raw.schemaVersion !== undefined && raw.schemaVersion !== 1) {
        issues.push({
            code: 'unsupported-schema-version',
            field: 'schemaVersion',
            documentPath,
            ...(typeof raw.schemaVersion === 'number' ? { schemaVersion: raw.schemaVersion } : {}),
        });
    }

    // Both shapes are supported for compatibility, but if both are present they must agree.
    const logicalDate = raw.logicalDate;
    const compatibilityDate = raw.date;
    if (
        logicalDate !== undefined &&
        (typeof logicalDate !== 'string' || !isValidDate(logicalDate))
    ) {
        issues.push({ code: 'invalid-date', field: 'logicalDate', documentPath });
    }
    if (
        compatibilityDate !== undefined &&
        (typeof compatibilityDate !== 'string' || !isValidDate(compatibilityDate))
    ) {
        issues.push({ code: 'invalid-date', field: 'date', documentPath });
    }
    if (logicalDate === undefined && compatibilityDate === undefined) {
        issues.push({ code: 'invalid-date', field: 'date', documentPath });
    }
    if (
        typeof logicalDate === 'string' &&
        typeof compatibilityDate === 'string' &&
        logicalDate !== compatibilityDate
    ) {
        issues.push({ code: 'conflicting-date-fields', field: 'date', documentPath });
    }

    const source =
        raw.source === undefined || raw.source === null
            ? null
            : isObject(raw.source)
              ? raw.source
              : null;
    if (raw.source !== undefined && raw.source !== null && source === null) {
        issues.push({ code: 'invalid-type', field: 'source', documentPath });
    }

    const topProvider = raw.provider;
    const nestedProvider = source?.provider;
    const topTransport = raw.transport;
    const nestedTransport = source?.transport;

    if (topProvider !== undefined && !isNonEmptyString(topProvider)) {
        issues.push({ code: 'invalid-type', field: 'provider', documentPath });
    }
    if (nestedProvider !== undefined && !isNonEmptyString(nestedProvider)) {
        issues.push({ code: 'invalid-type', field: 'source.provider', documentPath });
    }
    if (topTransport !== undefined && !isNonEmptyString(topTransport)) {
        issues.push({ code: 'invalid-type', field: 'transport', documentPath });
    }
    if (nestedTransport !== undefined && !isNonEmptyString(nestedTransport)) {
        issues.push({ code: 'invalid-type', field: 'source.transport', documentPath });
    }

    const resolvedProvider = isNonEmptyString(topProvider)
        ? topProvider
        : isNonEmptyString(nestedProvider)
          ? nestedProvider
          : null;
    const resolvedTransport = isNonEmptyString(topTransport)
        ? topTransport
        : isNonEmptyString(nestedTransport)
          ? nestedTransport
          : null;

    if (!resolvedProvider) {
        issues.push({ code: 'missing-provenance', field: 'provider', documentPath });
    }
    if (!resolvedTransport) {
        issues.push({ code: 'missing-provenance', field: 'transport', documentPath });
    }
    if (
        isNonEmptyString(topProvider) &&
        isNonEmptyString(nestedProvider) &&
        topProvider !== nestedProvider
    ) {
        issues.push({ code: 'conflicting-provenance', field: 'provider', documentPath });
    }
    if (
        isNonEmptyString(topTransport) &&
        isNonEmptyString(nestedTransport) &&
        topTransport !== nestedTransport
    ) {
        issues.push({ code: 'conflicting-provenance', field: 'transport', documentPath });
    }

    for (const [field, value] of [
        ['origin', raw.origin],
        ['source.origin', source?.origin],
    ] as const) {
        if (value !== undefined && value !== null && typeof value !== 'string') {
            issues.push({ code: 'invalid-type', field, documentPath });
        }
    }

    const topOrigin = raw.origin;
    const nestedOrigin = source?.origin;
    if (
        topOrigin !== undefined &&
        nestedOrigin !== undefined &&
        topOrigin !== nestedOrigin
    ) {
        issues.push({ code: 'conflicting-provenance', field: 'origin', documentPath });
    }

    for (const [field, value] of [
        ['energyIntakeKcal', raw.energyIntakeKcal],
        ['goalEnergyIntakeKcal', raw.goalEnergyIntakeKcal],
        ['proteinG', raw.proteinG],
        ['carbohydrateG', raw.carbohydrateG],
        ['fatG', raw.fatG],
        ['fiberG', raw.fiberG],
        ['sugarG', raw.sugarG],
        ['sodiumMg', raw.sodiumMg],
        ['potassiumMg', raw.potassiumMg],
        ['waterMl', raw.waterMl],
    ] as const) {
        if (!isNullableNonNegativeNumber(value)) {
            issues.push({ code: 'invalid-numeric-field', field, documentPath });
        }
    }

    if (raw.hasIntakeData !== undefined && typeof raw.hasIntakeData !== 'boolean') {
        issues.push({ code: 'invalid-type', field: 'hasIntakeData', documentPath });
    }
    if (raw.isPartial !== undefined && typeof raw.isPartial !== 'boolean') {
        issues.push({ code: 'invalid-type', field: 'isPartial', documentPath });
    }
    if (raw.isPartialDay !== undefined && typeof raw.isPartialDay !== 'boolean') {
        issues.push({ code: 'invalid-type', field: 'isPartialDay', documentPath });
    }

    if (
        raw.confidenceScore !== undefined &&
        (typeof raw.confidenceScore !== 'number' ||
            !Number.isFinite(raw.confidenceScore) ||
            raw.confidenceScore < 0 ||
            raw.confidenceScore > 1)
    ) {
        issues.push({ code: 'invalid-numeric-field', field: 'confidenceScore', documentPath });
    }

    if (
        raw.revision !== undefined &&
        (typeof raw.revision !== 'number' || !Number.isInteger(raw.revision) || raw.revision < 1)
    ) {
        issues.push({ code: 'invalid-numeric-field', field: 'revision', documentPath });
    }

    if (raw.userId !== undefined && !isNonEmptyString(raw.userId)) {
        issues.push({ code: 'invalid-type', field: 'userId', documentPath });
    }
    for (const [field, value] of [
        ['loggedAt', raw.loggedAt],
        ['ingestedAt', raw.ingestedAt],
        ['syncedAt', raw.syncedAt],
        ['rawPayloadHash', raw.rawPayloadHash],
    ] as const) {
        if (value !== undefined && value !== null && typeof value !== 'string') {
            issues.push({ code: 'invalid-type', field, documentPath });
        }
    }

    if (raw.energyExpenditureKcal !== undefined && raw.energyExpenditureKcal !== null) {
        if (!isObject(raw.energyExpenditureKcal)) {
            issues.push({ code: 'invalid-type', field: 'energyExpenditureKcal', documentPath });
        } else {
            const exp = raw.energyExpenditureKcal;
            for (const key of ['resting', 'active', 'total'] as const) {
                if (!isNullableNonNegativeNumber(exp[key])) {
                    issues.push({
                        code: 'invalid-numeric-field',
                        field: `energyExpenditureKcal.${key}`,
                        documentPath,
                    });
                }
            }
        }
    }

    if (raw.macronutrients !== undefined && raw.macronutrients !== null) {
        if (!isObject(raw.macronutrients)) {
            issues.push({ code: 'invalid-type', field: 'macronutrients', documentPath });
        } else {
            const macros = raw.macronutrients;
            for (const key of ['proteinGrams', 'carbsGrams', 'fatGrams', 'fiberGrams'] as const) {
                if (!isNullableNonNegativeNumber(macros[key])) {
                    issues.push({
                        code: 'invalid-numeric-field',
                        field: `macronutrients.${key}`,
                        documentPath,
                    });
                }
            }
        }
    }

    if (raw.micronutrients !== undefined && raw.micronutrients !== null) {
        if (!isObject(raw.micronutrients)) {
            issues.push({ code: 'invalid-type', field: 'micronutrients', documentPath });
        } else {
            const micros = raw.micronutrients;
            for (const key of ['sodiumMg', 'potassiumMg', 'waterMl'] as const) {
                if (!isNullableNonNegativeNumber(micros[key])) {
                    issues.push({
                        code: 'invalid-numeric-field',
                        field: `micronutrients.${key}`,
                        documentPath,
                    });
                }
            }
        }
    }

    if (issues.length > 0) {
        return { status: 'INVALID', issues };
    }

    return {
        status: 'AVAILABLE',
        data: mapNutritionDocToNutritionDay(raw),
        revision:
            typeof raw.rawPayloadHash === 'string'
                ? raw.rawPayloadHash
                : typeof raw.revision === 'number'
                  ? String(raw.revision)
                  : null,
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

        const rangePath = `users/${userId}/nutrition_days`;
        if (
            !isValidDate(startDateInclusive) ||
            !isValidDate(endDateInclusive) ||
            startDateInclusive > endDateInclusive
        ) {
            return {
                status: 'INVALID',
                issues: [{ code: 'invalid-date-range', documentPath: rangePath, field: 'date' }],
            };
        }

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
                const issues: DataIssue[] = [];
                for (const docSnap of snapshot.docs) {
                    const data = docSnap.data();
                    const docPath = `users/${userId}/nutrition_days/${docSnap.id}`;
                    const parsed = parseNutritionDayDoc(data, docPath);
                    if (parsed.status === 'AVAILABLE') {
                        days.push(parsed.data);
                    } else if (parsed.status === 'INVALID') {
                        issues.push(...parsed.issues);
                    }
                }

                if (issues.length > 0) {
                    // Never collapse malformed persisted rows into an apparently empty/partial history.
                    console.error('[NutritionService] Snapshot contains invalid persisted nutrition data.');
                    onError?.(new Error('Invalid persisted nutrition data'));
                    return;
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
