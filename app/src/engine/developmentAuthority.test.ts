import { describe, expect, it } from 'vitest';
import type { IntentBlock } from './blockIntent';
import type { UserEvent, TrainingIntentProfile } from './models';
import { resolveDemandProfile } from './eventPresets';
import { evaluatePeriodizationPhase } from './periodization';
import { resolvePlanningContext } from './planningMode';
import { resolveEvergreenPlan } from './evergreenPlanning';
import { developmentTemplateEligible, developmentTrace, revalidateDevelopmentEvidence, DEVELOPMENT_VO2_WORKOUT_IDS, isValidDevelopmentTrace } from './developmentAuthority';
import { KNOWLEDGE_CLAIM_IDS, getActiveKnowledgeClaim } from '../knowledge/sportsKnowledgeRegistry';
import { ENRICHED_TEMPLATES } from './templates';
import { workoutIdForTemplateId, buildCoverageState } from './coverage';
import { buildTreatmentIntentReplayPayloadV1, canonicalizeTreatmentIntentJson, hashTreatmentIntentReplayPayload } from './blockIntentReplay';
import { evaluateSameDayRecommendation } from './sameDayRecommendation';
import { SCENARIOS, LONG_HORIZON_DEVELOPMENT_SCENARIO } from './simulation/scenarios';
import { runScenario } from './simulation/analyze';
import type { UserContext, UserPreferences } from './models';
import type { CompletedExposure } from './trainingHistory';
import type { TrainingHistorySnapshot } from './trainingHistorySnapshot';
import { addDaysToLocalDateString } from '../utils/localDate';
import { createForecastAuthorityResolver } from './forecastAuthority';
import { createDecisionContext, validateDecisionContext } from './decisionContext';

