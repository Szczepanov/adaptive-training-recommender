import type { AgreementClass } from './shadowAgreement';
import type { ShadowLogRow } from './shadowLog';

/** The prospective-evidence gates are deliberately constants of the Phase 9.0 readout,
 * not recommendation policy. They describe when a human may interpret a shadow block. */
export const SHADOW_BLOCK_GATES = {
    pairedVerdictDays: 28,
    completeSubjectiveCheckins: 21,
    unanchoredDays: 7,
} as const;

export interface ShadowAgreementCounts {
    comparedDays: number;
    agree: number;
    engineMoreConservative: number;
    engineLessConservative: number;
    incomparable: number;
}

export interface ShadowEvidenceGate {
    required: number;
    observed: number;
    met: boolean;
}

export interface ShadowPolicySegment {
    policyVersion: string;
    startDate: string;
    endDate: string;
    calendarDays: number;
    pairedVerdictDays: number;
    agreement: ShadowAgreementCounts;
}

export interface ShadowReadout {
    /** Distinct dates supplied to the export. Duplicate rows are never allowed to inflate
     * a prospective-evidence gate and remain visible in `dataQuality`. */
    calendarDays: number;
    gates: {
        pairedVerdictDays: ShadowEvidenceGate;
        completeSubjectiveCheckins: ShadowEvidenceGate;
        unanchoredDays: ShadowEvidenceGate;
        /** Stronger diagnostic than the formal unanchored gate: a blind day that also
         * has both verdicts, and can therefore contribute to blind agreement. */
        unanchoredPairedVerdictDays: number;
    };
    agreement: ShadowAgreementCounts;
    anchoredAgreement: ShadowAgreementCounts;
    unanchoredAgreement: ShadowAgreementCounts;
    stablePolicySegments: ShadowPolicySegment[];
    dataQuality: {
        duplicateRows: number;
        emptyEvidenceDays: number;
        missingRecommendationDays: number;
        missingExternalVerdictDays: number;
        missingSubjectiveCheckinDays: number;
        incompleteSubjectiveCheckinDays: number;
        missingRecoverySnapshotDays: number;
        missingPolicyVersionDays: number;
    };
}

function emptyAgreementCounts(): ShadowAgreementCounts {
    return {
        comparedDays: 0,
        agree: 0,
        engineMoreConservative: 0,
        engineLessConservative: 0,
        incomparable: 0,
    };
}

function addAgreement(counts: ShadowAgreementCounts, agreement: AgreementClass | null): void {
    if (agreement === null) return;
    counts.comparedDays += 1;
    if (agreement === 'agree') counts.agree += 1;
    else if (agreement === 'engine_more_conservative') counts.engineMoreConservative += 1;
    else if (agreement === 'engine_less_conservative') counts.engineLessConservative += 1;
    else counts.incomparable += 1;
}

function isConsecutiveDate(previous: string, next: string): boolean {
    const parse = (date: string): number | null => {
        const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
        if (!match) return null;
        const timestamp = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
        return Number.isNaN(timestamp) ? null : timestamp / 86_400_000;
    };
    const previousDay = parse(previous);
    const nextDay = parse(next);
    return previousDay !== null && nextDay !== null && nextDay === previousDay + 1;
}

function buildStablePolicySegments(rows: readonly ShadowLogRow[]): ShadowPolicySegment[] {
    const segments: ShadowPolicySegment[] = [];
    let active: ShadowPolicySegment | null = null;

    for (const row of rows) {
        // An absent policy version is a data-quality gap. It deliberately breaks a
        // segment, because joining records across it could hide a decision-policy change.
        if (row.policyVersion === null) {
            active = null;
            continue;
        }

        const continuesActive = active !== null
            && active.policyVersion === row.policyVersion
            && isConsecutiveDate(active.endDate, row.date);
        if (!continuesActive) {
            active = {
                policyVersion: row.policyVersion,
                startDate: row.date,
                endDate: row.date,
                calendarDays: 0,
                pairedVerdictDays: 0,
                agreement: emptyAgreementCounts(),
            };
            segments.push(active);
        }

        // `active` is assigned above whenever it was absent or could not continue.
        // Keep the defensive guard explicit for TypeScript and for any future refactor of
        // the segment-creation branch.
        if (active === null) continue;
        active.calendarDays += 1;
        active.endDate = row.date;
        if (row.engineVerdict !== null && row.externalVerdict !== null) {
            active.pairedVerdictDays += 1;
        }
        addAgreement(active.agreement, row.agreement);
    }

    return segments;
}

