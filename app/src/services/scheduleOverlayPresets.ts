import type {
    ScheduleOverlayCategory,
    ScheduleOverlaySport,
    TrainingEnvironment,
    WorkoutCostProfile,
} from '../engine/models';

export interface ScheduleOverlayPreset {
    id: string;
    title: string;
    label: string;
    description: string;
    icon: string;
    category: ScheduleOverlayCategory;
    sport?: ScheduleOverlaySport;
    dailyAvailabilityMinutes: number;
    volumeScale: number;
    intensityScale: number;
    expectedCost: WorkoutCostProfile;
    environment?: TrainingEnvironment;
}

/** Presets intentionally omit `equipment`: omission means "do not change the athlete's
 * standing equipment access". An explicit empty list would instead mean no equipment is
 * available and would eliminate every equipment-requiring candidate for the date. */
export const SCHEDULE_OVERLAY_PRESETS: readonly ScheduleOverlayPreset[] = [
    {
        id: 'active_skiing',
        title: 'Skiing Trip',
        label: 'Skiing / Snowboarding',
        description: 'Heavy eccentric quad loading and cold stress. Pauses structured training and protects legs upon return.',
        icon: '⛷️',
        category: 'active_sport',
        sport: 'skiing',
        dailyAvailabilityMinutes: 0,
        volumeScale: 0.0,
        intensityScale: 0.0,
        expectedCost: {
            systemic: 0.7,
            cardiovascular: 0.5,
            lowerBody: 0.85,
            upperBody: 0.15,
            impactTissue: 0.4,
            neuromuscular: 0.5,
        },
        environment: 'outdoor',
    },
    {
        id: 'active_volleyball',
        title: 'Volleyball / Court Match',
        label: 'Volleyball / Basketball',
        description: 'Plyometric jumping, landing shock, and shoulder rotational stress.',
        icon: '🏐',
        category: 'active_sport',
        sport: 'volleyball',
        dailyAvailabilityMinutes: 0,
        volumeScale: 0.0,
        intensityScale: 0.0,
        expectedCost: {
            systemic: 0.5,
            cardiovascular: 0.6,
            lowerBody: 0.65,
            upperBody: 0.5,
            impactTissue: 0.6,
            neuromuscular: 0.7,
        },
        environment: 'indoor',
    },
    {
        id: 'active_hiking',
        title: 'Mountain Hiking',
        label: 'Hiking / Trekking',
        description: 'Prolonged steady aerobic load, elevation climb, and joint impact over several hours.',
        icon: '🥾',
        category: 'active_sport',
        sport: 'hiking',
        dailyAvailabilityMinutes: 0,
        volumeScale: 0.0,
        intensityScale: 0.0,
        expectedCost: {
            systemic: 0.6,
            cardiovascular: 0.5,
            lowerBody: 0.6,
            upperBody: 0.2,
            impactTissue: 0.5,
            neuromuscular: 0.4,
        },
        environment: 'outdoor',
    },
    {
        id: 'sedentary_holiday',
        title: 'Christmas / Holiday',
        label: 'Holiday / Family Rest Day',
        description: 'Full rest from structured training with zero physical load. Blackouts weekly anchors.',
        icon: '🎄',
        category: 'sedentary_rest',
        dailyAvailabilityMinutes: 0,
        volumeScale: 0.0,
        intensityScale: 0.0,
        expectedCost: {
            systemic: 0.0,
            cardiovascular: 0.0,
            lowerBody: 0.0,
            upperBody: 0.0,
            impactTissue: 0.0,
            neuromuscular: 0.0,
        },
        environment: 'indoor',
    },
    {
        id: 'sedentary_travel',
        title: 'Travel / Transit',
        label: 'Travel / Flight Day',
        description: 'En route / sitting in transit. Accounts for mild travel strain, zero training availability.',
        icon: '✈️',
        category: 'sedentary_rest',
        dailyAvailabilityMinutes: 0,
        volumeScale: 0.0,
        intensityScale: 0.0,
        expectedCost: {
            systemic: 0.3,
            cardiovascular: 0.0,
            lowerBody: 0.0,
            upperBody: 0.0,
            impactTissue: 0.0,
            neuromuscular: 0.0,
        },
        environment: 'indoor',
    },
    {
        id: 'high_step_city_break',
        title: 'City Sightseeing',
        label: 'City Break / Sightseeing (15k–25k steps)',
        description: 'High time on feet and skeletal impact accumulation. Suppresses road running, preserves recovery.',
        icon: '🚶',
        category: 'high_step_walking',
        dailyAvailabilityMinutes: 30,
        volumeScale: 0.2,
        intensityScale: 0.3,
        expectedCost: {
            systemic: 0.4,
            cardiovascular: 0.2,
            lowerBody: 0.3,
            upperBody: 0.0,
            impactTissue: 0.55,
            neuromuscular: 0.2,
        },
        environment: 'outdoor',
    },
    {
        id: 'limited_busy_work',
        title: 'Busy Period',
        label: 'Time Crunch / Busy Days',
        description: 'Short 20-30 min windows only. Scales volume down while permitting short quality or mobility work.',
        icon: '⏱️',
        category: 'limited_availability',
        dailyAvailabilityMinutes: 30,
        volumeScale: 0.4,
        intensityScale: 0.7,
        expectedCost: {
            systemic: 0.0,
            cardiovascular: 0.0,
            lowerBody: 0.0,
            upperBody: 0.0,
            impactTissue: 0.0,
            neuromuscular: 0.0,
        },
    },
];
