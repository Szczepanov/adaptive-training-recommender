import { PLACEMENT_REASON_NOTE_MAX, type PlacementReasonCode } from '../ledger/models';
import { PLACEMENT_REASON_OPTIONS } from './placementReason';

interface PlacementReasonPickerProps {
    code: PlacementReasonCode | '';
    note: string;
    onCodeChange: (code: PlacementReasonCode | '') => void;
    onNoteChange: (note: string) => void;
}

/** Optional reason for dropping or moving an imported session; it goes into the ledger export. */
export function PlacementReasonPicker({ code, note, onCodeChange, onNoteChange }: PlacementReasonPickerProps) {
    return (
        <div className="external-week-reason">
            <label>
                <span>Reason (optional)</span>
                <select value={code} onChange={event => onCodeChange(event.target.value as PlacementReasonCode | '')}>
                    <option value="">No reason given</option>
                    {PLACEMENT_REASON_OPTIONS.map(option => (
                        <option key={option.code} value={option.code}>{option.label}</option>
                    ))}
                </select>
            </label>
            <label>
                <span>Note (optional)</span>
                <input
                    type="text"
                    value={note}
                    maxLength={PLACEMENT_REASON_NOTE_MAX}
                    onChange={event => onNoteChange(event.target.value)}
                />
            </label>
        </div>
    );
}
