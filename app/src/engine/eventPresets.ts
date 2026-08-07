import type { EventDemandProfile, UserEvent } from './models';

/** Deliberately not imported from periodization.ts's DEFAULT_BASE_DEMAND -- that module
 *  imports resolveDemandProfile back from this one (goalToUserEvent), and a live binding
 *  to a const across that cycle would read as uninitialized at module-eval time. Same
 *  neutral values, kept as an independent literal. */
const GENERIC_BASE_DEMAND: EventDemandProfile = {
    aerobicEndurance: 0.8,
    thresholdPower: 0.5,
    vo2MaxPower: 0.3,
    repeatedSurges: 0.3,
    sprintPower: 0.2,
    fatigueResistance: 0.5,
    neuromuscular: 0.4,
};

export interface EventPreset {
    id: string;
    label: string;
    demandProfile: EventDemandProfile;
}

/**
 * Extensible preset registry: one broad `UserEvent['category']` isn't enough to
 * determine a useful demand vector (a criterium and a gran fondo are both
 * 'cycling_event' but need very different training emphasis). Each category exposes a
 * short list of presets; the first entry is that category's default. `resolveDemandProfile`
 * is the only place a demand vector is produced -- goals never persist one (see
 * UserGoal.eventPreset in models.ts), so recalibrating a preset here takes effect for
 * every goal using it immediately, with no data migration.
 */
export const EVENT_PRESETS: Record<UserEvent['category'], EventPreset[]> = {
    cycling_event: [
        {
            id: 'road_race',
            label: 'Road race',
            demandProfile: { aerobicEndurance: 0.8, thresholdPower: 0.75, vo2MaxPower: 0.4, repeatedSurges: 0.6, sprintPower: 0.3, fatigueResistance: 0.8, neuromuscular: 0.3 },
        },
        {
            id: 'criterium',
            label: 'Criterium',
            demandProfile: { aerobicEndurance: 0.5, thresholdPower: 0.5, vo2MaxPower: 0.85, repeatedSurges: 0.9, sprintPower: 0.7, fatigueResistance: 0.5, neuromuscular: 0.6 },
        },
        {
            id: 'time_trial',
            label: 'Time trial',
            demandProfile: { aerobicEndurance: 0.6, thresholdPower: 0.95, vo2MaxPower: 0.5, repeatedSurges: 0.1, sprintPower: 0.1, fatigueResistance: 0.6, neuromuscular: 0.2 },
        },
        {
            id: 'gran_fondo',
            label: 'Gran fondo / sportive',
            demandProfile: { aerobicEndurance: 0.95, thresholdPower: 0.55, vo2MaxPower: 0.2, repeatedSurges: 0.3, sprintPower: 0.1, fatigueResistance: 0.9, neuromuscular: 0.1 },
        },
        {
            id: 'gravel',
            label: 'Gravel race',
            demandProfile: { aerobicEndurance: 0.9, thresholdPower: 0.6, vo2MaxPower: 0.25, repeatedSurges: 0.4, sprintPower: 0.15, fatigueResistance: 0.95, neuromuscular: 0.4 },
        },
    ],
    running_race: [
        {
            id: '5k',
            label: '5K',
            demandProfile: { aerobicEndurance: 0.5, thresholdPower: 0.7, vo2MaxPower: 0.9, repeatedSurges: 0.3, sprintPower: 0.3, fatigueResistance: 0.4, neuromuscular: 0.3 },
        },
        {
            id: '10k',
            label: '10K',
            demandProfile: { aerobicEndurance: 0.65, thresholdPower: 0.85, vo2MaxPower: 0.7, repeatedSurges: 0.2, sprintPower: 0.15, fatigueResistance: 0.55, neuromuscular: 0.15 },
        },
        {
            id: 'half_marathon',
            label: 'Half marathon',
            demandProfile: { aerobicEndurance: 0.85, thresholdPower: 0.8, vo2MaxPower: 0.35, repeatedSurges: 0.1, sprintPower: 0.05, fatigueResistance: 0.8, neuromuscular: 0.1 },
        },
        {
            id: 'marathon',
            label: 'Marathon',
            demandProfile: { aerobicEndurance: 0.95, thresholdPower: 0.65, vo2MaxPower: 0.2, repeatedSurges: 0.05, sprintPower: 0.05, fatigueResistance: 0.95, neuromuscular: 0.1 },
        },
        {
            id: 'ultra',
            label: 'Ultra',
            demandProfile: { aerobicEndurance: 0.95, thresholdPower: 0.4, vo2MaxPower: 0.1, repeatedSurges: 0.05, sprintPower: 0.05, fatigueResistance: 1.0, neuromuscular: 0.2 },
        },
    ],
    triathlon: [
        {
            id: 'sprint',
            label: 'Sprint',
            demandProfile: { aerobicEndurance: 0.6, thresholdPower: 0.75, vo2MaxPower: 0.6, repeatedSurges: 0.3, sprintPower: 0.2, fatigueResistance: 0.5, neuromuscular: 0.2 },
        },
        {
            id: 'olympic',
            label: 'Olympic',
            demandProfile: { aerobicEndurance: 0.75, thresholdPower: 0.8, vo2MaxPower: 0.45, repeatedSurges: 0.2, sprintPower: 0.1, fatigueResistance: 0.65, neuromuscular: 0.15 },
        },
        {
            id: 'half_iron',
            label: 'Half iron (70.3)',
            demandProfile: { aerobicEndurance: 0.9, thresholdPower: 0.7, vo2MaxPower: 0.25, repeatedSurges: 0.1, sprintPower: 0.05, fatigueResistance: 0.85, neuromuscular: 0.1 },
        },
        {
            id: 'iron',
            label: 'Iron distance',
            demandProfile: { aerobicEndurance: 0.98, thresholdPower: 0.55, vo2MaxPower: 0.15, repeatedSurges: 0.05, sprintPower: 0.05, fatigueResistance: 1.0, neuromuscular: 0.1 },
        },
    ],
    strength_meet: [
        {
            id: 'powerlifting',
            label: 'Powerlifting meet',
            demandProfile: { aerobicEndurance: 0.1, thresholdPower: 0.1, vo2MaxPower: 0.05, repeatedSurges: 0.1, sprintPower: 0.3, fatigueResistance: 0.2, neuromuscular: 0.95 },
        },
        {
            id: 'general',
            label: 'General strength test',
            demandProfile: { aerobicEndurance: 0.15, thresholdPower: 0.15, vo2MaxPower: 0.1, repeatedSurges: 0.15, sprintPower: 0.35, fatigueResistance: 0.25, neuromuscular: 0.8 },
        },
    ],
    general_target: [
        {
            id: 'generic',
            label: 'General target',
            demandProfile: GENERIC_BASE_DEMAND,
        },
    ],
};

/** Resolves to `preset`'s demand profile if it exists under `category`, else that
 *  category's first (default) preset. Never throws on an unknown/stale preset id --
 *  falls back gracefully so an old goal doc referencing a since-removed preset id still
 *  resolves to something reasonable. */
export function resolveDemandProfile(category: UserEvent['category'], preset: string | null | undefined): EventDemandProfile {
    const presets = EVENT_PRESETS[category];
    return presets.find(p => p.id === preset)?.demandProfile ?? presets[0].demandProfile;
}
