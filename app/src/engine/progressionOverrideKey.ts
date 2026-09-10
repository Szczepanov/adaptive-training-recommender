/**
 * Shared key format for a confirmed `IntentBlock` progression's per-workout duration
 * override (ADR-0037 D-DOSE). Pulled into its own file, rather than living in either
 * `confirmedProgressionOverrides.ts` or `weeklyDosePacking.ts`, because both of those
 * modules need it and each already imports from the other (`confirmedProgressionOverrides.ts`
 * reads `EVERGREEN_PACKING_COVERAGE` from `weeklyDosePacking.ts`) -- a third, dependency-free
 * file avoids the cycle.
 */
export function progressionOverrideKey(coverageRoleId: string, workoutId: string): string {
    return `${coverageRoleId}::${workoutId}`;
}
