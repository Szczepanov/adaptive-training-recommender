import type { DailyReadiness, UserContext, Recommendation, SessionTemplate } from './models';
import { TEMPLATES } from './templates';

export function evaluateTraining(readiness: DailyReadiness, context: UserContext): Recommendation {
    const { subjective, objective } = readiness;
    
    // 1. Subjective fatigue scoring (10 = worst fatigue)
    const invertedMotivation = 10 - subjective.motivation;
    const invertedSleepQual = 10 - subjective.sleepQuality;
    const invertedReadiness = 10 - subjective.readiness;
    
    // Core subjective penalty calculation
    const overallFatigueScore = (subjective.fatigue + subjective.soreness + invertedReadiness + invertedSleepQual) / 4;
    
    // 2. Objective penalty logic (analyzing deltas vs baselines)
    let objectivePenalty = 0;
    
    // RHR Delta: Higher RHR is bad
    if (objective.rhr_delta !== null && objective.rhr_delta > 3) {
        objectivePenalty += 1; // +3 bpm over 7d is yellow flag
    }
    if (objective.rhr_delta !== null && objective.rhr_delta > 6) {
        objectivePenalty += 1; // +6 bpm over 7d is red flag
    }
    
    // HRV Delta: Lower HRV is bad
    if (objective.hrv_delta !== null && objective.hrv_delta < -5) {
        objectivePenalty += 1; // Significant drop vs weekly average
    }
    
    // Body Battery & Sleep Thresholds
    if (objective.body_battery_wake !== null && objective.body_battery_wake < 50) {
        objectivePenalty += 1; // Poor recovery overnight
    }
    if (objective.sleep_score !== null && objective.sleep_score < 60) {
        objectivePenalty += 1; 
    }

    const extremeFatigue = subjective.fatigue > 8 || subjective.soreness > 8 || subjective.painFlag;
    
    // 3. Determine Core Mode Hierarchy (Train vs Modify vs Recover)
    let mode: 'train' | 'modify' | 'recover' = 'train';
    
    // Prevent overtraining if you've done too many hard sessions recently
    const recentHardSessions = objective.last_3_days_hard_sessions_count || 0;
    if (recentHardSessions >= 2) {
        objectivePenalty += 1; // 2+ hard sessions in 3 days warrants caution
    }
    
    if (overallFatigueScore > 7 || extremeFatigue || objectivePenalty >= 3) {
        mode = 'recover';
    } else if (overallFatigueScore > 5 || subjective.soreness > 6 || objectivePenalty >= 1) {
        mode = 'modify'; // Demote to Zone 2 / easier sessions
    }

    // 4. Time available override
    const availableTime = Math.min(context.constraints.maxTimeMinutes, subjective.timeAvailable);

    // 5. Filter templates by constraints
    let availableTemplates = TEMPLATES.filter(t => {
        if (t.durationMin > availableTime) return false;
        
        for (const req of t.requiredEquipment) {
            if (req === 'treadmill' && !context.constraints.hasTreadmill) return false;
            if (req === 'indoor_bike' && !context.constraints.hasIndoorBike) return false;
            if (req === 'free_weights' && !context.constraints.hasFreeWeights) return false;
            if (req === 'cable_machine' && !context.constraints.hasCableMachine) return false;
        }
        return true;
    });

    // 6. Select Template Based on Mode & Constraints
    let selectedTemplate = availableTemplates.find(t => t.category === 'Rest') || TEMPLATES[1]; // fallback
    let rationale = "";

    if (mode === 'recover') {
        const recoverOptions = availableTemplates.filter(t => t.category === 'Rest' || t.category === 'Mobility/Recovery');
        if (recoverOptions.length > 0) selectedTemplate = recoverOptions[0];
        
        rationale = "Your overall fatigue markers are high today (combining subjective feel with drops in objective baselines). Pushing hard could be counter-productive; focus on active or passive recovery.";
    
    } else if (mode === 'modify') {
        const modifyOptions = availableTemplates.filter(t => t.category === 'Easy Endurance' || t.category === 'Mobility/Recovery');
        if (modifyOptions.length > 0) selectedTemplate = modifyOptions[0];
        else selectedTemplate = TEMPLATES[0]; // Rest fallback
        
        rationale = "You're showing moderate soreness or slight downward trends in Garmin baselines. We are capping intensity today to build base capacity without taxing the CNS.";
    
    } else {
        const trainOptions = availableTemplates.filter(t => t.category === 'Hard Endurance' || t.category === 'Full-body Strength');
        if (trainOptions.length > 0) selectedTemplate = trainOptions[0];
        
        rationale = "Readiness is solid across both subjective feelings and Garmin baselines. Great day for a hard session aligned with your primary goals!";
    }

    // Add previous day context if available and relevant
    if (objective.yesterday_training && objective.yesterday_training.duration_min && mode === 'modify') {
        rationale += ` Giving your body a break after yesterday's ${objective.yesterday_training.type} session.`;
    }

    // Fallback safety
    if (!selectedTemplate) {
        selectedTemplate = TEMPLATES[0];
        rationale += " (Defaulted to Rest/Mobility due to severe time/equipment constraints).";
    }

    return {
        template: selectedTemplate,
        rationale
    };
}
