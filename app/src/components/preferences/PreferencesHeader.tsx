

interface PreferencesHeaderProps {
  hasChanges: boolean;
}

export function PreferencesHeader({ hasChanges }: PreferencesHeaderProps) {
  return (
    <div className="preferences-header">
      <div>
        <h1>Preferences</h1>
        <p className="header-subtitle">
          Configure how the adaptive engine selects and presents training recommendations.
        </p>
      </div>
      {hasChanges && (
        <span className="unsaved-indicator">Unsaved changes</span>
      )}
    </div>
  );
}