export const developmentEvent: UserEvent = {
    id: 'road-race', title: 'Road race', date: '2027-08-10', category: 'cycling_event',
    priority: 'A', lifecycle: 'scheduled', demandProfile: resolveDemandProfile('cycling_event', 'road_race'),
};
export const developmentProfile: TrainingIntentProfile = {
    userId: 'u1', planningMode: 'event_directed', priorities: ['endurance', 'strength_muscle'],
    weeklyCommitment: { minSessions: 4, targetSessions: 5, maxSessions: 6 },
    organizationPreference: 'auto', schemaVersion: 1, createdAt: '', updatedAt: '',
};
export function developmentBlock(): IntentBlock {
    return {
        id: 'vo2-block', revision: 1, sourcePlanId: 'manual:vo2-block', sourcePlanRevision: 1,
        eventBinding: { eventId: developmentEvent.id, eventDate: developmentEvent.date,
            demandProfile: developmentEvent.demandProfile },
        dateRange: { startDate: '2026-10-14', endDate: '2026-11-10' },
        reviewSchedule: { reviewCadenceDays: 28, nextReviewDate: '2026-11-10' },
        objectives: [{ id: 'vo2', sport: 'cycling', adaptationScope: 'vo2_max', coverageKey: 'sustained_quality',
            intent: 'develop', priority: 'must_have', doseEnvelope: { min: 1, target: 2, max: 2,
                unit: 'sessions', floorSemantics: 'hard_floor' },
            knowledgeLineage: ['performance.high_intensity.conditional_weekly_prior'],
            successCriteria: { minCompletedExposures: 4 } }],
    };
}
function resolve(blocks: IntentBlock[], date = '2026-10-14', event = developmentEvent) {
    return resolvePlanningContext(developmentProfile, evaluatePeriodizationPhase([event], date), date, null, [], blocks);
}
describe('date-local development authority (#927)', () => {
    it('distinguishes a 300-day event with an explicit VO2 block while phase stays Base', () => {
        expect(evaluatePeriodizationPhase([developmentEvent], '2026-10-14').phase.phaseName).toBe('Base');
        expect(resolve([developmentBlock()])).toMatchObject({ eventStrategy: 'development_block',
            development: { block: { id: 'vo2-block' } } });
        expect(resolve([]).eventStrategy).toBe('evergreen_fallback');
    });
    it('withholds an unreviewed block after a supporting event result until a reviewed revision (#929)', () => {
        const supporting: UserEvent = { ...developmentEvent, id: 'b-stage', priority: 'B', date: '2026-10-20', lifecycle: 'completed' };
        const withResult = (block: IntentBlock) => resolvePlanningContext(developmentProfile,
            evaluatePeriodizationPhase([developmentEvent, supporting], '2026-10-22'), '2026-10-22', null, [], [block]);
        const unreviewed = withResult(developmentBlock());
        expect(unreviewed.eventStrategy).toBe('evergreen_fallback');
        expect(unreviewed.development?.diagnostics).toContain('supporting_outcome_review_due:b-stage');
        const reviewed = { ...developmentBlock(), revision: 2, dateRange: { startDate: '2026-10-21', endDate: '2026-11-10' } };
        expect(withResult(reviewed).eventStrategy).toBe('development_block');
        const reviewedSameStart = { ...developmentBlock(), revision: 2, reviewSchedule: { reviewCadenceDays: 28, nextReviewDate: '2026-11-17' } };
        reviewedSameStart.dateRange = { startDate: '2026-10-14', endDate: '2026-11-17' };
        expect(withResult(reviewedSameStart).eventStrategy).toBe('development_block');
    });
    it('never promotes future blocks, unrelated blocks, or ambiguous active blocks', () => {
        expect(resolve([developmentBlock()], '2026-10-13').eventStrategy).toBe('evergreen_fallback');
        const unrelated = developmentBlock();
        delete unrelated.eventBinding;
        expect(resolve([unrelated]).eventStrategy).toBe('evergreen_fallback');
        expect(resolve([developmentBlock(), { ...developmentBlock(), id: 'duplicate' }]).eventStrategy).toBe('evergreen_fallback');
    });
    it('accepts the review date but fails closed after it and on changed event demand/date', () => {
        expect(resolve([developmentBlock()], '2026-11-10').eventStrategy).toBe('development_block');
        const stale = developmentBlock();
        stale.reviewSchedule.nextReviewDate = '2026-10-14';
        expect(resolve([stale], '2026-10-15').eventStrategy).toBe('evergreen_fallback');
        expect(resolve([developmentBlock()], '2026-10-14', { ...developmentEvent, date: '2027-08-11' }).eventStrategy).toBe('evergreen_fallback');
    });
    it('hands off to the policy-owned structured build even if a development block still overlaps', () => {
        const block = developmentBlock();
        block.dateRange.endDate = '2027-08-10';
        block.reviewSchedule.nextReviewDate = '2027-08-10';
        expect(resolve([block], '2027-08-01').eventStrategy).toBe('structured_plan');
    });
});

const context: UserContext = { goals: { shortTerm: '', midTerm: '', longTerm: '' },
    constraints: { hasCableMachine: false, hasFreeWeights: true, hasTreadmill: false, hasIndoorBike: true, restrictedModalities: [], maxTimeMinutes: 90 },
    preferences: { avoidedModalities: [], deprioritizedModalities: [], preferredModalities: [], conservativeBias: false } };
const preferences: UserPreferences = { userId: 'u1', preferredRecoveryStyle: 'mixed', defaultWeekdayTimeMin: 90, defaultWeekendTimeMin: 90,
    preferredTimeOfDay: 'flexible', preferredModalities: [], deprioritizedModalities: [], avoidedModalities: [], explanationVerbosity: 'detailed',
    conservativeBias: false, preferredUnits: { distance: 'km', weight: 'kg', temperature: 'celsius' }, schemaVersion: 1, createdAt: '', updatedAt: '' };
