

import { SCREEN_LABELS } from '../../types/navigation';

interface PreferencesHeaderProps {
  hasChanges: boolean;
}

export function PreferencesHeader({ hasChanges }: PreferencesHeaderProps) {
  return (
    <div className="preferences-header">
      <div>
        <h1>{SCREEN_LABELS.preferences}</h1>
        <p className="header-subtitle">
          Configure how the adaptive engine selects and presents training recommendations.
        </p>
        <p className="header-subtitle">
          Edits here are staged until you choose Save Preferences, and they only break ties
          between suitable options. Hard feasibility and safety gates live in{' '}
          {SCREEN_LABELS.constraints} and save immediately.
        </p>
      </div>
      {hasChanges && (
        <span className="unsaved-indicator">Unsaved changes</span>
      )}
    </div>
  );
}
