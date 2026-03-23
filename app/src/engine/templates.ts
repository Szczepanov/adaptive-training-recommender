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
        id: "end_hard_01",
        category: "Hard Endurance",
        modality: "Running",
        durationMin: 30,
        durationMax: 60,
        title: "Interval Speed Work",
        description: "Warm up, then 4x4 minute intervals near threshold. Cool down.",
        requiredEquipment: []
    }
];
