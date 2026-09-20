/**
 * Domain models for user nutrition and dietary energy intake.
 *
 * ADR-0042: Nutrition data is observation-only; it MUST NEVER leak into
 * training recommendation rules or exercise readiness calculations.
 */

export interface NutritionSource {
    provider: string; // e.g. "garmin"
    transport: string; // e.g. "garmin_connect"
    origin: string | null; // upstream logging app; null when the provider does not certify it
}

export interface EnergyExpenditureBreakdown {
    resting?: number | null;
    active?: number | null;
    total?: number | null;
}

export interface MacronutrientBreakdown {
    proteinGrams?: number | null;
    carbsGrams?: number | null;
    fatGrams?: number | null;
    fiberGrams?: number | null;
}

export interface MicronutrientBreakdown {
    sodiumMg?: number | null;
    potassiumMg?: number | null;
    waterMl?: number | null;
    [key: string]: number | null | undefined;
}

export interface NutritionDay {
    schemaVersion: number;
    date: string; // YYYY-MM-DD
    source: NutritionSource;
    loggedAt?: string | null;
    syncedAt: string;
    energyIntakeKcal?: number | null;
    /** Explicit provider logging-status flag; preserves logged-zero vs unlogged semantics. */
    hasIntakeData?: boolean;
    energyExpenditureKcal?: EnergyExpenditureBreakdown | null;
    macronutrients?: MacronutrientBreakdown | null;
    micronutrients?: MicronutrientBreakdown | null;
    isPartialDay?: boolean;
    confidenceScore?: number;
    rawPayloadHash?: string | null;
}

export interface ReconciledNutritionDay {
    date: string;
    energyIntakeKcal: number | null;
    energyExpenditureKcal: {
        resting: number | null;
        active: number | null;
        total: number | null;
    } | null;
    macronutrients: {
        proteinGrams: number | null;
        carbsGrams: number | null;
        fatGrams: number | null;
        fiberGrams: number | null;
    };
    sources: NutritionSource[];
    primaryIntakeSource: NutritionSource | null;
    isPartialDay: boolean;
    hasIntakeData: boolean;
    hasExpenditureData: boolean;
}
