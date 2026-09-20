/**
 * Pure reconciliation logic for daily nutrition observations.
 *
 * ADR-0042:
 * - Multi-source deduplication prevents double counting identical food logs
 *   relayed via different transports (e.g. MyFitnessPal via Garmin vs via Health Connect).
 * - Distinguishes missing values (null) from true zeros (0g).
 * - Distinguishes dietary energy intake from physical energy expenditure.
 */

import type { NutritionDay, NutritionSource, ReconciledNutritionDay } from './models';

/**
 * Priority order for transports when deduplicating records sharing the same origin.
 * Direct integrations have highest fidelity, followed by health platforms, then wearable mirrors.
 */
const TRANSPORT_PRIORITY: Record<string, number> = {
    direct_api: 100,
    health_connect: 80,
    google_health: 70,
    apple_health: 70,
    garmin_connect: 50,
};

function getTransportPriority(transport: string): number {
    return TRANSPORT_PRIORITY[transport.toLowerCase()] ?? 10;
}

function macroCompleteness(record: NutritionDay): number {
    const macros = record.macronutrients;
    if (!macros) return 0;
    return [macros.proteinGrams, macros.carbsGrams, macros.fatGrams, macros.fiberGrams].filter(
        (value) => value !== null && value !== undefined,
    ).length;
}

function hasIntakeObservation(record: NutritionDay): boolean {
    if (record.hasIntakeData !== undefined) {
        return record.hasIntakeData;
    }
    return record.energyIntakeKcal !== null && record.energyIntakeKcal !== undefined;
}

/**
 * Highest-fidelity first: macro completeness, an actual energy value, transport
 * fidelity, confidence, then newest sync as a deterministic tie-breaker.
 */
function compareRecordFidelity(a: NutritionDay, b: NutritionDay): number {
    const macroDelta = macroCompleteness(b) - macroCompleteness(a);
    if (macroDelta !== 0) return macroDelta;

    const aHasEnergy = a.energyIntakeKcal != null ? 1 : 0;
    const bHasEnergy = b.energyIntakeKcal != null ? 1 : 0;
    if (aHasEnergy !== bHasEnergy) return bHasEnergy - aHasEnergy;

    const transportDelta = getTransportPriority(b.source.transport) - getTransportPriority(a.source.transport);
    if (transportDelta !== 0) return transportDelta;

    const confidenceDelta = (b.confidenceScore ?? 1.0) - (a.confidenceScore ?? 1.0);
    if (confidenceDelta !== 0) return confidenceDelta;

    return (b.syncedAt || '').localeCompare(a.syncedAt || '');
}

/**
 * Reconciles multiple NutritionDay observations for a single calendar date.
 */
export function reconcileDailyNutrition(records: readonly NutritionDay[]): ReconciledNutritionDay | null {
    if (records.length === 0) {
        return null;
    }

    const date = records[0].date;

    // Known origins can be deduplicated across transports. Unknown origins cannot:
    // provider+transport stays part of the identity so we never assume two mirrors are
    // the same upstream food log without certified provenance.
    const byOrigin = new Map<string, NutritionDay[]>();
    for (const record of records) {
        const normalizedOrigin = record.source.origin?.trim().toLowerCase();
        const provider = record.source.provider.toLowerCase();
        const transport = record.source.transport.toLowerCase();
        const originKey = normalizedOrigin || `unknown_${provider}_${transport}`;
        const group = byOrigin.get(originKey) ?? [];
        group.push(record);
        byOrigin.set(originKey, group);
    }

    const deduplicatedRecords: NutritionDay[] = [];
    for (const candidates of byOrigin.values()) {
        deduplicatedRecords.push([...candidates].sort(compareRecordFidelity)[0]);
    }

    // Distinct known origins are not summed. Until the read model supports displaying
    // each origin side-by-side, select one primary intake deterministically and retain
    // all source identities for transparency.
    const intakeRecords = deduplicatedRecords.filter(hasIntakeObservation);
    const primaryIntakeRecord =
        intakeRecords.length > 0 ? [...intakeRecords].sort(compareRecordFidelity)[0] : null;

    // Expenditure is a separate, non-fungible domain. Select it from all records so
    // choosing a higher-fidelity intake mirror never discards wearable expenditure
    // carried by another record for the same upstream intake origin.
    const expenditureRecords = records.filter(
        (record) =>
            record.energyExpenditureKcal &&
            (record.energyExpenditureKcal.total != null ||
                record.energyExpenditureKcal.resting != null ||
                record.energyExpenditureKcal.active != null),
    );

    let primaryExpenditureRecord: NutritionDay | null = null;
    if (expenditureRecords.length > 0) {
        primaryExpenditureRecord = [...expenditureRecords].sort((a, b) => {
            const confidenceDelta = (b.confidenceScore ?? 1.0) - (a.confidenceScore ?? 1.0);
            if (confidenceDelta !== 0) return confidenceDelta;
            return (b.syncedAt || '').localeCompare(a.syncedAt || '');
        })[0];
    }

    const sources: NutritionSource[] = deduplicatedRecords.map((record) => record.source);
    const hasIntake = primaryIntakeRecord !== null && hasIntakeObservation(primaryIntakeRecord);
    const hasExpenditure =
        primaryExpenditureRecord?.energyExpenditureKcal?.total != null ||
        primaryExpenditureRecord?.energyExpenditureKcal?.resting != null ||
        primaryExpenditureRecord?.energyExpenditureKcal?.active != null;

    const resting = primaryExpenditureRecord?.energyExpenditureKcal?.resting ?? null;
    const active = primaryExpenditureRecord?.energyExpenditureKcal?.active ?? null;
    let total = primaryExpenditureRecord?.energyExpenditureKcal?.total ?? null;

    if (total === null && resting != null && active != null) {
        total = resting + active;
    }

    return {
        date,
        energyIntakeKcal: primaryIntakeRecord?.energyIntakeKcal ?? null,
        energyExpenditureKcal: hasExpenditure
            ? {
                  resting,
                  active,
                  total,
              }
            : null,
        macronutrients: {
            proteinGrams: primaryIntakeRecord?.macronutrients?.proteinGrams ?? null,
            carbsGrams: primaryIntakeRecord?.macronutrients?.carbsGrams ?? null,
            fatGrams: primaryIntakeRecord?.macronutrients?.fatGrams ?? null,
            fiberGrams: primaryIntakeRecord?.macronutrients?.fiberGrams ?? null,
        },
        sources,
        primaryIntakeSource: primaryIntakeRecord?.source ?? null,
        isPartialDay: records.some((record) => record.isPartialDay ?? false),
        hasIntakeData: hasIntake,
        hasExpenditureData: hasExpenditure,
    };
}

/**
 * Groups a collection of raw nutrition days by date and reconciles each day.
 * Returns days sorted ascending by date.
 */
export function reconcileNutritionHistory(records: readonly NutritionDay[]): ReconciledNutritionDay[] {
    const byDate = new Map<string, NutritionDay[]>();

    for (const record of records) {
        const group = byDate.get(record.date) ?? [];
        group.push(record);
        byDate.set(record.date, group);
    }

    const reconciled: ReconciledNutritionDay[] = [];
    const sortedDates = Array.from(byDate.keys()).sort();

    for (const d of sortedDates) {
        const rec = reconcileDailyNutrition(byDate.get(d)!);
        if (rec) {
            reconciled.push(rec);
        }
    }

    return reconciled;
}
