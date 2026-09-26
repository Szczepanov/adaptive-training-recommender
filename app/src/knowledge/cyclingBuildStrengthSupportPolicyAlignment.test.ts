import { describe, expect, it } from 'vitest';
import { strengthRequirement } from '../engine/evergreenStrategy';
import { eventStrengthSupportSessions } from '../engine/trainingIntent';
import { buildCyclingEventPlan } from '../engine/planSchedule';
import type { PlanningContext } from '../engine/planningMode';
import type { TrainingIntentProfile, UserEvent } from '../engine/models';
import { resolveDemandProfile } from '../engine/eventPresets';
import { SEPTEMBER_CYCLING_EVENT_SESSION_COVERAGE } from '../workouts/event-plan';
import { ENGINE_KNOWLEDGE_COVERAGE } from './knowledgeCoverage';
import { getActiveKnowledgeClaim, KNOWLEDGE_CLAIM_IDS } from './sportsKnowledgeRegistry';

const event: UserEvent = {
    id: 'alignment-road-race', title: 'Road race', date: '2026-09-13', priority: 'A',
    lifecycle: 'scheduled', category: 'cycling_event',
    demandProfile: resolveDemandProfile('cycling_event', 'road_race'),
};
const profile = (priorities: TrainingIntentProfile['priorities']): TrainingIntentProfile => ({
    userId: 'athlete', planningMode: 'event_directed', priorities,
    weeklyCommitment: { minSessions: 5, targetSessions: 6, maxSessions: 7 },
    organizationPreference: 'auto', schemaVersion: 1, createdAt: '', updatedAt: '',
});

describe('cycling build strength-support policy alignment (ADR-0033, issue #801)', () => {
    it('registers the product-policy claim and coverage item against the existing strength-frequency claim', () => {
        const claim = getActiveKnowledgeClaim(KNOWLEDGE_CLAIM_IDS.cyclingBuildStrengthSupportPolicy);
        expect(claim).toMatchObject({ claimType: 'heuristic', maturity: 'heuristic', evidenceCertainty: 'not_applicable', version: 1 });
        expect(claim.statement).toContain('two-session floor minus the one authored primary-strength role');
        const coverage = ENGINE_KNOWLEDGE_COVERAGE.find(item => item.id === 'event.cycling_build_strength_support');
        expect(coverage).toMatchObject({
            classification: 'product_heuristic', coverage: 'covered',
            knowledgeRefs: [claim.id, KNOWLEDGE_CLAIM_IDS.adultStrengthHealthFrequency],
        });
    });

    it('derives the support count from the registered strength floor rather than a new constant', () => {
        const floor = strengthRequirement('required').floor;
        expect(floor).toMatchObject({ dose: { unit: 'sessions', value: 2 } });
        expect(strengthRequirement('required').knowledgeRefs[0]).toBe(KNOWLEDGE_CLAIM_IDS.adultStrengthHealthFrequency);
        const eventContext = { mode: 'event_directed' } as PlanningContext;
        expect(eventStrengthSupportSessions(eventContext, profile(['endurance', 'strength_muscle']))).toBe((floor?.dose.value ?? 0) - 1);
    });

    it('authors a build-only, zero-credit, support-tier compact_strength role on exact identities', () => {
        const plan = buildCyclingEventPlan(event, [], 1);
        if (plan.status !== 'AVAILABLE') throw new Error('event plan unavailable');
        const support = plan.data.objectives.filter(item => item.coverageKey === 'compact_strength');
        expect(support).toEqual([expect.objectContaining({
            blockId: 'block_build', requiredCredit: 0, reservationTier: 'support',
            coverageMinimumSessions: 1, coverageTargetSessions: 1,
        })]);
        const primary = plan.data.objectives.filter(item => item.coverageKey === 'primary_strength');
        expect(primary.every(item => item.reservationTier === undefined)).toBe(true);
        const identities = SEPTEMBER_CYCLING_EVENT_SESSION_COVERAGE.find(item => item.key === 'compact_strength')?.workoutIds;
        expect(identities).toEqual(['strength_compact_power_01', 'strength_reactive_power_01', 'travel_strength_maintenance_01', 'strength_bodyweight_full_body_01']);
    });
});
