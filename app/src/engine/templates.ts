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
        requiredEquipment: []
    },
    {
        id: "mob_01",
        category: "Mobility/Recovery",
        modality: "Mobility",
        durationMin: 15,
        durationMax: 30,
        title: "Active Recovery & Mobility",
        description: "Light stretching, foam rolling, and walking. Keep heart rate strictly low.",
        requiredEquipment: []
    },
    {
        id: "mob_02",
        category: "Mobility/Recovery",
        modality: "Mobility",
        durationMin: 20,
        durationMax: 40,
        title: "Yoga & Breathwork Flow",
        description: "Slow flow focused on hip/shoulder mobility and diaphragmatic breathing to downshift the nervous system.",
        requiredEquipment: []
    },
    {
        id: "end_easy_01",
        category: "Easy Endurance",
        modality: "Cycling",
        durationMin: 30,
        durationMax: 60,
        title: "Zone 2 Spin",
        description: "Easy conversational pace on the bike. Great for flushing legs and base building.",
        requiredEquipment: ["indoor_bike"]
    },
    {
        id: "end_easy_02",
        category: "Easy Endurance",
        modality: "Running",
        durationMin: 20,
        durationMax: 40,
        title: "Light Base Run",
        description: "Very easy jog. Stop and walk if HR drifts above Zone 2.",
        requiredEquipment: []
    },
    {
        id: "end_easy_03",
        category: "Easy Endurance",
        modality: "Running",
        durationMin: 25,
        durationMax: 45,
        title: "Recovery Walk/Jog Intervals",
        description: "Alternate easy walking and very light jogging. Minimal impact, keeps blood flowing without adding fatigue.",
        requiredEquipment: []
    },
    {
        id: "end_mod_01",
        category: "Moderate Endurance",
        modality: "Running",
        durationMin: 30,
        durationMax: 50,
        title: "Steady-State Tempo Run",
        description: "Continuous run at a comfortably-hard, sustainable pace (Zone 3). Builds aerobic capacity without CNS strain of intervals.",
        requiredEquipment: []
    },
    {
        id: "end_mod_02",
        category: "Moderate Endurance",
        modality: "Cycling",
        durationMin: 40,
        durationMax: 60,
        title: "Tempo Ride",
        description: "Steady Zone 3 effort on the bike with a couple of short surges. Solid middle-ground session between easy and hard days.",
        requiredEquipment: ["indoor_bike"]
    },
    {
        id: "str_upper_01",
        category: "Upper-body Strength",
        modality: "Strength",
        durationMin: 35,
        durationMax: 50,
        title: "Upper Body Push/Pull",
        description: "Bench/overhead press, rows, pull-ups, and accessory arm work. Chest, back, shoulders, and arms.",
        requiredEquipment: ["free_weights"]
    },
    {
        id: "str_upper_02",
        category: "Upper-body Strength",
        modality: "Strength",
        durationMin: 30,
        durationMax: 45,
        title: "Cable Upper Body Circuit",
        description: "Cable-based presses, pulldowns, and rows for controlled, joint-friendly upper body volume.",
        requiredEquipment: ["cable_machine"]
    },
    {
        id: "str_lower_01",
        category: "Lower-body Strength",
        modality: "Strength",
        durationMin: 40,
        durationMax: 55,
        title: "Lower Body Strength & Power",
        description: "Squats, deadlift variations, lunges, and calf/posterior chain accessory work.",
        requiredEquipment: ["free_weights"]
    },
    {
        id: "str_full_01",
        category: "Full-body Strength",
        modality: "Strength",
        durationMin: 45,
        durationMax: 60,
        title: "Hybrid Full Body Push/Pull",
        description: "Compound movements: Squats, deadlift variations, rows, and presses.",
        requiredEquipment: ["free_weights"]
    },
    {
        id: "str_full_02",
        category: "Full-body Strength",
        modality: "Strength",
        durationMin: 30,
        durationMax: 45,
        title: "Bodyweight Full Body Circuit",
        description: "Push-ups, squats, lunges, planks, and rows-via-table/bands. No equipment required, scalable by tempo and reps.",
        requiredEquipment: []
    },
    {
        id: "end_hard_01",
        category: "Hard Endurance",
        modality: "Running",
        durationMin: 30,
        durationMax: 60,
        title: "Interval Speed Work",
        description: "Warm up, then 4x4 minute intervals near threshold. Cool down.",
        requiredEquipment: []
    },
    {
        id: "end_hard_02",
        category: "Hard Endurance",
        modality: "Cycling",
        durationMin: 30,
        durationMax: 60,
        title: "Bike VO2 Intervals",
        description: "Warm up, then 6x3 minute high-intensity efforts with equal recovery. Cool down.",
        requiredEquipment: ["indoor_bike"]
    },
    {
        id: "end_hard_03",
        category: "Hard Endurance",
        modality: "Running",
        durationMin: 35,
        durationMax: 55,
        title: "Hill Repeats",
        description: "Warm up, then 6-8x60-90 second hard hill efforts (outdoors, or treadmill incline) with walk-down recovery. Cool down.",
        requiredEquipment: []
    }
];
