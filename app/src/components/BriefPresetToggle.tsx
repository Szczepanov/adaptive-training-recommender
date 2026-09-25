import { briefWindowDaysFor, type BriefWindowPreset } from '../engine/contextBrief';

const PRESET_OPTIONS: ReadonlyArray<{ preset: BriefWindowPreset; label: string }> = [
  { preset: 'daily', label: '☀️ Morning Coach (Daily)' },
  { preset: 'full', label: `📋 Block Planning (${briefWindowDaysFor('full')} days)` },
  { preset: 'diagnostic', label: `🔬 Diagnostic (${briefWindowDaysFor('diagnostic')} days)` },
];

interface BriefPresetToggleProps {
  preset: BriefWindowPreset;
  onSelect: (preset: BriefWindowPreset) => void;
}

export function BriefPresetToggle({ preset, onSelect }: BriefPresetToggleProps) {
  return (
    <div className="brief-preset-toggle" role="group" aria-label="Context brief purpose">
      {PRESET_OPTIONS.map(option => (
        <button
          key={option.preset}
          type="button"
          className={preset === option.preset ? 'active' : ''}
          aria-pressed={preset === option.preset}
          onClick={() => onSelect(option.preset)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
