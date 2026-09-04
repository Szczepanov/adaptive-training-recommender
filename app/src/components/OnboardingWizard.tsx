import { useState, memo } from 'react';
import { goalService } from '../services/goalService';
import { trainingSettingsService } from '../services/trainingSettingsService';
import { trainingIntentProfileService } from '../services/trainingIntentProfileService';
import './OnboardingWizard.css';

interface OnboardingWizardProps {
    userId: string;
    onCompleted: () => void;
}

type GoalFocus = 'general_fitness' | 'running' | 'cycling' | 'triathlon' | 'strength';
type EquipmentTier = 'full_gym' | 'home_dumbbells' | 'minimal';

type WeeklyCommitment = {
    minSessions: number;
    targetSessions: number;
    maxSessions: number;
};

/**
 * The onboarding question is deliberately expressed as available exercise *days*, while
 * the persisted training-intent contract is session-based. Treat one session per available
 * day as the target and retain the existing ±1 planning flexibility. The +1 maximum may
 * represent one double-session day; it does not invent an additional available day.
 */
export function weeklyCommitmentFromExerciseDays(exerciseDaysPerWeek: number): WeeklyCommitment {
    const days = Math.min(7, Math.max(1, Math.round(exerciseDaysPerWeek)));
    return {
        minSessions: Math.max(1, days - 1),
        targetSessions: days,
        maxSessions: Math.min(14, days + 1),
    };
}

interface ExerciseDaysSliderProps {
    value: number;
    onChange: (days: number) => void;
    disabled?: boolean;
}

export function ExerciseDaysSlider({ value, onChange, disabled = false }: ExerciseDaysSliderProps) {
    return (
        <div className="choice-group days-slider-group">
            <div className="days-slider-header">
                <label htmlFor="onboarding-days-slider" className="group-heading">
                    How many days a week can you exercise?
                </label>
                <span className="days-slider-badge">
                    <strong>{value}</strong> {value === 1 ? 'day' : 'days'} / week
                </span>
            </div>
            <input
                id="onboarding-days-slider"
                type="range"
                min="1"
                max="7"
                step="1"
                value={value}
                onChange={(event) => onChange(Number(event.target.value))}
                disabled={disabled}
                className="days-range-slider"
            />
            <div className="days-slider-labels" aria-hidden="true">
                <span>1 day</span>
                <span>2</span>
                <span>3</span>
                <span>4</span>
                <span>5</span>
                <span>6</span>
                <span>7 days</span>
            </div>
        </div>
    );
}

