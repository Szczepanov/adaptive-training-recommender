import type { TissueResponseLevel } from '../../engine/models';

export const COMPLETION_TISSUE_LEVEL_OPTIONS: Array<{ value: TissueResponseLevel; label: string }> = [
    { value: 'mild', label: 'Mild discomfort / caution' },
    { value: 'moderate', label: 'Moderate pain / tightness' },
    { value: 'severe', label: 'Severe pain / impaired movement' },
];
