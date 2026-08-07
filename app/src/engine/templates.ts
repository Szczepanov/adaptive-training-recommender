import type { SessionTemplate } from './models';

export const TEMPLATES: SessionTemplate[] = [
    {
        id: "rest_01",
        category: "Rest",
        modality: "None",
        durationMin: 0,
        durationMax: 0,
        title: "Total Rest",
        description: "Focus on sleep, hydration, and completely shutting off physical stress.",
        requiredEquipment: [],
        systemicCost: 0.0,
        objectiveTransferable: true
    },
    {
        id: "mob_01",
        category: "Mobility/Recovery",
        modality: "Mobility",
        durationMin: 15,
        durationMax: 30,
        title: "Active Recovery & Mobility",
        description: "Light stretching, foam rolling, and walking. Keep heart rate strictly low.",
        requiredEquipment: [],
        systemicCost: 0.1,
        objectiveTransferable: true,
        easierDose: {
            label: "10 min Light Foam Rolling",
            durationMin: 10,
            durationMax: 15,
            doseRatio: 0.6,
            prescriptionSummary: "Gentle 10 min stretching and foam rolling."
        },
        harderDose: {
            label: "35 min Mobility & Recovery Walk",
            durationMin: 30,
            durationMax: 40,
            doseRatio: 1.4,
            prescriptionSummary: "Extended 35 min mobility flow and easy leg flush walk."
        }
    },
    {
        id: "mob_02",
        category: "Mobility/Recovery",
        modality: "Mobility",
        durationMin: 20,
        durationMax: 40,
        title: "Yoga & Breathwork Flow",
        description: "Slow flow focused on hip/shoulder mobility and diaphragmatic breathing to downshift the nervous system.",
        requiredEquipment: [],
        systemicCost: 0.1,
        objectiveTransferable: true,
        easierDose: {
            label: "15 min Gentle Breathwork",
            durationMin: 10,
            durationMax: 20,
            doseRatio: 0.6,
            prescriptionSummary: "Short 15 min breathwork and passive stretching."
        },
        harderDose: {
            label: "45 min Deep Mobility Flow",
            durationMin: 40,
            durationMax: 50,
            doseRatio: 1.3,
            prescriptionSummary: "Full 45 min deep mobility and hip flow."
        }
    },
    {
        id: "end_easy_01",
        category: "Easy Endurance",
        modality: "Cycling",
        durationMin: 30,
        durationMax: 60,
        title: "Zone 2 Spin",
        description: "Easy conversational pace on the bike. Great for flushing legs and base building.",
        requiredEquipment: ["indoor_bike"],
        systemicCost: 0.3,
        objectiveTransferable: true,
        easierDose: {
            label: "25 min Light Spin",
            durationMin: 20,
            durationMax: 30,
            doseRatio: 0.6,
            prescriptionSummary: "Light 25 min leg flush spin."
        },
        harderDose: {
            label: "75 min Aerobic Base Ride",
            durationMin: 60,
            durationMax: 90,
            doseRatio: 1.5,
            prescriptionSummary: "Extended 75 min Zone 2 aerobic base ride."
        }
    },
    {
        id: "end_easy_02",
        category: "Easy Endurance",
        modality: "Running",
        durationMin: 20,
        durationMax: 40,
        title: "Light Base Run",
        description: "Very easy jog. Stop and walk if HR drifts above Zone 2.",
        requiredEquipment: [],
        systemicCost: 0.3,
        objectiveTransferable: true,
        easierDose: {
            label: "20 min Short Jog/Walk",
            durationMin: 15,
            durationMax: 25,
            doseRatio: 0.67,
            prescriptionSummary: "Short 20 min easy jog."
        },
        harderDose: {
            label: "50 min Aerobic Base Run",
            durationMin: 45,
            durationMax: 60,
            doseRatio: 1.4,
            prescriptionSummary: "Extended 50 min Zone 2 base run."
        }
    },
    {
        id: "end_easy_03",
        category: "Easy Endurance",
        modality: "Running",
        durationMin: 25,
        durationMax: 45,
        title: "Recovery Walk/Jog Intervals",
        description: "Alternate easy walking and very light jogging. Minimal impact, keeps blood flowing without adding fatigue.",
        requiredEquipment: [],
        systemicCost: 0.25,
        objectiveTransferable: true,
        easierDose: {
            label: "20 min Recovery Walk Focus",
            durationMin: 15,
            durationMax: 25,
            doseRatio: 0.7,
            prescriptionSummary: "Easy walk focus with minimal light jog intervals."
        },
        harderDose: {
            label: "40 min Active Walk/Jog Flow",
            durationMin: 35,
            durationMax: 45,
            doseRatio: 1.3,
            prescriptionSummary: "Longer 40 min active recovery walk/jog."
        }
    },
    {
        id: "end_mod_01",
        category: "Moderate Endurance",
        modality: "Running",
        durationMin: 30,
        durationMax: 50,
        title: "Steady-State Tempo Run",
        description: "Continuous run at a comfortably-hard, sustainable pace (Zone 3). Builds aerobic capacity without CNS strain of intervals.",
        requiredEquipment: [],
        systemicCost: 0.7,
        objectiveTransferable: true,
        easierDose: {
            label: "25 min Short Tempo Run",
            durationMin: 20,
            durationMax: 35,
            doseRatio: 0.75,
            prescriptionSummary: "Shorter 25 min continuous Zone 3 tempo run."
        },
        harderDose: {
            label: "50 min Extended Tempo Run",
            durationMin: 45,
            durationMax: 60,
            doseRatio: 1.25,
            prescriptionSummary: "Extended 50 min continuous Zone 3 tempo run."
        }
    },
    {
        id: "end_mod_02",
        category: "Moderate Endurance",
        modality: "Cycling",
        durationMin: 40,
        durationMax: 60,
        title: "Tempo Ride",
        description: "Steady Zone 3 effort on the bike with a couple of short surges. Solid middle-ground session between easy and hard days.",
        requiredEquipment: ["indoor_bike"],
        systemicCost: 0.7,
        objectiveTransferable: true,
        easierDose: {
            label: "30 min Short Tempo Ride",
            durationMin: 25,
            durationMax: 40,
            doseRatio: 0.75,
            prescriptionSummary: "Shorter 30 min Zone 3 tempo ride."
        },
        harderDose: {
            label: "75 min Extended Tempo Ride",
            durationMin: 60,
            durationMax: 90,
            doseRatio: 1.35,
            prescriptionSummary: "Extended 75 min Zone 3 tempo ride with surges."
        }
    },
    {
        id: "str_upper_01",
        category: "Upper-body Strength",
        modality: "Strength",
        durationMin: 35,
        durationMax: 50,
        title: "Upper Body Push/Pull",
        description: "Bench/overhead press, rows, pull-ups, and accessory arm work. Chest, back, shoulders, and arms.",
        requiredEquipment: ["free_weights"],
        systemicCost: 0.3,
        objectiveTransferable: false,
        easierDose: {
            label: "3 Sets Upper Body (30 min)",
            durationMin: 25,
            durationMax: 35,
            doseRatio: 0.75,
            prescriptionSummary: "Reduced volume: 3 working sets per main push/pull movement."
        },
        harderDose: {
            label: "4 Sets + Core Finisher (55 min)",
            durationMin: 45,
            durationMax: 60,
            doseRatio: 1.25,
            prescriptionSummary: "Increased volume: 4 working sets per movement plus core finisher."
        }
    },
    {
        id: "str_upper_02",
        category: "Upper-body Strength",
        modality: "Strength",
        durationMin: 30,
        durationMax: 45,
        title: "Cable Upper Body Circuit",
        description: "Cable-based presses, pulldowns, and rows for controlled, joint-friendly upper body volume.",
        requiredEquipment: ["cable_machine"],
        systemicCost: 0.3,
        objectiveTransferable: false,
        easierDose: {
            label: "2 Sets Cable Circuit (25 min)",
            durationMin: 20,
            durationMax: 30,
            doseRatio: 0.7,
            prescriptionSummary: "Reduced volume: 2 rounds of cable push/pull circuit."
        },
        harderDose: {
            label: "4 Sets Cable Circuit (50 min)",
            durationMin: 45,
            durationMax: 55,
            doseRatio: 1.3,
            prescriptionSummary: "Increased volume: 4 rounds of cable push/pull circuit."
        }
    },
    {
        id: "str_lower_01",
        category: "Lower-body Strength",
        modality: "Strength",
        durationMin: 40,
        durationMax: 55,
        title: "Lower Body Strength & Power",
        description: "Squats, deadlift variations, lunges, and calf/posterior chain accessory work.",
        requiredEquipment: ["free_weights"],
        systemicCost: 0.6,
        objectiveTransferable: false,
        easierDose: {
            label: "3 Sets Moderate Load (30 min)",
            durationMin: 25,
            durationMax: 35,
            doseRatio: 0.75,
            prescriptionSummary: "Reduced volume: 3 sets per exercise with moderate load."
        },
        harderDose: {
            label: "4 Sets + Plyo Finisher (60 min)",
            durationMin: 50,
            durationMax: 65,
            doseRatio: 1.3,
            prescriptionSummary: "Increased volume: 4 heavy sets plus plyometric finisher."
        }
    },
    {
        id: "str_full_01",
        category: "Full-body Strength",
        modality: "Strength",
        durationMin: 45,
        durationMax: 60,
        title: "Hybrid Full Body Push/Pull",
        description: "Compound movements: Squats, deadlift variations, rows, and presses.",
        requiredEquipment: ["free_weights"],
        systemicCost: 0.6,
        objectiveTransferable: false,
        easierDose: {
            label: "3 Working Sets (35 min)",
            durationMin: 30,
            durationMax: 40,
            doseRatio: 0.75,
            prescriptionSummary: "Reduced volume: 3 working sets per compound lift."
        },
        harderDose: {
            label: "4 Sets + Accessory Circuit (65 min)",
            durationMin: 55,
            durationMax: 70,
            doseRatio: 1.3,
            prescriptionSummary: "Increased volume: 4 working sets plus accessory circuit."
        }
    },
    {
        id: "str_full_02",
        category: "Full-body Strength",
        modality: "Strength",
        durationMin: 30,
        durationMax: 45,
        title: "Bodyweight Full Body Circuit",
        description: "Push-ups, squats, lunges, planks, and rows-via-table/bands. No equipment required, scalable by tempo and reps.",
        requiredEquipment: [],
        systemicCost: 0.55,
        objectiveTransferable: false,
        easierDose: {
            label: "2 Circuit Rounds (20 min)",
            durationMin: 15,
            durationMax: 25,
            doseRatio: 0.67,
            prescriptionSummary: "Reduced volume: 2 rounds of bodyweight circuit."
        },
        harderDose: {
            label: "4 Circuit Rounds (45 min)",
            durationMin: 40,
            durationMax: 50,
            doseRatio: 1.33,
            prescriptionSummary: "Increased volume: 4 high-tempo circuit rounds."
        }
    },
    {
        id: "end_hard_01",
        category: "Hard Endurance",
        modality: "Running",
        durationMin: 30,
        durationMax: 60,
        title: "Interval Speed Work",
        description: "Warm up, then 4x4 minute intervals near threshold. Cool down.",
        requiredEquipment: [],
        systemicCost: 1.0,
        objectiveTransferable: true,
        easierDose: {
            label: "3x4 min Intervals (30 min)",
            durationMin: 25,
            durationMax: 40,
            doseRatio: 0.75,
            prescriptionSummary: "Reduced to 3x4 minute VO2 intervals."
        },
        harderDose: {
            label: "5x4 min Intervals (50 min)",
            durationMin: 40,
            durationMax: 60,
            doseRatio: 1.25,
            prescriptionSummary: "Increased to 5x4 minute VO2 intervals."
        }
    },
    {
        id: "end_hard_02",
        category: "Hard Endurance",
        modality: "Cycling",
        durationMin: 30,
        durationMax: 60,
        title: "Bike VO2 Intervals",
        description: "Warm up, then 6x3 minute high-intensity efforts with equal recovery. Cool down.",
        requiredEquipment: ["indoor_bike"],
        systemicCost: 1.0,
        objectiveTransferable: true,
        easierDose: {
            label: "4x3 min Intervals (35 min)",
            durationMin: 25,
            durationMax: 45,
            doseRatio: 0.67,
            prescriptionSummary: "Reduced to 4x3 minute VO2 intervals."
        },
        harderDose: {
            label: "8x3 min Intervals (60 min)",
            durationMin: 45,
            durationMax: 65,
            doseRatio: 1.33,
            prescriptionSummary: "Increased to 8x3 minute VO2 intervals."
        }
    },
    {
        id: "end_hard_03",
        category: "Hard Endurance",
        modality: "Running",
        durationMin: 35,
        durationMax: 55,
        title: "Hill Repeats",
        description: "Warm up, then 6-8x60-90 second hard hill efforts (outdoors, or treadmill incline) with walk-down recovery. Cool down.",
        requiredEquipment: [],
        systemicCost: 1.0,
        objectiveTransferable: false,
        easierDose: {
            label: "4 Hill Repeats (30 min)",
            durationMin: 25,
            durationMax: 40,
            doseRatio: 0.6,
            prescriptionSummary: "Reduced to 4 hard hill repeats."
        },
        harderDose: {
            label: "10 Hill Repeats (50 min)",
            durationMin: 40,
            durationMax: 60,
            doseRatio: 1.35,
            prescriptionSummary: "Increased to 10 hard hill repeats."
        }
    }
];

