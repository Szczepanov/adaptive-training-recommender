import { useState, memo } from 'react';
import { goalService } from '../services/goalService';
import { trainingSettingsService } from '../services/trainingSettingsService';
import { trainingIntentProfileService } from '../services/trainingIntentProfileService';
import './OnboardingWizard.css';

interface OnboardingWizardProps {
    userId: string;
    onCompleted: () => void;
}

type GoalFocus = 'general_fitness' | 'running_10k_half' | 'cycling' | 'strength';
type EquipmentTier = 'full_gym' | 'home_dumbbells' | 'minimal';

export const OnboardingWizard = memo(function OnboardingWizard({ userId, onCompleted }: OnboardingWizardProps) {
    const [step, setStep] = useState<1 | 2 | 3>(1);
    const [focus, setFocus] = useState<GoalFocus>('general_fitness');
    const [equipment, setEquipment] = useState<EquipmentTier>('full_gym');
    const [daysPerWeek, setDaysPerWeek] = useState<number>(4);
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);

    const handleFinish = async () => {
        if (saving) return;
        setSaving(true);
        setSaveError(null);
        try {
            let domain: 'endurance' | 'strength' | 'general_fitness' = 'general_fitness';
            let title = 'Cardiovascular Health & Functional Fitness';
            if (focus === 'running_10k_half') {
                domain = 'endurance';
                title = '10k / Half Marathon Preparation';
            } else if (focus === 'cycling') {
                domain = 'endurance';
                title = 'Endurance Cycling Development';
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
            };

            // Persist training settings and intent profile first before active goal creation.
            await trainingSettingsService.updateTrainingSettings(userId, {
                equipment: equipmentMap,
                defaults: {
                    weekdayMaxMinutes: daysPerWeek >= 5 ? 60 : 45,
                    weekendMaxMinutes: 90,
                    environment: 'either',
                },
            });

            await trainingIntentProfileService.upsert(userId, {
                planningMode: 'evergreen',
                priorities: [
                    domain === 'endurance' ? 'endurance' : domain === 'strength' ? 'strength_muscle' : 'health',
                ],
                weeklyCommitment: {
                    minSessions: Math.max(1, daysPerWeek - 1),
                    targetSessions: daysPerWeek,
                    maxSessions: Math.min(7, daysPerWeek + 1),
                },
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
                            <button type="button" className={`choice-card ${focus === 'running_10k_half' ? 'active' : ''}`} onClick={() => setFocus('running_10k_half')}>
                                <span className="choice-icon">🏃</span>
                                <strong>Running (10k / Half / Marathon)</strong>
                                <p>Pacing, lactate threshold, VO2 max, and aerobic volume.</p>
                            </button>
                            <button type="button" className={`choice-card ${focus === 'cycling' ? 'active' : ''}`} onClick={() => setFocus('cycling')}>
                                <span className="choice-icon">🚴</span>
                                <strong>Cycling & Endurance</strong>
                                <p>Power zones, threshold development, and sustained output.</p>
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
                            <label className="group-heading">Weekly Training Target:</label>
                            <div className="days-selector-row">
                                {[3, 4, 5, 6].map(days => (
                                    <button key={days} type="button" className={`days-pill ${daysPerWeek === days ? 'active' : ''}`} onClick={() => setDaysPerWeek(days)} disabled={saving}>
                                        {days} days / week
                                    </button>
                                ))}
                            </div>
                        </div>

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
