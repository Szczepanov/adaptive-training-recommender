import { describe, expect, it } from 'vitest';
import type { ActivityOverride, DailyRecommendation, NormalizedGarminActivity, TrainingSettings } from './models';
import {
    deriveExposureLedger,
    MAX_STRESSOR_ROWS,
    renderExposureLedger,
    type CapabilityEntry,
    type ExposureLedgerInput,
} from './contextBriefExposureLedger';
import { reconcileCompletedTrainingEvents } from './completedTraining';
import { buildContextBrief } from './contextBrief';
import type { PerformedExposureFact } from './performedTrainingFacts';

const AS_OF = '2026-09-24';
const START = '2026-09-11';

function activity(overrides: Partial<NormalizedGarminActivity>): NormalizedGarminActivity {
    return {
        activityId: 'a', date: '2026-09-20', type: 'cycling', durationMin: 60,
        trainingEffectAerobic: 2.5, trainingEffectAnaerobic: 0.2, averageHr: 130,
        activityTrainingLoad: 80, intensityTag: 'easy', intensityClassificationVersion: 2,
        stimulusDomain: 'endurance', sessionCost: 'low', ...overrides,
    };
}

function recommendation(overrides: Partial<DailyRecommendation>): DailyRecommendation {
    return {
        userId: 'athlete', date: '2026-09-24', templateId: 'str_lower_01', templateTitle: 'Lower body',
        category: 'Lower-body Strength', modality: 'Strength', mode: 'train', rationale: 'test', schemaVersion: 1,
        createdAt: '', updatedAt: '',
        adherence: { respondedAt: null, followed: null, actualModality: null, actualDurationMin: null, skipped: false, notes: null },
        ...overrides,
    };
}

function settings(overrides: Partial<TrainingSettings> = {}): TrainingSettings {
    return {
        userId: 'athlete', schemaVersion: 3,
        equipment: { cable_machine: false, free_weights: true, indoor_bike: true, pullup_bar: false, treadmill: false } as unknown as TrainingSettings['equipment'],
        guardrails: { avoid_high_impact: false, avoid_heavy_lower_body: false, avoid_overhead_pressing: false, avoid_heavy_spinal_loading: false },
        defaults: { weekdayMaxMinutes: 90, weekendMaxMinutes: 240, environment: 'either' },
        preferences: { preferActiveRecovery: false },
        migration: { legacyReviewed: true, migratedAt: null },
        createdAt: '', updatedAt: '',
        ...overrides,
    } as TrainingSettings;
}

function input(overrides: Partial<ExposureLedgerInput> = {}): ExposureLedgerInput {
    return {
        asOfDate: AS_OF, lookbackStart: START, activities: [], recommendations: [],
        activitiesReadable: true, recommendationsReadable: true, activityOverrides: {}, performedFacts: [], plannedSessions: [],
        trainingSettings: settings(), preferences: null, ...overrides,
    };
}

const cap = (entries: readonly CapabilityEntry[], key: string): CapabilityEntry => {
    const found = entries.find(entry => entry.key === key);
    if (!found) throw new Error(`missing capability ${key}`);
    return found;
};

const mixedWeek = [
    activity({ activityId: 'race', date: '2026-09-13', intensityTag: 'hard', stimulusDomain: 'race', sessionCost: 'very_high', durationMin: 150, trainingEffectAerobic: 4.8, trainingEffectAnaerobic: 3.1, activityTrainingLoad: 320 }),
    activity({ activityId: 'thr', date: '2026-09-18', intensityTag: 'hard', stimulusDomain: 'threshold', sessionCost: 'moderate', trainingEffectAerobic: 3.9 }),
    activity({ activityId: 'z2long', date: '2026-09-21', intensityTag: 'easy', stimulusDomain: 'endurance', sessionCost: 'high', durationMin: 240, activityTrainingLoad: 210, trainingEffectAerobic: 3.4 }),
    activity({ activityId: 'z2short', date: '2026-09-22', intensityTag: 'easy', stimulusDomain: 'endurance', sessionCost: 'low' }),
    activity({ activityId: 'gym', date: '2026-09-23', type: 'strength_training', intensityTag: 'moderate', stimulusDomain: 'strength', sessionCost: 'moderate', durationMin: 50 }),
];

