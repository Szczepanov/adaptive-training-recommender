import type { DailySubjectiveCheckin, RedFlagFinding } from '../../ledger/models';

/**
 * Identifies active clinical red-flag findings that require medical evaluation
 * and prohibit automated training prescriptions (Hainline 2017, Herring 2024).
 */
export function resolveRedFlagFindings(
    checkin: DailySubjectiveCheckin | null | undefined,
): RedFlagFinding[] {
    if (!checkin) return [];
    const findings: RedFlagFinding[] = [];

    // 1. Explicit check-in red flags
    if (checkin.redFlags?.present && checkin.redFlags.categories) {
        for (const category of checkin.redFlags.categories) {
            findings.push({
                category,
                source: 'explicit_checkin',
                description: `Athlete reported red-flag symptom: ${category.replace(/_/g, ' ')}.`,
            });
        }
    }

    // 2. Implicit systemic red flags: severe fever/chills presentation
    const symptoms = checkin.healthContext?.symptoms;
    if (
        symptoms?.present
        && symptoms.severity === 'severe'
        && symptoms.types?.includes('fever_or_chills')
    ) {
        if (!findings.some((f) => f.category === 'systemic_infection')) {
            findings.push({
                category: 'systemic_infection',
                source: 'severe_systemic_symptoms',
                description: 'Severe fever or chills reported in health symptoms.',
            });
        }
    }

    return findings;
}