const phase = evaluatePeriodizationPhase([developmentEvent], '2026-10-14').phase;
function establishedHistory(date = '2026-10-14'): CompletedExposure[] {
    return Array.from({ length: 12 }, (_, index) => ({
        date: addDaysToLocalDateString(date, -24 + index * 2),
        occurrenceKey: `established:${index}`, workoutId: 'cycling_zone2_standard_01', templateId: 'end_easy_01',
        modality: 'Cycling', category: 'Easy Endurance',
        costProfile: { systemic: 0, cardiovascular: 0, lowerBody: 0, upperBody: 0, impactTissue: 0, neuromuscular: 0 },
        trainingRecordLike: { type: 'Cycling', duration_min: 60, training_effect: 0, intensity_tag: '' },
    }));
}
function establishedSnapshot(date = '2026-10-14'): TrainingHistorySnapshot {
    const exposures = establishedHistory(date);
    return { throughDateExclusive: date, windowDays: 28, exposures, completedEvents: [], revision: `established:${date}`, generatedAt: '',
        sourceStates: { activities: { status: 'AVAILABLE', revision: 'synthetic' }, recommendations: { status: 'MISSING' }, manualTraining: { status: 'MISSING' } },
        athleteStateEvidence: { exposures, observedWindowDays: 28 } };
}
function plan(block = developmentBlock(), adverse = false, snapshot: TrainingHistorySnapshot | null = establishedSnapshot()) {
    return resolveEvergreenPlan(resolve([block]), phase, snapshot?.exposures.filter(exposure => exposure.date >= '2026-10-07') ?? [], snapshot,
        preferences, context, '2026-10-14', [], 7, adverse);
}
describe('development dose and exact coverage', () => {
    it('does not let earlier weeks permanently exhaust the weekly quality envelope', () => {
        const result = plan()!;
        const vo2 = ENRICHED_TEMPLATES.find(template => template.id === 'end_vo2_development_01')!;
        const exposures = ['2026-10-14', '2026-10-15'].map(date => ({ date, templateId: vo2.id,
            workoutId: DEVELOPMENT_VO2_WORKOUT_IDS[0], costProfile: vo2.costProfile!,
            trainingRecordLike: { type: 'Cycling', duration_min: 45, training_effect: 0, intensity_tag: '' } }));
        expect(developmentTemplateEligible(vo2, result.planDefinition, false, '2026-10-28', exposures)).toBe(true);
        const current = exposures.map((exposure, index) => ({ ...exposure, date: index ? '2026-10-27' : '2026-10-21' }));
        expect(developmentTemplateEligible(vo2, result.planDefinition, false, '2026-10-28', current)).toBe(false);
        expect(developmentTemplateEligible(vo2, result.planDefinition, false, '2026-10-28', [current[0],
            { ...current[1], date: '2026-10-28' }, { ...current[1], date: '2026-10-29' }])).toBe(true);
    });
    it('withholds quality authority on cold, insufficient and conflicting evidence', () => {
        const conflicting: CompletedExposure[] = [{ date: '2026-10-13', modality: 'Cycling',
            costProfile: { systemic: 0, cardiovascular: 0, lowerBody: 0, upperBody: 0, impactTissue: 0, neuromuscular: 0 },
            trainingRecordLike: { type: 'Strength', duration_min: 60, training_effect: 0, intensity_tag: '' } }];
        for (const [exposures, observedDays] of [[[], 28], [establishedHistory(), 7], [conflicting, 28]] as const) {
            const revalidated = revalidateDevelopmentEvidence(resolve([developmentBlock()]), exposures, observedDays, false);
            expect(revalidated.eventStrategy).toBe('evergreen_fallback');
            expect(revalidated.development?.diagnostics).toContain('quality_establishment_withheld:vo2');
        }
        const cold = resolveEvergreenPlan(resolve([developmentBlock()]), phase, [], null, preferences, context, '2026-10-14', [])!;
        expect(cold.planDefinition.developmentBlock).toBeUndefined();
        expect(cold.budget.requirements.some(requirement => requirement.adaptation === 'high_intensity')).toBe(false);
    });
    it('packs VO2 roles before selection and gives threshold no exact VO2 coverage', () => {
        const result = plan()!;
        expect(result.planDefinition.objectives.some(item => item.key === 'vo2_max')).toBe(true);
        const quality = buildCoverageState(result.planDefinition, '2026-10-14').descriptor!.coverage.find(item => item.key === 'sustained_quality')!;
        expect(quality.workoutIds).toEqual([...DEVELOPMENT_VO2_WORKOUT_IDS]);
        const vo2 = ENRICHED_TEMPLATES.find(template => workoutIdForTemplateId(template.id) === DEVELOPMENT_VO2_WORKOUT_IDS[0])!;
        const threshold = ENRICHED_TEMPLATES.find(template => template.id === 'end_hard_02')!;
        expect(developmentTemplateEligible(vo2, result.planDefinition, false, '2026-10-14')).toBe(true);
        expect(developmentTemplateEligible(threshold, result.planDefinition, true, '2026-10-14')).toBe(false);
    });
    it('volume intent suppresses quality and states insufficient capacity without creating sessions', () => {
        const block = developmentBlock();
        block.objectives = [{ ...block.objectives[0], id: 'volume', adaptationScope: 'zone2_aerobic', coverageKey: 'aerobic_volume',
            doseEnvelope: { min: 600, target: 700, max: 800, unit: 'minutes', floorSemantics: 'hard_floor' } }];
        const result = plan(block)!;
        expect(result.budget.requirements.some(item => item.adaptation === 'high_intensity')).toBe(false);
        expect(result.budget.shortfalls.some(item => item.adaptation === 'aerobic_endurance')).toBe(true);
        expect([...result.budget.requiredRoles, ...result.budget.targetRoles].length).toBeLessThanOrEqual(developmentProfile.weeklyCommitment.maxSessions);
    });
    it('authored maintain remains support while adverse recovery withholds VO2', () => {
        const block = developmentBlock();
        block.objectives = [{ ...block.objectives[0], id: 'strength', adaptationScope: 'strength_maintenance', coverageKey: 'primary_strength',
            sport: 'strength', intent: 'maintain' }];
        expect(plan(block)!.planDefinition.objectives.find(item => item.key === 'strength_maintenance')).toMatchObject({ role: 'secondary_support', reservationTier: 'support' });
        expect(plan(developmentBlock(), true)!.budget.requirements.some(item => item.adaptation === 'high_intensity')).toBe(false);
    });
    it('revalidates baseline/exposure/restrictions without inferring tolerance from completion', () => {
        const block = developmentBlock();
        block.objectives = [{ ...block.objectives[0], entryPrerequisites: { minBaselineDays: 28, requiredPriorExposures: 2,
            prohibitedTissueSeverities: ['limit'] } }];
        const result = revalidateDevelopmentEvidence(resolve([block]), [], 7, true);
        expect(result.eventStrategy).toBe('evergreen_fallback');
        expect(result.development?.diagnostics).toEqual(['quality_establishment_withheld:vo2', 'insufficient_baseline:vo2', 'insufficient_prior_exposure:vo2', 'active_restriction:vo2']);
    });
    it('rejects unsupported dose mappings and unknown knowledge rather than inventing conversions', () => {
        const block = developmentBlock();
        block.objectives = [{ ...block.objectives[0], doseEnvelope: { ...block.objectives[0].doseEnvelope, unit: 'tss' } }];
        expect(resolve([block]).development?.diagnostics).toContain('unsupported_objective:vo2');
        block.objectives = [{ ...developmentBlock().objectives[0], knowledgeLineage: ['unknown-claim'] }];
        expect(resolve([block]).development?.diagnostics).toContain('unregistered_knowledge:vo2');
    });
    it('maps power/mechanical only to embedded coverage and retains establishment gates', () => {
        for (const coverageKey of ['power_exposure', 'mechanical_exposure'] as const) {
            const block = developmentBlock();
            block.objectives = [{ ...block.objectives[0], id: coverageKey, adaptationScope: 'strength_maintenance', coverageKey,
                sport: 'multisport', intent: 'maintain' }];
            expect(resolve([block]).eventStrategy).toBe('development_block');
            const result = plan(block, false, null)!;
            expect(result.budget.requirements.some(item => item.adaptation === (coverageKey === 'power_exposure' ? 'neuromuscular_power' : 'mechanical_exposure'))).toBe(false);
        }
    });
    it('honors explicit power support independently of profile priority after existing establishment gates pass', () => {
        const block = developmentBlock();
        block.objectives = [{ ...block.objectives[0], id: 'power', adaptationScope: 'strength_maintenance', coverageKey: 'power_exposure',
            sport: 'strength', intent: 'maintain' }];
        const profile = { ...developmentProfile, priorities: ['strength_muscle'] as const };
        const exposures = Array.from({ length: 12 }, (_, index) => ({ date: `2026-09-${String(index + 16).padStart(2, '0')}`,
            costProfile: { systemic: 0, cardiovascular: 0, lowerBody: 0, upperBody: 0, impactTissue: 0, neuromuscular: 0 },
            modality: 'Strength' as const, trainingRecordLike: { type: 'Strength', duration_min: 60, training_effect: 0, intensity_tag: '' } }));
        const snapshot = { throughDateExclusive: '2026-10-14', windowDays: 7, exposures: [], completedEvents: [], revision: 'synthetic', generatedAt: '',
            sourceStates: { activities: { status: 'AVAILABLE' as const, revision: 'synthetic' }, recommendations: { status: 'MISSING' as const }, manualTraining: { status: 'MISSING' as const } },
            athleteStateEvidence: { exposures, observedWindowDays: 28 } };
        const planning = resolvePlanningContext({ ...profile, priorities: [...profile.priorities] }, evaluatePeriodizationPhase([developmentEvent], '2026-10-14'), '2026-10-14', null, [], [block]);
        const result = resolveEvergreenPlan(planning, phase, [], snapshot, preferences, context, '2026-10-14', [])!;
        expect(result.budget.requirements.find(requirement => requirement.adaptation === 'neuromuscular_power')).toMatchObject({ delivery: 'embedded' });
        expect(result.planDefinition.objectives.some(objective => objective.key === 'vo2_max')).toBe(false);
    });
});

