/**
 * Athlete preference storage for body-mass source selection.
 * Governed by ADR-0039 D-BC-WEIGHT.
 */

export const BODY_MASS_SOURCE_STORAGE_KEY = 'adaptive-training:body-mass:preferred-source';

export function loadStoredBodyMassSource(): 'provider' | 'manual' | null {
    if (typeof window === 'undefined') return null;
    try {
        const val = window.localStorage.getItem(BODY_MASS_SOURCE_STORAGE_KEY);
        return val === 'provider' || val === 'manual' ? val : null;
    } catch {
        return null;
    }
}

export function persistBodyMassSource(source: 'provider' | 'manual'): void {
    if (typeof window === 'undefined') return;
    try {
        window.localStorage.setItem(BODY_MASS_SOURCE_STORAGE_KEY, source);
    } catch {
        // Ignore storage errors
    }
}

/**
 * Resolves the effective body-mass source without silently switching away from an
 * explicit athlete choice. When no choice exists, preserve ADR-0039 provider-first
 * behavior but fall back to manual only when no usable provider series is present.
 */
export function chooseEffectiveBodyMassSource(
    storedPreference: 'provider' | 'manual' | null,
    hasProviderSeries: boolean,
    hasManualSeries: boolean,
): 'provider' | 'manual' {
    if (storedPreference) return storedPreference;
    if (hasProviderSeries) return 'provider';
    if (hasManualSeries) return 'manual';
    return 'provider';
}
