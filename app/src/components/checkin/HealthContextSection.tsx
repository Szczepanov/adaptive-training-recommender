import type {
    HealthContextCheckin,
    HealthSymptomType,
} from '../../engine/healthAnomalyModels';
import { normalizeHealthContext } from '../../engine/healthContextDefaults';
import { HEALTH_OTHER_DISRUPTION_MAX_LENGTH } from '../../engine/healthContextValidation';
import './HealthContextSection.css';

interface HealthContextSectionProps {
    value?: HealthContextCheckin;
    symptomsPresent: boolean;
    /**
     * Deprecated no-op kept only while this PR is stacked on #179, whose DailyCheckin caller
     * still supplies the old missingness object. No manual physiology reaches UI or engine state.
     */
    manualPhysiologyMissing?: {
        rhr: boolean;
        hrv: boolean;
        respiration: boolean;
    };
    onChange: (next: HealthContextCheckin) => void;
}

const TRAVEL_OPTIONS: Array<{ value: NonNullable<HealthContextCheckin['travelDisruption']>; label: string }> = [
    { value: 'none', label: 'No' },
    { value: 'local_or_no_timezone', label: 'Travel' },
    { value: 'timezone_shift', label: 'Time-zone shift' },
    { value: 'late_arrival_or_disrupted_sleep', label: 'Late arrival' },
];

const CONTEXT_QUESTIONS = [
    { key: 'unusualHeatOrSauna', label: 'Heat / sauna' },
    { key: 'dehydrationOrFluidLoss', label: 'Dehydration / fluid loss' },
    { key: 'recentVaccination', label: 'Vaccination' },
    { key: 'medicationChange', label: 'Medication change' },
    { key: 'closeSickContact', label: 'Close sick contact' },
] as const;

const YES_NO_OPTIONS = [
    { value: false, label: 'No' },
    { value: true, label: 'Yes' },
] as const;

const ONSETS = [
    ['today', 'Today'],
    ['yesterday', 'Yesterday'],
    ['2_3_days', '2–3 days'],
    ['earlier', 'Earlier'],
] as const;

const SEVERITIES = [
    ['mild', 'Mild'],
    ['moderate', 'Moderate'],
    ['severe', 'Severe'],
] as const;

const SYMPTOM_TYPES: Array<{ value: HealthSymptomType; label: string }> = [
    { value: 'sore_throat', label: 'Sore throat' },
    { value: 'congestion', label: 'Congestion' },
    { value: 'cough', label: 'Cough' },
    { value: 'fever_or_chills', label: 'Fever / chills' },
    { value: 'headache_or_body_aches', label: 'Headache / body aches' },
    { value: 'gastrointestinal', label: 'GI symptoms' },
    { value: 'unusual_fatigue', label: 'Unusual fatigue' },
    { value: 'other', label: 'Other symptom' },
];

function hasUnusualContext(value: HealthContextCheckin | undefined, symptomsPresent: boolean): boolean {
    if (symptomsPresent) return true;
    if (!value) return false;
    return (value.alcoholDrinksLast24h ?? 0) > 0
        || (value.travelDisruption !== undefined && value.travelDisruption !== 'none')
        || value.unusualHeatOrSauna === true
        || value.dehydrationOrFluidLoss === true
        || value.recentVaccination === true
        || value.medicationChange === true
        || value.closeSickContact === true
        || Boolean(value.otherDisruption?.trim());
}