// Helper to ensure all templates have typed 6D stimulus & cost profiles
export const ENRICHED_TEMPLATES: SessionTemplate[] = TEMPLATES.map(t => {
    let stimulus = t.stimulusProfile;
    let cost = t.costProfile;

    if (!stimulus) {
        if (t.category === 'Rest') stimulus = { aerobicCapacity: 0, thresholdDevelopment: 0, surgeRepeatability: 0, maxStrength: 0, hypertrophy: 0, mobilityRecovery: 1.0 };
        else if (t.category === 'Mobility/Recovery') stimulus = { aerobicCapacity: 0.1, thresholdDevelopment: 0, surgeRepeatability: 0, maxStrength: 0, hypertrophy: 0, mobilityRecovery: 1.0 };
        else if (t.category === 'Easy Endurance') stimulus = { aerobicCapacity: 0.8, thresholdDevelopment: 0.2, surgeRepeatability: 0, maxStrength: 0, hypertrophy: 0, mobilityRecovery: 0.2 };
        else if (t.category === 'Moderate Endurance') stimulus = { aerobicCapacity: 0.7, thresholdDevelopment: 0.8, surgeRepeatability: 0.3, maxStrength: 0, hypertrophy: 0, mobilityRecovery: 0 };
        else if (t.category === 'Hard Endurance') stimulus = { aerobicCapacity: 0.6, thresholdDevelopment: 0.8, surgeRepeatability: 1.0, maxStrength: 0, hypertrophy: 0, mobilityRecovery: 0 };
        else if (t.category === 'Upper-body Strength') stimulus = { aerobicCapacity: 0, thresholdDevelopment: 0, surgeRepeatability: 0.2, maxStrength: 0.8, hypertrophy: 0.8, mobilityRecovery: 0.2 };
        else if (t.category === 'Lower-body Strength') stimulus = { aerobicCapacity: 0, thresholdDevelopment: 0, surgeRepeatability: 0.2, maxStrength: 0.9, hypertrophy: 0.8, mobilityRecovery: 0.2 };
        else stimulus = { aerobicCapacity: 0.2, thresholdDevelopment: 0.3, surgeRepeatability: 0.4, maxStrength: 0.8, hypertrophy: 0.7, mobilityRecovery: 0.2 };
    }

    if (!cost) {
        if (t.category === 'Rest') cost = { systemic: 0, cardiovascular: 0, lowerBody: 0, upperBody: 0, impactTissue: 0, neuromuscular: 0 };
        else if (t.category === 'Mobility/Recovery') cost = { systemic: 0.1, cardiovascular: 0.1, lowerBody: 0.1, upperBody: 0.1, impactTissue: 0.1, neuromuscular: 0.1 };
        else if (t.category === 'Easy Endurance') {
            cost = { systemic: 0.3, cardiovascular: 0.3, lowerBody: 0.3, upperBody: 0.05, impactTissue: t.modality === 'Running' ? 0.5 : 0.1, neuromuscular: 0.1 };
        } else if (t.category === 'Moderate Endurance') {
            cost = { systemic: 0.6, cardiovascular: 0.6, lowerBody: 0.5, upperBody: 0.1, impactTissue: t.modality === 'Running' ? 0.7 : 0.2, neuromuscular: 0.4 };
        } else if (t.category === 'Hard Endurance') {
            cost = { systemic: 1.0, cardiovascular: 1.0, lowerBody: 0.8, upperBody: 0.1, impactTissue: t.modality === 'Running' ? 0.9 : 0.3, neuromuscular: 0.8 };
        } else if (t.category === 'Upper-body Strength') {
            cost = { systemic: 0.4, cardiovascular: 0.2, lowerBody: 0.0, upperBody: 0.9, impactTissue: 0.1, neuromuscular: 0.5 };
        } else if (t.category === 'Lower-body Strength') {
            cost = { systemic: 0.8, cardiovascular: 0.3, lowerBody: 1.0, upperBody: 0.1, impactTissue: 0.4, neuromuscular: 0.9 };
        } else {
            cost = { systemic: 0.8, cardiovascular: 0.4, lowerBody: 0.8, upperBody: 0.8, impactTissue: 0.5, neuromuscular: 0.8 };
        }
    }

    return {
        ...t,
        stimulusProfile: stimulus,
        costProfile: cost,
    };
});

