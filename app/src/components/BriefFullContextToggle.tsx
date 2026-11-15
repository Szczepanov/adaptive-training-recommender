interface BriefFullContextToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
}

/** Per-view opt-out of unchanged-context abbreviation in the ledger Markdown export. */
export function BriefFullContextToggle({ checked, onChange }: BriefFullContextToggleProps) {
  return (
    <label className="brief-full-context-toggle">
      <input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} />
      <span>Include full context</span>
    </label>
  );
}
