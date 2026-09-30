import { describe, expect, it } from 'vitest';
import { rankCandidates } from '../optimizer';
import { ENRICHED_TEMPLATES_BY_ID } from '../templates';
import { deriveFactsFromOccurrence, type PerformedExposureFact } from '../performedTrainingFacts';
import type {
    ActivityOverride,
    FatigueState,
    NormalizedGarminActivity,
    UserPreferences,
} from '../models';
import type { ResolvedAvailability } from '../schedule';
import type { PerformedTrainingOccurrence } from '../../training-occurrence/models';
import type { HydratedOccurrenceContext } from '../performedTrainingFacts';
import type { CoverageState } from '../coverage';
import { EVERGREEN_GENERAL_COVERAGE_SET } from '../../workouts/event-plan';

const DEFAULT_FATIGUE: FatigueState = {
    lastUpdatedDate: '2026-09-07',
    externalLoadFatigue: { systemic: 0, cardiovascular: 0, lowerBody: 0, upperBody: 0, impactTissue: 0, neuromuscular: 0 },
    internalResponseStrain: { systemic: 0, cardiovascular: 0, lowerBody: 0, upperBody: 0, impactTissue: 0, neuromuscular: 0 },
    combinedFatigue: { systemic: 0, cardiovascular: 0, lowerBody: 0, upperBody: 0, impactTissue: 0, neuromuscular: 0 },
};

const DEFAULT_AVAILABILITY: ResolvedAvailability = {
    date: '2026-09-07',
    maxTimeMinutes: 120,
    availableEquipment: ['free_weights', 'indoor_bike', 'treadmill', 'cable_machine', 'swim_access'],
    fixedActivities: [],
    reservedCapacityCost: 0,
    reservedCapacityCostProfile: { systemic: 0, cardiovascular: 0, lowerBody: 0, upperBody: 0, impactTissue: 0, neuromuscular: 0 },
    environmentOverride: null,
};

const DEFAULT_PREFERENCES: UserPreferences = {
    userId: 'user_1',
    avoidedModalities: [],
    deprioritizedModalities: [],
    preferredModalities: ['Cycling', 'Running', 'Swimming'],
    conservativeBias: false,
    preferredRecoveryStyle: 'mixed',
    defaultWeekdayTimeMin: 90,
    defaultWeekendTimeMin: 120,
    preferredTimeOfDay: 'flexible',
    explanationVerbosity: 'detailed',
    preferredUnits: { distance: 'km', weight: 'kg', temperature: 'celsius' },
    schemaVersion: 1,
    createdAt: '',
    updatedAt: '',
};

function makeFact(overrides: Partial<PerformedExposureFact> = {}): PerformedExposureFact {
    return {
        performedOccurrenceId: 'occ-1',
        localDate: '2026-09-06', // Sunday
        modality: 'Cycling',
        confidence: 'high',
        sourceKinds: ['provider_activity'],
        evidenceTier: 'garminTrainingEffect',
        intensityClassificationVersion: 2,
        stimulusDomain: 'tempo',
        durationMin: 60,
        ...overrides,
    };
}

