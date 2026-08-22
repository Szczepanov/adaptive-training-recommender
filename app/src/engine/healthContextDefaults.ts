import type { HealthContextCheckin } from './healthAnomalyModels';

/**
 * Canonical defaults for a newly reported health-context block. Historical check-ins that
 * have no healthContext at all stay historically absent; callers opt into these defaults
 * only when creating or normalizing an actual block.
 */
export function createDefaultHealthContext(symptomsPresent = false): HealthContextCheckin {
    return {
        alcoholDrinksLast24h: 0,
        travelDisruption: 'none',
        unusualHeatOrSauna: false,
        dehydrationOrFluidLoss: false,
        recentVaccination: false,
        medicationChange: false,
        closeSickContact: false,
        symptoms: { present: symptomsPresent },
    };
}

/**
 * Normalize an existing/supplied context onto the product defaults. Legacy null/omitted
 * yes/no values become explicit false only once a health-context block exists.
 */
export function normalizeHealthContext(
    value: HealthContextCheckin | undefined,
    symptomsPresent = value?.symptoms?.present ?? false,
): HealthContextCheckin {
    const defaults = createDefaultHealthContext(symptomsPresent);
    return {
        ...defaults,
        ...value,
        unusualHeatOrSauna: value?.unusualHeatOrSauna === true,
        dehydrationOrFluidLoss: value?.dehydrationOrFluidLoss === true,
        recentVaccination: value?.recentVaccination === true,
        medicationChange: value?.medicationChange === true,
        closeSickContact: value?.closeSickContact === true,
        symptoms: value?.symptoms
            ? { ...value.symptoms, present: symptomsPresent }
            : { present: symptomsPresent },
    };
}