export function HealthContextSection({
    value,
    symptomsPresent,
    onChange,
}: HealthContextSectionProps) {
    const context = normalizeHealthContext(value, symptomsPresent);
    const update = (patch: Partial<HealthContextCheckin>) => onChange({ ...context, ...patch });
    const symptoms = context.symptoms ?? { present: symptomsPresent };

    const updateSymptoms = (patch: Partial<NonNullable<HealthContextCheckin['symptoms']>>) => {
        onChange({
            ...context,
            symptoms: {
                ...symptoms,
                present: symptomsPresent,
                ...patch,
            },
        });
    };

    const toggleSymptomType = (type: HealthSymptomType) => {
        const current = symptoms.types ?? [];
        const next = current.includes(type)
            ? current.filter(item => item !== type)
            : [...current, type];
        updateSymptoms({ types: next.length > 0 ? next : null });
    };

    const unusual = hasUnusualContext(context, symptomsPresent);

    return (
        <details className="health-context" open={unusual || undefined}>
            <summary className="health-context__summary">
                <span>
                    <strong>Anything unusual since yesterday?</strong>
                    <small>Symptoms and contextual flags default to No; alcohol to 0; travel to none.</small>
                </span>
                {unusual && <span className="health-context__badge">Context added</span>}
            </summary>

            <div className="health-context__body">
                <div className="health-context__row">
                    <span className="health-context__label">Alcohol</span>
                    <div className="health-context__chips" role="group" aria-label="Alcohol drinks in the last 24 hours">
                        {([0, 1, 2, 3] as const).map(count => (
                            <button
                                key={count}
                                type="button"
                                className={`health-context__chip ${context.alcoholDrinksLast24h === count ? 'is-selected' : ''}`}
                                aria-pressed={context.alcoholDrinksLast24h === count}
                                onClick={() => update({ alcoholDrinksLast24h: count })}
                            >
                                {count === 0 ? 'None' : count === 3 ? '3+' : count}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="health-context__row">
                    <span className="health-context__label">Travel / jet lag</span>
                    <div className="health-context__chips" role="group" aria-label="Travel disruption">
                        {TRAVEL_OPTIONS.map(option => (
                            <button
                                key={option.value}
                                type="button"
                                className={`health-context__chip ${context.travelDisruption === option.value ? 'is-selected' : ''}`}
                                aria-pressed={context.travelDisruption === option.value}
                                onClick={() => update({
                                    travelDisruption: option.value,
                                    ...(option.value !== 'timezone_shift' ? { timezoneShiftHours: null } : {}),
                                })}
                            >
                                {option.label}
                            </button>
                        ))}
                    </div>
                    {context.travelDisruption === 'timezone_shift' && (
                        <label className="health-context__timezone">
                            Time-zone change (hours)
                            <input
                                type="number"
                                min={-14}
                                max={14}
                                step={0.5}
                                value={context.timezoneShiftHours ?? ''}
                                onChange={event => {
                                    const text = event.target.value;
                                    update({ timezoneShiftHours: text === '' ? null : Number(text) });
                                }}
                            />
                        </label>
                    )}
                </div>

                {CONTEXT_QUESTIONS.map(item => (
                    <div className="health-context__row" key={item.key}>
                        <span className="health-context__label">{item.label}</span>
                        <div className="health-context__chips" role="group" aria-label={item.label}>
                            {YES_NO_OPTIONS.map(option => {
                                const selected = context[item.key] === option.value;
                                return (
                                    <button
                                        key={String(option.value)}
                                        type="button"
                                        className={`health-context__chip ${selected ? 'is-selected' : ''}`}
                                        aria-pressed={selected}
                                        onClick={() => update({ [item.key]: option.value })}
                                    >
                                        {option.label}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                ))}

                <label className="health-context__other">
                    Other disruption (optional)
                    <input
                        type="text"
                        maxLength={HEALTH_OTHER_DISRUPTION_MAX_LENGTH}
                        value={context.otherDisruption ?? ''}
                        placeholder="e.g. unusually late night"
                        onChange={event => update({ otherDisruption: event.target.value || null })}
                    />
                </label>

                {symptomsPresent && (
                    <div className="health-context__symptoms" aria-label="Illness symptom details">
                        <h3>Symptom details <span>optional</span></h3>

                        <div className="health-context__row">
                            <span className="health-context__label">Started</span>
                            <div className="health-context__chips" role="group" aria-label="Symptom onset">
                                {ONSETS.map(([onset, label]) => (
                                    <button
                                        key={onset}
                                        type="button"
                                        className={`health-context__chip ${symptoms.onset === onset ? 'is-selected' : ''}`}
                                        aria-pressed={symptoms.onset === onset}
                                        onClick={() => updateSymptoms({ onset: symptoms.onset === onset ? null : onset })}
                                    >
                                        {label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="health-context__row">
                            <span className="health-context__label">Severity</span>
                            <div className="health-context__chips" role="group" aria-label="Symptom severity">
                                {SEVERITIES.map(([severity, label]) => (
                                    <button
                                        key={severity}
                                        type="button"
                                        className={`health-context__chip ${symptoms.severity === severity ? 'is-selected' : ''}`}
                                        aria-pressed={symptoms.severity === severity}
                                        onClick={() => updateSymptoms({ severity: symptoms.severity === severity ? null : severity })}
                                    >
                                        {label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="health-context__symptom-types" role="group" aria-label="Symptom types">
                            {SYMPTOM_TYPES.map(item => (
                                <button
                                    key={item.value}
                                    type="button"
                                    className={`health-context__toggle ${(symptoms.types ?? []).includes(item.value) ? 'is-selected' : ''}`}
                                    aria-pressed={(symptoms.types ?? []).includes(item.value)}
                                    onClick={() => toggleSymptomType(item.value)}
                                >
                                    {item.label}
                                </button>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </details>
    );
}