/**
 * Produces the aggregate, evidence-only 9.0.8 readout. It does not select a verdict,
 * infer an athlete action, or inspect any free text. In particular, policy segments only
 * combine consecutive calendar days with the same explicit `policyVersion`; a missing
 * version or date gap starts a new segment rather than manufacturing stability.
 */
export function summarizeShadowLog(rows: readonly ShadowLogRow[]): ShadowReadout {
    const rowsByDate = new Map<string, ShadowLogRow>();
    let duplicateRows = 0;
    for (const row of rows) {
        if (rowsByDate.has(row.date)) {
            duplicateRows += 1;
            continue;
        }
        rowsByDate.set(row.date, row);
    }
    const uniqueRows = [...rowsByDate.values()].sort((left, right) => left.date.localeCompare(right.date));

    const agreement = emptyAgreementCounts();
    const anchoredAgreement = emptyAgreementCounts();
    const unanchoredAgreement = emptyAgreementCounts();
    let pairedVerdictDays = 0;
    let completeSubjectiveCheckins = 0;
    let unanchoredDays = 0;
    let unanchoredPairedVerdictDays = 0;
    let emptyEvidenceDays = 0;
    let missingRecommendationDays = 0;
    let missingExternalVerdictDays = 0;
    let missingSubjectiveCheckinDays = 0;
    let incompleteSubjectiveCheckinDays = 0;
    let missingRecoverySnapshotDays = 0;
    let missingPolicyVersionDays = 0;

    for (const row of uniqueRows) {
        const hasRecommendation = row.engineVerdict !== null;
        const hasExternalVerdict = row.externalVerdict !== null;
        const hasSubjectiveCheckin = row.subjective !== null;
        const hasRecoverySnapshot = row.objective !== null;
        if (!hasRecommendation && !hasExternalVerdict && !hasSubjectiveCheckin && !hasRecoverySnapshot) {
            emptyEvidenceDays += 1;
        }
        if (!hasRecommendation) missingRecommendationDays += 1;
        if (!hasExternalVerdict) missingExternalVerdictDays += 1;
        if (!hasSubjectiveCheckin) missingSubjectiveCheckinDays += 1;
        else if (row.subjectiveComplete === false) incompleteSubjectiveCheckinDays += 1;
        if (!hasRecoverySnapshot) missingRecoverySnapshotDays += 1;
        if (hasRecommendation && row.policyVersion === null) missingPolicyVersionDays += 1;

        const pairedVerdicts = hasRecommendation && hasExternalVerdict;
        if (pairedVerdicts) {
            pairedVerdictDays += 1;
            addAgreement(agreement, row.agreement);
        }
        if (row.subjectiveComplete === true) completeSubjectiveCheckins += 1;
        if (row.sawEngineVerdictFirst === false) {
            unanchoredDays += 1;
            if (pairedVerdicts) unanchoredPairedVerdictDays += 1;
        }
        if (pairedVerdicts && row.sawEngineVerdictFirst === true) addAgreement(anchoredAgreement, row.agreement);
        if (pairedVerdicts && row.sawEngineVerdictFirst === false) addAgreement(unanchoredAgreement, row.agreement);
    }

    return {
        calendarDays: uniqueRows.length,
        gates: {
            pairedVerdictDays: {
                required: SHADOW_BLOCK_GATES.pairedVerdictDays,
                observed: pairedVerdictDays,
                met: pairedVerdictDays >= SHADOW_BLOCK_GATES.pairedVerdictDays,
            },
            completeSubjectiveCheckins: {
                required: SHADOW_BLOCK_GATES.completeSubjectiveCheckins,
                observed: completeSubjectiveCheckins,
                met: completeSubjectiveCheckins >= SHADOW_BLOCK_GATES.completeSubjectiveCheckins,
            },
            unanchoredDays: {
                required: SHADOW_BLOCK_GATES.unanchoredDays,
                observed: unanchoredDays,
                met: unanchoredDays >= SHADOW_BLOCK_GATES.unanchoredDays,
            },
            unanchoredPairedVerdictDays,
        },
        agreement,
        anchoredAgreement,
        unanchoredAgreement,
        stablePolicySegments: buildStablePolicySegments(uniqueRows),
        dataQuality: {
            duplicateRows,
            emptyEvidenceDays,
            missingRecommendationDays,
            missingExternalVerdictDays,
            missingSubjectiveCheckinDays,
            incompleteSubjectiveCheckinDays,
            missingRecoverySnapshotDays,
            missingPolicyVersionDays,
        },
    };
}
