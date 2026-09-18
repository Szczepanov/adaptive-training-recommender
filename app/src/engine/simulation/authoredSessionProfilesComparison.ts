import type { GateableSession } from '../eligibility';
import { toGateableSession } from '../externalSessionProfiles';
import { deriveAuthoredSessionEligibility, type AuthoredSessionEligibilityCandidate } from '../authoredSessionProfiles';
import type { AnyExternalPlanSession } from '../../sessions/externalPlanAny';

/**
 * M8.1 comparison report: `authoredSessionProfiles.ts`'s step-derived candidate against
 * today's production `externalSessionProfiles.ts` adapter, over a sample of sessions. Mirrors
 * `subjectiveDriftComparison.ts`'s shape (pure function -> structured report, explicit scope
 * and limitations, no wiring into production). This is measurement evidence for M8.3, not a
 * ship decision -- `runAuthoredSessionProfilesComparison` is never called from a production
 * selection path.
 */

export type AuthoredSessionProfilesDiscrepancyField = 'safetyTags' | 'category' | 'durationMin' | 'durationMax' | 'modality';

export interface AuthoredSessionProfilesDiscrepancy {
    field: AuthoredSessionProfilesDiscrepancyField;
    current: unknown;
    candidate: unknown;
}

export interface AuthoredSessionProfilesComparisonRow {
    sessionId: string;
    current: GateableSession;
    candidate: AuthoredSessionEligibilityCandidate;
    discrepancies: AuthoredSessionProfilesDiscrepancy[];
}

export interface AuthoredSessionProfilesComparisonReport {
    rows: AuthoredSessionProfilesComparisonRow[];
    scope: 'eligibility-safety-tags-only';
    limitations: string[];
}

function sortedTags(tags: readonly GateableSession['safetyTags'][number][]): string[] {
    return [...tags].sort();
}

function tagsEqual(a: GateableSession['safetyTags'], b: GateableSession['safetyTags']): boolean {
    const left = sortedTags(a);
    const right = sortedTags(b);
    return left.length === right.length && left.every((tag, index) => tag === right[index]);
}

function diffRow(current: GateableSession, candidate: AuthoredSessionEligibilityCandidate): AuthoredSessionProfilesDiscrepancy[] {
    const discrepancies: AuthoredSessionProfilesDiscrepancy[] = [];
    if (!tagsEqual(current.safetyTags, candidate.safetyTags)) {
        discrepancies.push({ field: 'safetyTags', current: sortedTags(current.safetyTags), candidate: sortedTags(candidate.safetyTags) });
    }
    if (current.category !== candidate.category) {
        discrepancies.push({ field: 'category', current: current.category, candidate: candidate.category });
    }
    if (current.durationMin !== candidate.durationMin) {
        discrepancies.push({ field: 'durationMin', current: current.durationMin, candidate: candidate.durationMin });
    }
    if (current.durationMax !== candidate.durationMax) {
        discrepancies.push({ field: 'durationMax', current: current.durationMax, candidate: candidate.durationMax });
    }
    if (current.modality !== candidate.modality) {
        discrepancies.push({ field: 'modality', current: current.modality, candidate: candidate.modality });
    }
    return discrepancies;
}

export function runAuthoredSessionProfilesComparison(sessions: readonly AnyExternalPlanSession[]): AuthoredSessionProfilesComparisonReport {
    const rows = sessions.map((session): AuthoredSessionProfilesComparisonRow => {
        const current = toGateableSession(session);
        const candidate = deriveAuthoredSessionEligibility(session);
        return { sessionId: session.id, current, candidate, discrepancies: diffRow(current, candidate) };
    });
    return {
        rows,
        scope: 'eligibility-safety-tags-only',
        limitations: [
            'Evaluates hard-eligibility safety tags and duration only; cost/stimulus derivation is untouched (out of scope for M8.1).',
            'Production remains externalSessionProfiles.ts unconditionally; this report has no selection authority (M8 framing).',
            'A discrepancy is reported, not judged -- whether the candidate or today\'s adapter is right for a given session is an M8.3 ship/no-ship decision.',
        ],
    };
}
