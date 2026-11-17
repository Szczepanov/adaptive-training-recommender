interface BriefFullContextToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** The purpose always renders full context (the new-chat refresh export), so the toggle is fixed on. */
  locked?: boolean;
}

/** Per-view opt-out of unchanged-context abbreviation in the ledger Markdown export. */
export function BriefFullContextToggle({ checked, onChange, locked = false }: BriefFullContextToggleProps) {
  return (
    <label className="brief-full-context-toggle">
      <input
        type="checkbox"
        checked={locked || checked}
        disabled={locked}
        onChange={event => onChange(event.target.checked)}
      />
      <span>{locked ? 'Include full context (always, for a new chat)' : 'Include full context'}</span>
    </label>
  );
}
