import type {
    EventDemandProfile,
    UserEvent,
} from './models';

export interface PhaseWeights {
    phaseName: 'Base' | 'Build' | 'Specificity' | 'Peak/Taper' | 'Post-Event Recovery';
    targetDemandVector: EventDemandProfile;
    volumeScale: number;    // 0.5 - 1.2
    intensityScale: number; // 0.5 - 1.2
    taperActive: boolean;
}

export const DEFAULT_BASE_DEMAND: EventDemandProfile = {
    aerobicEndurance: 0.8,
    thresholdPower: 0.5,
    vo2MaxPower: 0.3,
    repeatedSurges: 0.3,
    sprintPower: 0.2,
    fatigueResistance: 0.5,
    neuromuscular: 0.4,
};

function getDaysBetween(date1Str: string, date2Str: string): number {
    const d1 = new Date(date1Str + 'T00:00:00');
    const d2 = new Date(date2Str + 'T00:00:00');
    const diffTime = d2.getTime() - d1.getTime();
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

function blendDemand(base: EventDemandProfile, eventDemand: EventDemandProfile, eventWeight: number): EventDemandProfile {
    const w = Math.max(0, Math.min(1, eventWeight));
    const bW = 1 - w;
    return {
        aerobicEndurance: base.aerobicEndurance * bW + eventDemand.aerobicEndurance * w,
        thresholdPower: base.thresholdPower * bW + eventDemand.thresholdPower * w,
        vo2MaxPower: base.vo2MaxPower * bW + eventDemand.vo2MaxPower * w,
        repeatedSurges: base.repeatedSurges * bW + eventDemand.repeatedSurges * w,
        sprintPower: base.sprintPower * bW + eventDemand.sprintPower * w,
        fatigueResistance: base.fatigueResistance * bW + eventDemand.fatigueResistance * w,
        neuromuscular: base.neuromuscular * bW + eventDemand.neuromuscular * w,
    };
}

/**
 * Evaluates training phase & continuous demand weights for a given date.
 * Resolves multi-event conflicts:
 * - A-Events dictate primary taper and phase transitions
 * - B-Events receive targeted specificity without compromising A-event tapers
 * - C-Events are train-through / participation (do not trigger tapers)
 * - Ignores non-active event lifecycles (cancelled, DNS)
 */
export function evaluatePeriodizationPhase(
    events: UserEvent[],
    currentDateStr: string
): PhaseWeights {
    // 1. Filter active scheduled events
    const activeEvents = events.filter(e => e.lifecycle === 'scheduled');
    if (activeEvents.length === 0) {
        return {
            phaseName: 'Base',
            targetDemandVector: DEFAULT_BASE_DEMAND,
            volumeScale: 1.0,
            intensityScale: 0.8,
            taperActive: false,
        };
    }

    // 2. Resolve primary event by Priority (A > B > C) and then Proximity
    const sortedEvents = [...activeEvents].sort((a, b) => {
        const prioMap = { A: 1, B: 2, C: 3 };
        if (prioMap[a.priority] !== prioMap[b.priority]) {
            return prioMap[a.priority] - prioMap[b.priority];
        }
        return new Date(a.date).getTime() - new Date(b.date).getTime();
    });

    const primaryEvent = sortedEvents[0];
    const daysToEvent = getDaysBetween(currentDateStr, primaryEvent.date);

    // 3. Evaluate Phase Transitions & Continuous Demand Weightings
    if (daysToEvent < 0) {
        // Event has passed but lifecycle hasn't updated -- check if recent (< 3 days)
        if (daysToEvent >= -3 && primaryEvent.priority === 'A') {
            return {
                phaseName: 'Post-Event Recovery',
                targetDemandVector: DEFAULT_BASE_DEMAND,
                volumeScale: 0.4,
                intensityScale: 0.4,
                taperActive: false,
            };
        }
        return {
            phaseName: 'Base',
            targetDemandVector: DEFAULT_BASE_DEMAND,
            volumeScale: 1.0,
            intensityScale: 0.8,
            taperActive: false,
        };
    }

    // Taper threshold: A-Events taper up to 14 days, B-Events up to 5 days, C-Events 0 days (train-through)
    const taperWindowDays = primaryEvent.priority === 'A' ? 14 : (primaryEvent.priority === 'B' ? 5 : 0);

    if (taperWindowDays > 0 && daysToEvent <= taperWindowDays) {
        const taperProgress = 1 - (daysToEvent / taperWindowDays);
        return {
            phaseName: 'Peak/Taper',
            targetDemandVector: primaryEvent.demandProfile,
            volumeScale: 1.0 - (0.4 * taperProgress), // Smooth volume reduction up to -40%
            intensityScale: 1.0,
            taperActive: true,
        };
    }

    if (daysToEvent <= 35) {
        // Specificity Phase
        return {
            phaseName: 'Specificity',
            targetDemandVector: primaryEvent.demandProfile,
            volumeScale: 1.0,
            intensityScale: 1.1,
            taperActive: false,
        };
    }

    if (daysToEvent <= 84) {
        // Build Phase: Blend event demand with base
        return {
            phaseName: 'Build',
            targetDemandVector: blendDemand(DEFAULT_BASE_DEMAND, primaryEvent.demandProfile, 0.6),
            volumeScale: 1.1,
            intensityScale: 0.9,
            taperActive: false,
        };
    }

    // Early Base Phase (> 12 weeks out)
    return {
        phaseName: 'Base',
        targetDemandVector: blendDemand(DEFAULT_BASE_DEMAND, primaryEvent.demandProfile, 0.3),
        volumeScale: 1.0,
        intensityScale: 0.8,
        taperActive: false,
    };
}