export const OnboardingWizard = memo(function OnboardingWizard({ userId, onCompleted }: OnboardingWizardProps) {
    const [step, setStep] = useState<1 | 2 | 3>(1);
    const [focus, setFocus] = useState<GoalFocus>('general_fitness');
    const [equipment, setEquipment] = useState<EquipmentTier>('full_gym');
    const [exerciseDaysPerWeek, setExerciseDaysPerWeek] = useState<number>(4);
    const [sportAccess, setSportAccess] = useState({ outdoor_bike: false, swim_access: false });
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);

    const handleFinish = async () => {
        if (saving) return;
        setSaving(true);
        setSaveError(null);
        try {
            let domain: 'endurance' | 'strength' | 'general_fitness' = 'general_fitness';
            let title = 'Cardiovascular Health & Functional Fitness';
            if (focus === 'running') {
                domain = 'endurance';
                title = '5K / 10K / Half / Marathon Preparation';
            } else if (focus === 'cycling') {
                domain = 'endurance';
                title = 'Endurance Cycling Development';
            } else if (focus === 'triathlon') {
                domain = 'endurance';
                title = 'Triathlon Preparation';
            } else if (focus === 'strength') {
                domain = 'strength';
                title = 'Full Body Strength & Muscle';
            }

            const equipmentMap = {
                free_weights: equipment === 'full_gym' || equipment === 'home_dumbbells',
                cable_machine: equipment === 'full_gym',
                treadmill: equipment === 'full_gym',
                indoor_bike: equipment === 'full_gym',
                pullup_bar: equipment === 'full_gym' || equipment === 'home_dumbbells',
                outdoor_bike: sportAccess.outdoor_bike,
                swim_access: sportAccess.swim_access,
            };

            // Persist training settings and intent profile first before active goal creation.
            await trainingSettingsService.updateTrainingSettings(userId, {
                equipment: equipmentMap,
                defaults: {
                    weekdayMaxMinutes: exerciseDaysPerWeek >= 5 ? 60 : 45,
                    weekendMaxMinutes: focus === 'running' || focus === 'cycling' || focus === 'triathlon' ? 180 : 90,
                    environment: 'either',
                },
            });

            await trainingIntentProfileService.upsert(userId, {
                planningMode: 'evergreen',
                priorities: [
                    domain === 'endurance' ? 'endurance' : domain === 'strength' ? 'strength_muscle' : 'health',
                ],
                weeklyCommitment: weeklyCommitmentFromExerciseDays(exerciseDaysPerWeek),
                organizationPreference: 'auto',
                schemaVersion: 1,
            });

            const existingGoals = await goalService.listGoals(userId);
            const hasActiveGoal = existingGoals.some(g => g.status === 'active');
            if (!hasActiveGoal) {
                await goalService.createGoal(userId, {
                    category: 'short-term',
                    domain,
                    title,
                    priority: 3,
                    status: 'active',
                });
            }

            onCompleted();
        } catch (err) {
            console.error('Failed to complete rapid onboarding:', err);
            setSaveError('We could not finish setup. Your selections are still here — please retry.');
        } finally {
            setSaving(false);
        }
    };

    return (
        <main className="onboarding-modal-backdrop" role="main" aria-label="Rapid Onboarding Setup">
            <div className="onboarding-card">
                {step === 1 && (
                    <div className="onboarding-step step-1">
                        <span className="onboarding-kicker">Welcome to Adaptive Training</span>
                        <h2 className="onboarding-title">Get your personalized daily recommendation in 15 seconds</h2>
                        <p className="onboarding-desc">
                            We combine continuous overnight Garmin biometrics with smart adaptive periodization to recommend the exact right session every morning.
                        </p>
                        <div className="onboarding-action-row">
                            <button type="button" className="btn-primary btn-large" onClick={() => setStep(2)}>
                                Let&apos;s Set Up Your Profile →
                            </button>
                        </div>
                    </div>
                )}

                {step === 2 && (
                    <div className="onboarding-step step-2">
                        <span className="onboarding-kicker">Step 1 of 2</span>
                        <h2 className="onboarding-title">What is your primary focus?</h2>

                        <div className="choice-grid">
                            <button type="button" className={`choice-card ${focus === 'general_fitness' ? 'active' : ''}`} onClick={() => setFocus('general_fitness')}>
                                <span className="choice-icon">⚡</span>
                                <strong>General Fitness & Health</strong>
                                <p>Balanced aerobic conditioning, strength, and recovery.</p>
                            </button>
                            <button type="button" className={`choice-card ${focus === 'running' ? 'active' : ''}`} onClick={() => setFocus('running')}>
                                <span className="choice-icon">🏃</span>
                                <strong>Running (5K / 10K / Half / Marathon)</strong>
                                <p>Aerobic volume, long-run durability, threshold, VO2 max, and race specificity.</p>
                            </button>
                            <button type="button" className={`choice-card ${focus === 'cycling' ? 'active' : ''}`} onClick={() => setFocus('cycling')}>
                                <span className="choice-icon">🚴</span>
                                <strong>Cycling & Endurance</strong>
                                <p>Power zones, threshold development, and sustained output.</p>
                            </button>
                            <button type="button" className={`choice-card ${focus === 'triathlon' ? 'active' : ''}`} onClick={() => setFocus('triathlon')}>
                                <span className="choice-icon">🏊</span>
                                <strong>Triathlon</strong>
                                <p>Swim, bike, and run exposure for short-course through half-distance racing.</p>
                            </button>
                            <button type="button" className={`choice-card ${focus === 'strength' ? 'active' : ''}`} onClick={() => setFocus('strength')}>
                                <span className="choice-icon">🏋️</span>
                                <strong>Strength & Muscle</strong>
                                <p>Progressive overload, hypertrophy, and joint resilience.</p>
                            </button>
                        </div>

                        <div className="onboarding-action-row">
                            <button type="button" className="btn-secondary" onClick={() => setStep(1)}>Back</button>
                            <button type="button" className="btn-primary" onClick={() => setStep(3)}>Next: Equipment & Days →</button>
                        </div>
                    </div>
                )}

                {step === 3 && (
                    <div className="onboarding-step step-3">
                        <span className="onboarding-kicker">Step 2 of 2</span>
                        <h2 className="onboarding-title">Where do you train?</h2>

                        <div className="choice-group">
                            <label className="group-heading">Available Equipment:</label>
                            <div className="choice-grid-small">
                                <button type="button" className={`choice-card-mini ${equipment === 'full_gym' ? 'active' : ''}`} onClick={() => setEquipment('full_gym')} disabled={saving}>
                                    🏋️ Full Gym (Barbells, Machines, Cardio)
                                </button>
                                <button type="button" className={`choice-card-mini ${equipment === 'home_dumbbells' ? 'active' : ''}`} onClick={() => setEquipment('home_dumbbells')} disabled={saving}>
                                    🏠 Home Gear (Dumbbells & Pull-up Bar)
                                </button>
                                <button type="button" className={`choice-card-mini ${equipment === 'minimal' ? 'active' : ''}`} onClick={() => setEquipment('minimal')} disabled={saving}>
                                    👟 Minimal / Bodyweight & Running Only
                                </button>
                            </div>
                        </div>

                        <div className="choice-group">
                            <label className="group-heading">Sport access:</label>
                            <div className="choice-grid-small">
                                <label className="choice-card-mini">
                                    <input type="checkbox" checked={sportAccess.outdoor_bike} onChange={(event) => setSportAccess(current => ({ ...current, outdoor_bike: event.target.checked }))} disabled={saving} />
                                    🚴 Bicycle available for outdoor riding
                                </label>
                                <label className="choice-card-mini">
                                    <input type="checkbox" checked={sportAccess.swim_access} onChange={(event) => setSportAccess(current => ({ ...current, swim_access: event.target.checked }))} disabled={saving} />
                                    🏊 Pool / swim venue access
                                </label>
                            </div>
                        </div>

                        <ExerciseDaysSlider
                            value={exerciseDaysPerWeek}
                            onChange={setExerciseDaysPerWeek}
                            disabled={saving}
                        />

                        {saveError && <p className="form-error-msg" role="alert">{saveError}</p>}

                        <div className="onboarding-action-row">
                            <button type="button" className="btn-secondary" onClick={() => setStep(2)} disabled={saving}>Back</button>
                            <button type="button" className="btn-primary btn-large" onClick={() => void handleFinish()} disabled={saving}>
                                {saving ? 'Building Your Plan...' : 'Generate Today’s Recommendation →'}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </main>
    );
});
