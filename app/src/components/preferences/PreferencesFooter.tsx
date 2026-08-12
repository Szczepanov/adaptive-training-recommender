

interface PreferencesFooterProps {
  hasChanges: boolean;
  saving: boolean;
  handleSave: () => void;
  handleReset: () => void;
}

export function PreferencesFooter({ hasChanges, saving, handleSave, handleReset }: PreferencesFooterProps) {
  return (
    <div className="save-section">
      {hasChanges && (
        <button
          type="button"
          className="reset-btn"
          onClick={handleReset}
          disabled={saving}
        >
          Discard Changes
        </button>
      )}
      <button
        type="button"
        className={`save-btn ${hasChanges ? 'has-changes' : ''}`}
        onClick={handleSave}
        disabled={saving || !hasChanges}
      >
        {saving ? 'Saving...' : 'Save Preferences'}
      </button>
    </div>
  );
}
