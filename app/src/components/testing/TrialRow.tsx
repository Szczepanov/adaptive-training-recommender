import React, { useState } from 'react';
import type {
    AssessmentTrialFieldDefinition,
    MetricObservationDevice,
    ObservationValidity,
} from '../../observations/models';
import type { DraftTrialRow } from '../../utils/assessmentDraftStorage';

export type { DraftTrialRow };

interface TrialRowProps {
    row: DraftTrialRow;
    fields: readonly AssessmentTrialFieldDefinition[];
    onChange: (updated: DraftTrialRow) => void;
    onRemove?: () => void;
    canRemove?: boolean;
    isStrength?: boolean;
    /** Already persisted: immutable, shown read-only (correct it after completion instead). */
    locked?: boolean;
}

const VALIDITIES: readonly ObservationValidity[] = ['valid', 'invalid', 'practice', 'questionable'];

export const TrialRow: React.FC<TrialRowProps> = ({
    row,
    fields,
    onChange,
    onRemove,
    canRemove,
    isStrength,
    locked = false,
}) => {
    const [showDeviceOverride, setShowDeviceOverride] = useState(Boolean(row.device?.provider));

    const handleFieldValueChange = (field: AssessmentTrialFieldDefinition, rawValue: string) => {
        if (field.valueKind === 'boolean') {
            const boolVal = rawValue === 'true' ? true : rawValue === 'false' ? false : undefined;
            const updatedValues = { ...row.values };
            if (boolVal === undefined) {
                delete updatedValues[field.id];
            } else {
                updatedValues[field.id] = boolVal;
            }
            onChange({ ...row, values: updatedValues });
            return;
        }

        const updatedValues = { ...row.values };
        if (rawValue.trim() === '') {
            delete updatedValues[field.id];
        } else {
            const num = Number(rawValue);
            if (Number.isFinite(num)) {
                updatedValues[field.id] = num;
            }
        }
        onChange({ ...row, values: updatedValues });
    };

    const handleValidityChange = (validity: ObservationValidity) => {
        onChange({
            ...row,
            validity,
            invalidReason: validity === 'invalid' ? row.invalidReason : undefined,
        });
    };

    // Raw text is kept while typing (trimming per keystroke would swallow the space in
    // "WL Analysis"); TrialCaptureTable normalizes the device when it builds trial records.
    const handleDeviceChange = (key: keyof MetricObservationDevice, val: string) => {
        const currentDevice = row.device ?? { provider: '' };
        const updatedDevice: MetricObservationDevice = {
            ...currentDevice,
            [key]: val === '' ? undefined : val,
        };
        if (!updatedDevice.provider && !updatedDevice.model && !updatedDevice.deviceId) {
            onChange({ ...row, device: undefined });
        } else {
            onChange({ ...row, device: updatedDevice });
        }
    };

    const rowLabel = isStrength ? `Attempt ${row.ordinal}` : `Trial ${row.ordinal}`;

    return (
        <fieldset className="trial-row-card" disabled={locked}>
            <legend className="trial-row-legend">
                <span className="trial-row-title">{rowLabel}{locked && ' · saved'}</span>
                {canRemove && onRemove && (
                    <button
                        type="button"
                        className="testing-secondary trial-remove-btn"
                        onClick={onRemove}
                        aria-label={`Remove ${rowLabel}`}
                    >
                        Remove
                    </button>
                )}
            </legend>

            <div className="trial-fields-grid">
                {fields.map(field => {
                    const value = row.values[field.id];

                    if (field.valueKind === 'boolean') {
                        return (
                            <label key={field.id} className="trial-field-label">
                                {field.label}
                                {field.required && <span className="required-indicator" aria-hidden="true">*</span>}
                                <select
                                    value={value === undefined ? '' : String(value)}
                                    onChange={e => handleFieldValueChange(field, e.target.value)}
                                    className="trial-select"
                                >
                                    <option value="">Select result…</option>
                                    <option value="true">Successful lift</option>
                                    <option value="false">Miss / Failed</option>
                                </select>
                            </label>
                        );
                    }

                    return (
                        <label key={field.id} className="trial-field-label">
                            <span>
                                {field.label} {field.unit ? `(${field.unit})` : ''}
                                {field.required && <span className="required-indicator" aria-hidden="true">*</span>}
                            </span>
                            <input
                                inputMode="decimal"
                                type="number"
                                step="any"
                                min={field.minimum}
                                max={field.maximum}
                                placeholder={field.minimum !== undefined && field.maximum !== undefined ? `${field.minimum}–${field.maximum}` : undefined}
                                value={value === undefined ? '' : String(value)}
                                onChange={e => handleFieldValueChange(field, e.target.value)}
                                className="trial-input"
                            />
                        </label>
                    );
                })}
            </div>

            <div className="trial-validity-section">
                <span className="trial-section-subtitle">Validity:</span>
                <div className="trial-validity-options">
                    {VALIDITIES.map(v => (
                        <label key={v} className="trial-validity-chip">
                            <input
                                type="radio"
                                name={`validity-${row.ordinal}`}
                                value={v}
                                checked={row.validity === v}
                                onChange={() => handleValidityChange(v)}
                            />
                            <span>{v}</span>
                        </label>
                    ))}
                </div>
            </div>

            {row.validity === 'invalid' && (
                <label className="trial-field-label trial-alert-field">
                    <span>Reason for invalid trial <span className="required-indicator">*</span></span>
                    <input
                        type="text"
                        placeholder="e.g. Lost balance / stepped off line / spotter touched bar"
                        value={row.invalidReason ?? ''}
                        onChange={e => onChange({ ...row, invalidReason: e.target.value })}
                        className="trial-input"
                        required
                    />
                </label>
            )}

            {(row.validity === 'questionable' || row.validity === 'practice' || row.validity === 'valid') && (
                <label className="trial-field-label">
                    <span>
                        Note {row.validity === 'questionable' ? <span className="required-indicator">*</span> : '(optional)'}
                    </span>
                    <input
                        type="text"
                        placeholder={row.validity === 'questionable' ? 'Explain questionable execution' : 'Optional notes on technique or feel'}
                        value={row.notes ?? ''}
                        onChange={e => onChange({ ...row, notes: e.target.value })}
                        className="trial-input"
                        required={row.validity === 'questionable'}
                    />
                </label>
            )}

            <details
                className="trial-device-details"
                open={showDeviceOverride}
                onToggle={e => setShowDeviceOverride((e.target as HTMLDetailsElement).open)}
            >
                <summary className="trial-device-summary">Trial device override (optional)</summary>
                <div className="testing-grid three">
                    <label>
                        Provider
                        <input
                            type="text"
                            placeholder="e.g. WL Analysis"
                            value={row.device?.provider ?? ''}
                            onChange={e => handleDeviceChange('provider', e.target.value)}
                        />
                    </label>
                    <label>
                        Model
                        <input
                            type="text"
                            value={row.device?.model ?? ''}
                            onChange={e => handleDeviceChange('model', e.target.value)}
                        />
                    </label>
                    <label>
                        Device ID
                        <input
                            type="text"
                            value={row.device?.deviceId ?? ''}
                            onChange={e => handleDeviceChange('deviceId', e.target.value)}
                        />
                    </label>
                </div>
            </details>
        </fieldset>
    );
};