describe('performed stimulus-domain recency in sequencing decisions (#931)', () => {
    const mondayDate = '2026-09-07';
    const tempoCandidate = ENRICHED_TEMPLATES_BY_ID.get('end_mod_02')!; // Moderate Endurance (Cycling Tempo Ride)
    const runningTempoCandidate = ENRICHED_TEMPLATES_BY_ID.get('end_mod_01')!; // Moderate Endurance (Running Tempo Run)
    const enduranceCandidate = ENRICHED_TEMPLATES_BY_ID.get('end_easy_01')!; // Easy Endurance
    const vo2Candidate = ENRICHED_TEMPLATES_BY_ID.get('end_hard_01')!; // Hard Endurance (VO2)
    const thresholdCandidate = ENRICHED_TEMPLATES_BY_ID.get('swim_threshold_01')!; // Sustained Swim Intervals (Threshold)

    it('demotes Monday tempo candidate (0.2x) after Sunday provider 3x15 tempo', () => {
        const sundayTempo = makeFact({ stimulusDomain: 'tempo' });

        // Baseline: no Sunday exposures
        const baselineResult = rankCandidates(
            [tempoCandidate, enduranceCandidate],
            [],
            DEFAULT_FATIGUE,
            DEFAULT_AVAILABILITY,
            [],
            DEFAULT_PREFERENCES,
            { date: mondayDate },
        );
        const baselineTempo = baselineResult.accepted.find(c => c.template.id === tempoCandidate.id)!;

        // With Sunday tempo
        const testResult = rankCandidates(
            [tempoCandidate, enduranceCandidate],
            [],
            DEFAULT_FATIGUE,
            DEFAULT_AVAILABILITY,
            [],
            DEFAULT_PREFERENCES,
            { date: mondayDate, recentPerformedExposures: [sundayTempo] },
        );
        const testTempo = testResult.accepted.find(c => c.template.id === tempoCandidate.id)!;
        const testEndurance = testResult.accepted.find(c => c.template.id === enduranceCandidate.id)!;

        // Verify tempo candidate was demoted by 0.2x
        expect(testTempo.stimulusRecency?.penaltyApplied).toBe(true);
        expect(testTempo.stimulusRecency?.candidateFamily).toBe('tempo');
        expect(testTempo.rationale).toContain("[Stimulus recency] Quality family 'tempo' repetition from D-1 (penalty 0.2x)");
        expect(testTempo.utilityScore).toBeCloseTo(baselineTempo.utilityScore * 0.2, 5);

        // Verify endurance candidate was not demoted
        expect(testEndurance.stimulusRecency?.penaltyApplied).toBe(false);
    });

    it('does not demote threshold or VO2 candidates after Sunday provider tempo (same-family isolation)', () => {
        const sundayTempo = makeFact({ stimulusDomain: 'tempo' });

        const result = rankCandidates(
            [thresholdCandidate, vo2Candidate],
            [],
            DEFAULT_FATIGUE,
            DEFAULT_AVAILABILITY,
            [],
            DEFAULT_PREFERENCES,
            { date: mondayDate, recentPerformedExposures: [sundayTempo] },
        );

        const rankedThreshold = result.accepted.find(c => c.template.id === thresholdCandidate.id)!;
        const rankedVo2 = result.accepted.find(c => c.template.id === vo2Candidate.id)!;

        expect(rankedThreshold.stimulusRecency?.candidateFamily).toBe('threshold');
        expect(rankedThreshold.stimulusRecency?.penaltyApplied).toBe(false);

        expect(rankedVo2.stimulusRecency?.candidateFamily).toBe('vo2');
        expect(rankedVo2.stimulusRecency?.penaltyApplied).toBe(false);
    });

    it('authoritatively demotes Monday tempo after Sunday structured tempo execution even if provider said endurance', () => {
        const occurrence: PerformedTrainingOccurrence = {
            schemaVersion: 1,
            performedOccurrenceId: 'occ-tempo-structured',
            userId: 'user_1',
            status: 'active',
            localDate: '2026-09-06',
            modality: 'Cycling',
            sourceRefs: [
                { kind: 'structured_execution', executionId: 'exec-1' },
                { kind: 'provider_activity', provider: 'garmin', activityId: 'garmin-act-1' },
            ],
            reconciliation: { state: 'single_source' },
            createdAt: '2026-09-06T18:00:00Z',
            updatedAt: '2026-09-06T18:00:00Z',
        };

        const hydrated: HydratedOccurrenceContext = {
            structured: {
                executionId: 'exec-1',
                workoutId: 'cycling_tempo_surges_01',
                modality: 'Cycling',
                durationMin: 60,
            },
            provider: {
                activityId: 'garmin-act-1',
                provider: 'garmin',
                garminActivity: {
                    activityId: 'garmin-act-1',
                    userId: 'user_1',
                    startTimeLocal: '2026-09-06T10:00:00',
                    startTimeGmt: '2026-09-06T08:00:00Z',
                    type: 'cycling',
                    durationMin: 60,
                    trainingEffectAerobic: 2.0,
                    trainingEffectAnaerobic: 0,
                    averageHr: 125,
                    intensityClassificationVersion: 2,
                    stimulusDomain: 'endurance', // Conflicting provider classification!
                } as unknown as NormalizedGarminActivity,
            },
        };

        const { exposure } = deriveFactsFromOccurrence(occurrence, hydrated);

        // Fact authoritatively inherits 'tempo' from structured catalog workout cycling_tempo_surges_01
        expect(exposure.stimulusDomain).toBe('tempo');
        expect(exposure.confidence).toBe('exact');

        const result = rankCandidates(
            [tempoCandidate],
            [],
            DEFAULT_FATIGUE,
            DEFAULT_AVAILABILITY,
            [],
            DEFAULT_PREFERENCES,
            { date: mondayDate, recentPerformedExposures: [exposure] },
        );

        const rankedTempo = result.accepted.find(c => c.template.id === tempoCandidate.id)!;
        expect(rankedTempo.stimulusRecency?.penaltyApplied).toBe(true);
    });

    it('does not demote Monday tempo when Sunday provider tempo had an athlete override (override precedence)', () => {
        const occurrence: PerformedTrainingOccurrence = {
            schemaVersion: 1,
            performedOccurrenceId: 'occ-tempo-overridden',
            userId: 'user_1',
            status: 'active',
            localDate: '2026-09-06',
            modality: 'Cycling',
            sourceRefs: [
                { kind: 'provider_activity', provider: 'garmin', activityId: 'garmin-act-2' },
            ],
            reconciliation: { state: 'single_source' },
            createdAt: '2026-09-06T18:00:00Z',
            updatedAt: '2026-09-06T18:00:00Z',
        };

        const override: ActivityOverride = {
            activityId: 'garmin-act-2',
            userId: 'user_1',
            date: '2026-09-06',
            originalType: 'cycling',
            originalIntensityTag: 'tempo',
            overriddenModality: 'Cycling',
            overriddenIntensity: 'easy',
            notes: 'Easy recovery spin with tailwind',
            createdAt: '2026-09-06T18:00:00Z',
            updatedAt: '2026-09-06T18:00:00Z',
        };

        const hydrated: HydratedOccurrenceContext = {
            provider: {
                activityId: 'garmin-act-2',
                provider: 'garmin',
                garminActivity: {
                    activityId: 'garmin-act-2',
                    userId: 'user_1',
                    startTimeLocal: '2026-09-06T10:00:00',
                    startTimeGmt: '2026-09-06T08:00:00Z',
                    type: 'cycling',
                    durationMin: 60,
                    trainingEffectAerobic: 3.5,
                    trainingEffectAnaerobic: 0,
                    averageHr: 145,
                    intensityClassificationVersion: 2,
                    stimulusDomain: 'tempo',
                } as unknown as NormalizedGarminActivity,
                override,
            },
        };

        const { exposure } = deriveFactsFromOccurrence(occurrence, hydrated);

        // Override suppresses provider's stimulus domain
        expect(exposure.stimulusDomain).toBeUndefined();

        const result = rankCandidates(
            [tempoCandidate],
            [],
            DEFAULT_FATIGUE,
            DEFAULT_AVAILABILITY,
            [],
            DEFAULT_PREFERENCES,
            { date: mondayDate, recentPerformedExposures: [exposure] },
        );

        const rankedTempo = result.accepted.find(c => c.template.id === tempoCandidate.id)!;
        expect(rankedTempo.stimulusRecency?.penaltyApplied).toBe(false);
    });

    it('does not demote Monday tempo when Sunday provider tempo was unversioned/legacy (intensityClassificationVersion < 2)', () => {
        const legacySundayFact = makeFact({
            stimulusDomain: 'tempo',
            intensityClassificationVersion: 1, // Legacy classification
        });

        const result = rankCandidates(
            [tempoCandidate],
            [],
            DEFAULT_FATIGUE,
            DEFAULT_AVAILABILITY,
            [],
            DEFAULT_PREFERENCES,
            { date: mondayDate, recentPerformedExposures: [legacySundayFact] },
        );

        const rankedTempo = result.accepted.find(c => c.template.id === tempoCandidate.id)!;
        expect(rankedTempo.stimulusRecency?.penaltyApplied).toBe(false);
    });

    it('exempts consecutive Zone 2 endurance from repetition penalties', () => {
        const sundayEndurance = makeFact({
            stimulusDomain: 'endurance',
        });

        const result = rankCandidates(
            [enduranceCandidate],
            [],
            DEFAULT_FATIGUE,
            DEFAULT_AVAILABILITY,
            [],
            DEFAULT_PREFERENCES,
            { date: mondayDate, recentPerformedExposures: [sundayEndurance] },
        );

        const rankedEndurance = result.accepted.find(c => c.template.id === enduranceCandidate.id)!;
        expect(rankedEndurance.stimulusRecency?.candidateFamily).toBe('endurance');
        expect(rankedEndurance.stimulusRecency?.penaltyApplied).toBe(false);
        expect(rankedEndurance.stimulusRecency?.enduranceExemptionApplied).toBe(true);
    });

    it('does not compound penalties to 0.04 when same template and same quality family match (Math.min coordination)', () => {
        const sundayTempo = makeFact({ stimulusDomain: 'tempo' });

        // History includes end_mod_02 yesterday (triggers templateRepetitionMultiplier = 0.2)
        const historyWithSameTemplate = [
            {
                date: '2026-09-06',
                modality: 'Cycling',
                category: 'Moderate Endurance' as const,
                templateId: 'end_mod_02',
                systemicCost: 0.4,
                lowerBodyCost: 0.3,
            },
        ];

        // History with a DIFFERENT tempo template yesterday (triggers stimulusRepetitionMultiplier = 0.2 only)
        const historyWithDifferentTemplate = [
            {
                date: '2026-09-06',
                modality: 'Running',
                category: 'Moderate Endurance' as const,
                templateId: 'end_mod_01',
                systemicCost: 0.4,
                lowerBodyCost: 0.3,
            },
        ];

        const resultBoth = rankCandidates(
            [tempoCandidate],
            [],
            DEFAULT_FATIGUE,
            DEFAULT_AVAILABILITY,
            [],
            DEFAULT_PREFERENCES,
            {
                date: mondayDate,
                recentHistory: historyWithSameTemplate,
                recentPerformedExposures: [sundayTempo],
            },
        );

        const resultStimulusOnly = rankCandidates(
            [tempoCandidate],
            [],
            DEFAULT_FATIGUE,
            DEFAULT_AVAILABILITY,
            [],
            DEFAULT_PREFERENCES,
            {
                date: mondayDate,
                recentHistory: historyWithDifferentTemplate,
                recentPerformedExposures: [sundayTempo],
            },
        );

        const utilityBoth = resultBoth.accepted[0].utilityScore;
        const utilityStimulusOnly = resultStimulusOnly.accepted[0].utilityScore;

        // Multiplier should be Math.min(0.2, 0.2) = 0.2, not 0.04. Both scenarios have identical 0.2 repetition multiplier!
        expect(utilityBoth).toBeCloseTo(utilityStimulusOnly, 5);
        expect(resultBoth.accepted[0].stimulusRecency?.penaltyApplied).toBe(true);
    });

    it('waives quality repetition penalty for nominated anchor candidate (fulfilsNominatedAnchor === true)', () => {
        const sundayTempo = makeFact({ stimulusDomain: 'tempo' });

        // When Monday has anchorRole: 'quality'
        // Cycling Moderate Endurance (end_mod_02) matches 'quality' anchor role
        const resultWithAnchor = rankCandidates(
            [tempoCandidate],
            [],
            DEFAULT_FATIGUE,
            DEFAULT_AVAILABILITY,
            [],
            DEFAULT_PREFERENCES,
            {
                date: mondayDate,
                anchorRole: 'quality',
                recentPerformedExposures: [sundayTempo],
            },
        );

        const rankedAnchorTempo = resultWithAnchor.accepted.find(c => c.template.id === tempoCandidate.id)!;
        expect(rankedAnchorTempo.stimulusRecency?.anchorWaived).toBe(true);
        expect(rankedAnchorTempo.stimulusRecency?.penaltyApplied).toBe(false);
    });

    it('enforces quality penalty on non-anchor quality candidate on an anchor day', () => {
        const sundayTempo = makeFact({ stimulusDomain: 'tempo' });

        // Running tempo template (end_mod_01) does NOT fulfil 'quality' cycling anchor
        const resultWithAnchor = rankCandidates(
            [runningTempoCandidate],
            [],
            DEFAULT_FATIGUE,
            DEFAULT_AVAILABILITY,
            [],
            DEFAULT_PREFERENCES,
            {
                date: mondayDate,
                anchorRole: 'quality',
                recentPerformedExposures: [sundayTempo],
            },
        );

        const rankedRunningTempo = resultWithAnchor.accepted.find(c => c.template.id === runningTempoCandidate.id)!;
        // Not waived because running tempo does not match cycling quality anchor role!
        expect(rankedRunningTempo.stimulusRecency?.anchorWaived).toBe(false);
        expect(rankedRunningTempo.stimulusRecency?.penaltyApplied).toBe(true);
    });

    it('lets externally authored event-plan session win through coverage tier authority (#925/#934)', () => {
        const sundayTempo = makeFact({ stimulusDomain: 'tempo' });

        // Mock coverage state where enduranceCandidate advances a required weekly role (coverageNeedTier 1)
        const mockCoverageState: CoverageState = {
            asOfDate: mondayDate,
            phase: 'general',
            activeBlockId: 'block_general',
            coverageSetId: 'evergreen_general',
            descriptor: EVERGREEN_GENERAL_COVERAGE_SET,
            requirements: [
                {
                    id: 'coverage_aerobic',
                    key: 'aerobic_volume',
                    label: 'Aerobic volume',
                    requirement: 'required',
                    minimumSessions: 1,
                    targetSessions: 2,
                    completedSessions: 0,
                    projectedSessions: 0,
                    priority: 'must_have',
                    rollingWindowDays: 7,
                    windowStart: '2026-09-01',
                    windowEnd: '2026-09-14',
                    credits: [],
                },
            ],
        };

        const result = rankCandidates(
            [tempoCandidate, enduranceCandidate],
            [],
            DEFAULT_FATIGUE,
            DEFAULT_AVAILABILITY,
            [],
            DEFAULT_PREFERENCES,
            {
                date: mondayDate,
                coverageState: mockCoverageState,
                recentPerformedExposures: [sundayTempo],
            },
        );

        // enduranceCandidate advances required aerobic_volume coverage (tier 1), tempoCandidate is tier 3.
        // Therefore enduranceCandidate is ranked first.
        expect(result.accepted[0].template.id).toBe(enduranceCandidate.id);
        expect(result.accepted[0].coverageNeedTier).toBe(1);
        expect(result.accepted[1].template.id).toBe(tempoCandidate.id);
        expect(result.accepted[1].coverageNeedTier).toBe(3);
    });
});


describe('canonical stimulus recency simulation regression', () => {
    it('consumes the canonical Garmin tempo seed in the production daily evaluator', async () => {
        const { runScenario } = await import('../simulation/analyze');
        const { SCENARIOS } = await import('../simulation/scenarios');
        const scenario = SCENARIOS.find(item => item.id === 'performed_stimulus_recency_garmin_tempo')!;
        const result = await runScenario(scenario);
        const trace = result.decisionTraces[0].stimulusRecency;
        expect(trace?.stimulusRecency?.yesterdayQualityFamilies).toEqual(['tempo']);
        expect(trace?.stimulusRecency?.exposures).toEqual([
            expect.objectContaining({ performedOccurrenceId: 'scenario:stimulus-recency:tempo', stimulusDomain: 'tempo', confident: true }),
        ]);
        expect(trace?.candidateScores.some(candidate => candidate.stimulusRecency?.penaltyApplied)).toBe(true);
    });
});