describe('development boundaries and replay', () => {
    it('simulates successive development blocks 300–250 days before the event with volume quality suppression', async () => {
        const result = await runScenario(LONG_HORIZON_DEVELOPMENT_SCENARIO);
        const blocks = result.authoritySegments!.flatMap(week => week.segments.map(segment => segment.planningContext.development?.block?.id));
        expect([...new Set(blocks.filter(Boolean))]).toEqual(['development-vo2_max', 'development-zone2_aerobic', 'development-strength_maintenance']);
        const current = result.decisionTraces.filter(trace => trace.development?.blockId);
        expect(current[0].development!.objectives[0].adaptationScope).toBe('vo2_max');
        expect(current.filter(trace => trace.development?.blockId === 'development-zone2_aerobic')
            .every(trace => !trace.activeObjectives.some(objective => objective.key === 'vo2_max' || objective.key === 'threshold_quality'))).toBe(true);
        expect(result.decisionTraces.some(trace => trace.selected.templateId === 'end_vo2_development_01')).toBe(true);
    }, 20000);
    it('keeps block revisions as distinct forecast segments and clips their packing dates', () => {
        const first = developmentBlock();
        first.dateRange.endDate = '2026-10-16'; first.reviewSchedule.nextReviewDate = '2026-10-16';
        const next = { ...developmentBlock(), id: 'next', revision: 2, dateRange: { startDate: '2026-10-17', endDate: '2026-11-10' } };
        const resolver = createForecastAuthorityResolver({ todayDate: '2026-10-14', days: 7, events: [developmentEvent], profile: developmentProfile,
            history: establishedHistory(), historySnapshot: establishedSnapshot(), preferences, context, fixedActivities: [], authoredPlanBlocks: [], scheduleOverlays: [],
            eventStrengthSupportSessions: 0, aerobicVolumeFloor: null, isAdverseRecovery: false, hasCurrentClinicalSymptoms: false, mechanical: {},
            intentBlocks: [first, next] });
        const current = resolver('2026-10-14', []); const future = resolver('2026-10-17', []);
        expect(current.id).not.toBe(future.id);
        expect(current.endDate).toBe('2026-10-16');
        expect(current.evergreen!.budget.capacity.usableWindows.every(window => window.date <= current.endDate)).toBe(true);
        expect(future.planDefinition!.developmentBlock?.id).toBe('next');
    });
    it('pins event binding into hashes while preserving legacy absent-field canonical bytes', async () => {
        const block = developmentBlock();
        const bound = buildTreatmentIntentReplayPayloadV1(block, developmentProfile, 'manual-intent-block-v1');
        delete block.eventBinding;
        const legacy = buildTreatmentIntentReplayPayloadV1(block, developmentProfile, 'manual-intent-block-v1');
        expect(canonicalizeTreatmentIntentJson(legacy)).not.toContain('eventBinding');
        expect(await hashTreatmentIntentReplayPayload(bound)).not.toBe(await hashTreatmentIntentReplayPayload(legacy));
        expect(canonicalizeTreatmentIntentJson({ ...legacy, block: { ...legacy.block, eventBinding: undefined } })).toBe(canonicalizeTreatmentIntentJson(legacy));
    });
    it('production same-day captures immutable development inputs and exposes goal/purpose/dose trace', async () => {
        const input = { userId: 'u1', date: '2026-10-14', readiness: SCENARIOS[0].readinessForWeek(0), context,
            events: [developmentEvent], fixedActivities: [], authoredPlanBlocks: [], trainingIntentProfile: developmentProfile, preferences,
            externalPlan: null, externalRest: null, scheduleOverlays: [], confirmedProgressionOverrides: new Map<string, number>(),
            mechanicalCheckinHistory: [], intentBlocks: [developmentBlock()], historyProvider: { reconstruct: async () => [] } };
        const prepared = { ...input, preparedHistorySnapshot: establishedSnapshot() };
        const recommendation = await evaluateSameDayRecommendation(prepared);
        expect(recommendation.decisionTrace?.development).toMatchObject({ eventId: developmentEvent.id, blockId: 'vo2-block',
            objectives: [{ adaptationScope: 'vo2_max', intent: 'develop' }] });
        const record = await createDecisionContext({ userId: 'u1', date: input.date, recommendationRevision: 1,
            evaluatedAt: '2026-10-14T06:00:00.000Z', minimumSafetyStatus: 'complete', evaluatorInputs: prepared,
            performedTrainingFacts: { asOfDate: input.date, windowDays: 7, revision: 'synthetic', exposures: [], coverageCredits: [] } });
        input.intentBlocks[0].revision = 99;
        expect(record.evaluatorInputs?.intentBlocks?.[0].revision).toBe(1);
        expect(await validateDecisionContext(record, { userId: 'u1', date: input.date, recommendationRevision: 1 })).toEqual(record);
    });
    it('aligns the authority mapping with registered product knowledge', () => {
        const claim = getActiveKnowledgeClaim(KNOWLEDGE_CLAIM_IDS.developmentAuthorityPolicy);
        expect(claim.statement).toContain('VO2 uses exact VO2 identities even in Base');
        expect(claim.statement).toContain('Future blocks never own current dose or coverage');
        expect(developmentTrace(resolve([developmentBlock()]), [])?.evidenceLimitations).toContain('unverified');
        expect(developmentTrace(resolve([developmentBlock()]), [])?.objectives[0].demandRationale).toContain('event vo2MaxPower demand');
    });
    it('rejects invalid persisted trace demand/dates/units and keeps the legacy VO2 family gated without authority', () => {
        const trace = developmentTrace(resolve([developmentBlock()]), [])!;
        expect(isValidDevelopmentTrace(trace)).toBe(true);
        expect(isValidDevelopmentTrace({ ...trace, eventDemand: {} })).toBe(false);
        expect(isValidDevelopmentTrace({ ...trace, eventDate: '2027-02-30' })).toBe(false);
        const vo2 = ENRICHED_TEMPLATES.find(template => template.id === 'end_vo2_development_01')!;
        expect(developmentTemplateEligible(vo2, null, false, '2026-10-14')).toBe(false);
    });
});
