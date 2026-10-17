import type { BodyRegion, TissueResponseLevel } from '../../engine/models';

export const COMPLETION_TISSUE_LEVEL_OPTIONS: Array<{ value: TissueResponseLevel; label: string }> = [
    { value: 'mild', label: 'Mild discomfort / caution' },
    { value: 'moderate', label: 'Moderate pain / tightness' },
    { value: 'severe', label: 'Severe pain / impaired movement' },
];

export interface CompletionTissueFeedback {
    region: BodyRegion;
    painDuringTraining: TissueResponseLevel;
    afterTrainingState?: TissueResponseLevel;
}

/**
 * The region/severity selectors are a pending draft until the athlete presses "Add region".
 * Finishing the session is also an explicit submit action, so it must not silently discard
 * that draft. Kept outside the React component module so it stays directly unit-testable
 * without violating the Fast Refresh component-only export rule.
 */
export function resolveSubmittedTissueFeedback(
    tissueFeedback: CompletionTissueFeedback[],
    selectedRegion: BodyRegion | '',
    reportedPain: TissueResponseLevel,
): CompletionTissueFeedback[] {
    if (!selectedRegion || tissueFeedback.some(item => item.region === selectedRegion)) {
        return tissueFeedback;
    }
    return [
        ...tissueFeedback,
        { region: selectedRegion, painDuringTraining: reportedPain, afterTrainingState: reportedPain },
    ];
}

/** Fields of the completion form as the athlete left them. `undefined` means "not answered". */
export interface CompletionEvidenceDraft {
    sessionRpe?: number;
    completedFraction?: number;
    /** Explicit No / Yes answer; `undefined` until the athlete picks one. A dependent same-day
     * session that needs this confirmation asks for it on Home instead (session-execution.md). */
    unexpectedFatigue?: boolean;
    notes: string;
    tissueFeedback: CompletionTissueFeedback[];
    selectedRegion: BodyRegion | '';
    reportedPain: TissueResponseLevel;
    /** Required, non-optional planned steps that still have unfinished work. */
    missingRequiredStepCount: number;
}

export interface CompletionEvidencePayload {
    sessionRpe?: number;
    completedFraction?: number;
    unexpectedFatigue?: boolean;
    notes?: string;
    tissueFeedback?: CompletionTissueFeedback[];
}

/**
 * True when an athlete-reported "100% completed" would contradict known unfinished required
 * work. The sheet disables that option and `buildCompletionPayload` refuses to persist it.
 */
export function contradictsRequiredWork(completedFraction: number | undefined, missingRequiredStepCount: number): boolean {
    return completedFraction === 1 && missingRequiredStepCount > 0;
}

/**
 * Missing is not neutral, not zero and not an implicit negative answer (#896): only fields
 * the athlete actually answered are emitted, unexpected fatigue included -- an unanswered
 * question is not a "no fatigue" report.
 */
export function buildCompletionPayload(draft: CompletionEvidenceDraft): CompletionEvidencePayload {
    const tissueFeedback = resolveSubmittedTissueFeedback(draft.tissueFeedback, draft.selectedRegion, draft.reportedPain);
    const notes = draft.notes.trim();
    const keepFraction = draft.completedFraction !== undefined
        && !contradictsRequiredWork(draft.completedFraction, draft.missingRequiredStepCount);
    return {
        ...(draft.sessionRpe !== undefined ? { sessionRpe: draft.sessionRpe } : {}),
        ...(keepFraction ? { completedFraction: draft.completedFraction } : {}),
        ...(draft.unexpectedFatigue !== undefined ? { unexpectedFatigue: draft.unexpectedFatigue } : {}),
        ...(notes ? { notes } : {}),
        ...(tissueFeedback.length > 0 ? { tissueFeedback } : {}),
    };
}
