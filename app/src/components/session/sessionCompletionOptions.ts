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