describe('exposure ledger (#813)', () => {
    it('renders a mixed race/strength/endurance week without calling every session hard', () => {
        const ledger = deriveExposureLedger(input({ activities: mixedWeek }));
        const families = ledger.stressors.map(s => `${s.date} ${s.family}`);
        expect(families).toEqual([
            '2026-09-13 cycling race',
            '2026-09-18 cycling quality',
            '2026-09-21 cycling high-dose aerobic — not a high-intensity stimulus',
            '2026-09-23 strength — musculoskeletal load confirmed; exact lower-body dose unknown',
        ]);
        expect(ledger.omittedLowCostSessions).toBe(1);
        const z2 = ledger.stressors.find(s => s.date === '2026-09-21')!;
        expect(z2.stimulus).toBe('easy stimulus (endurance)');
        expect(z2.sessionCost).toBe('high session cost');
        expect(ledger.stressors.find(s => s.date === '2026-09-13')!.sessionCost).toBe('very high session cost');
    });

    it('reports the engine cost vector split into systemic and mechanical parts, unchanged', () => {
        const ledger = deriveExposureLedger(input({ activities: mixedWeek }));
        const engineEvent = reconcileCompletedTrainingEvents([mixedWeek[0]], [])[0];
        const race = ledger.stressors[0];
        expect(race.systemic).toBe(`systemic ${engineEvent.estimatedCost.systemic.toFixed(1)} · cardiovascular ${engineEvent.estimatedCost.cardiovascular.toFixed(1)}`);
        expect(race.mechanical).toContain(`impact ${engineEvent.estimatedCost.impactTissue.toFixed(1)}`);
        expect(race.provenance).toContain('Garmin measured effort');
        expect(race.confidence).toBe('inferred');
    });

    it('confirms strength with exact provenance only when the prescribed session was confirmed followed', () => {
        const followed = recommendation({ adherence: { respondedAt: 'x', followed: true, actualModality: null, actualDurationMin: 45, skipped: false, notes: null } });
        const ledger = deriveExposureLedger(input({ recommendations: [followed] }));
        const strength = cap(ledger.capabilities, 'strength');
        expect(strength.status).toBe('confirmed');
        expect(strength.lastConfirmedProvenance).toContain('prescribed session confirmed followed');
        expect(strength.lastConfirmedProvenance).toContain('exact');
        expect(ledger.stressors[0].family).toBe('strength — Lower-body Strength (prescribed template)');
    });

    it('never counts a prescribed-but-unperformed or planned strength session as completed', () => {
        const unanswered = recommendation({});
        const skipped = recommendation({ date: '2026-09-22', adherence: { respondedAt: 'x', followed: false, actualModality: null, actualDurationMin: null, skipped: true, notes: null } });
        const ledger = deriveExposureLedger(input({
            recommendations: [unanswered, skipped],
            plannedSessions: [{ date: '2026-09-26', modality: 'strength', intensity: 'moderate', title: 'Gym A' }],
        }));
        const strength = cap(ledger.capabilities, 'strength');
        expect(strength.status).toBe('planned');
        expect(strength.lastConfirmed).toBeNull();
        expect(strength.nextPlanned).toBe('2026-09-26');
        expect(ledger.stressors).toEqual([]);
    });

    it('keeps running, impact and COD distinct: cycling satisfies none of them', () => {
        const ledger = deriveExposureLedger(input({ activities: mixedWeek }));
        expect(cap(ledger.capabilities, 'running').status).toBe('unknown');
        expect(cap(ledger.capabilities, 'field').status).toBe('unknown');
        expect(cap(ledger.capabilities, 'impact_jump').status).toBe('unknown');
        expect(cap(ledger.capabilities, 'cod_lateral').status).toBe('unknown');
        expect(cap(ledger.capabilities, 'aerobic_endurance').lastConfirmed).toBe('2026-09-22');
        expect(cap(ledger.capabilities, 'cycling_quality').lastConfirmed).toBe('2026-09-18');
        expect(ledger.capabilities.some(entry => entry.status === 'overdue')).toBe(false);
    });

    it('reports impact as deliberately suspended under an active safety limit, not neglected', () => {
        const guarded = settings({ injuries: [{ region: 'achilles', severity: 'limit' }] as TrainingSettings['injuries'] });
        const ledger = deriveExposureLedger(input({ trainingSettings: guarded }));
        for (const key of ['running', 'field', 'impact_jump', 'cod_lateral']) {
            expect(cap(ledger.capabilities, key).status).toBe('deliberately_suspended');
        }
        expect(cap(ledger.capabilities, 'strength').status).toBe('unknown');
        const unavailable = deriveExposureLedger(input({ preferences: { unavailableModalities: ['Strength'] } as never }));
        expect(cap(unavailable.capabilities, 'strength').status).toBe('deliberately_suspended');
    });

    it('reflects athlete reclassification with provenance and does not claim the engine uses it', () => {
        const override: ActivityOverride = {
            activityId: 'misc', userId: 'athlete', date: '2026-09-19', originalType: 'other', originalIntensityTag: 'moderate',
            overriddenModality: 'Running', overriddenIntensity: 'easy', createdAt: '', updatedAt: '',
        };
        const ledger = deriveExposureLedger(input({
            activities: [activity({ activityId: 'misc', date: '2026-09-19', type: 'other', stimulusDomain: 'unknown' })],
            activityOverrides: { misc: override },
        }));
        const running = cap(ledger.capabilities, 'running');
        expect(running.status).toBe('confirmed');
        expect(running.lastConfirmedProvenance).toContain('athlete reclassified other/moderate → Running/easy');
        expect(running.lastConfirmedProvenance).toContain('display only');
        expect(ledger.stressors[0].provenance).toContain('engine records Unknown/easy, cost row easy');
    });

    it('keeps unknown data unknown when sources are unreadable or history is missing', () => {
        const empty = deriveExposureLedger(input());
        expect(empty.stressors).toEqual([]);
        expect(empty.capabilities.every(entry => entry.lastConfirmed === null)).toBe(true);
        expect(empty.capabilities.every(entry => entry.status === 'unknown')).toBe(true);

        const unreadable = deriveExposureLedger(input({
            activities: [], activitiesReadable: false, activityOverrides: null, performedFacts: null, plannedSessions: null, trainingSettings: null,
        }));
        expect(unreadable.capabilities.every(entry => entry.lastConfirmed === null)).toBe(true);
        expect(unreadable.notes.join(' ')).toMatch(/unknown, not absent/);
        expect(unreadable.notes.join(' ')).toMatch(/reclassifications were unreadable/);
        expect(unreadable.notes.join(' ')).toMatch(/safety suspensions are unknown/);
    });

    it('stays bounded and far smaller than the per-session telemetry it summarizes', () => {
        const many = Array.from({ length: 30 }, (_, i) => activity({
            activityId: `r${i}`, date: `2026-09-${String(11 + (i % 14)).padStart(2, '0')}`, intensityTag: 'hard', stimulusDomain: 'vo2', sessionCost: 'high',
        }));
        const lines = renderExposureLedger(deriveExposureLedger(input({ activities: many })), START, AS_OF);
        expect(lines.filter(line => line.startsWith('- 2026-')).length).toBe(MAX_STRESSOR_ROWS);
        expect(lines.join('\n')).toContain('earlier stressor(s) omitted');
        expect(lines.join('\n').length).toBeLessThan(6000);
    });

    it('is rendered inside the completed-training section only when the service supplies ledger inputs', () => {
        const base = {
            asOfDate: AS_OF, windowDays: 14, snapshots: [], checkins: [], activities: mixedWeek, recommendations: [],
            trainingSettings: settings(), preferences: null, intentProfile: null, purpose: 'planning' as const,
        };
        expect(buildContextBrief(base)).not.toContain('Recent meaningful stressors');
        const brief = buildContextBrief({
            ...base,
            exposureLedger: { activitiesReadable: true, recommendationsReadable: true, activityOverrides: {}, performedFacts: [], plannedSessions: [] },
        });
        const trainingAt = brief.indexOf('Completed training');
        const ledgerAt = brief.indexOf('### Recent meaningful stressors (2026-09-11 → 2026-09-24)');
        expect(ledgerAt).toBeGreaterThan(trainingAt);
        expect(brief.indexOf('### Physical-capability exposure')).toBeGreaterThan(ledgerAt);
    });

    it('confirms strength from a canonical structured execution with no Garmin record or adherence answer', () => {
        const fact: PerformedExposureFact = {
            performedOccurrenceId: 'occ-1', localDate: '2026-09-23', modality: 'Strength', category: 'Lower-body Strength',
            confidence: 'exact', sourceKinds: ['structured_execution'], evidenceTier: 'completedStructuredWorkout',
        };
        const ledger = deriveExposureLedger(input({ performedFacts: [fact] }));
        const strength = cap(ledger.capabilities, 'strength');
        expect(strength.status).toBe('confirmed');
        expect(strength.lastConfirmed).toBe('2026-09-23');
        expect(strength.lastConfirmedProvenance).toBe('canonical performed occurrence (structured_execution; exact; Lower-body Strength)');
        expect(ledger.stressors.map(s => s.family)).toEqual(['strength — Lower-body Strength']);
        expect(ledger.stressors[0].confidence).toBe('exact');
        // A provider-backed fact duplicates the Garmin row and must not add a second stressor.
        const garminFact = { ...fact, sourceKinds: ['provider_activity' as const] };
        const withGarmin = deriveExposureLedger(input({ activities: [mixedWeek[4]], performedFacts: [garminFact] }));
        expect(withGarmin.stressors.length).toBe(1);
    });

    it('lists a tempo ride as a stressor because it confirms cycling quality', () => {
        const tempo = activity({ activityId: 'tempo', intensityTag: 'moderate', stimulusDomain: 'tempo', sessionCost: 'moderate' });
        const ledger = deriveExposureLedger(input({ activities: [tempo] }));
        expect(cap(ledger.capabilities, 'cycling_quality').status).toBe('confirmed');
        expect(ledger.stressors.map(s => s.family)).toEqual(['cycling quality']);
    });

    it('says stressors are unknown, not none, when activities are unreadable, yet keeps confirmed adherence', () => {
        const unreadable = deriveExposureLedger(input({ activitiesReadable: false }));
        expect(renderExposureLedger(unreadable, START, AS_OF).join(' ')).toContain('Completed stressors unknown (activities unreadable).');
        const followed = recommendation({ adherence: { respondedAt: 'x', followed: true, actualModality: null, actualDurationMin: 45, skipped: false, notes: null } });
        const withAdherence = deriveExposureLedger(input({ activitiesReadable: false, recommendations: [followed] }));
        expect(cap(withAdherence.capabilities, 'strength').status).toBe('confirmed');
    });
});
