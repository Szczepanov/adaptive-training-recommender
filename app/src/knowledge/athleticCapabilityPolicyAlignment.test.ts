import { describe, expect, it } from 'vitest';
import {
    ATHLETIC_CAPABILITIES,
    ATHLETIC_CAPABILITY_TARGET_INTERVAL_DAYS,
    evaluateCapabilityCadence,
} from '../engine/capabilityMaintenance';
import { ATHLETIC_CAPABILITY_KEYS } from '../engine/validationCore';
import { resolveEvidenceBackedStrategy, type AthleteTrainingState } from '../engine/evergreenStrategy';
import { ATHLETIC_CAPABILITY_IDENTITIES, athleticCapabilityStageFor } from '../workouts/athleticCapability';
import { mechanicalIdentityFor } from '../workouts/mechanicalExposure';
import { MECHANICAL_CONTINUITY_WINDOW_DAYS } from '../engine/mechanicalProgression';
import { ENGINE_KNOWLEDGE_COVERAGE } from './knowledgeCoverage';
import { getActiveKnowledgeClaim, KNOWLEDGE_CLAIM_IDS } from './sportsKnowledgeRegistry';

const ESTABLISHED: AthleteTrainingState = {
    recentExposure: { sessionCount: 14, totalMinutes: 900, aerobicSessions: 12, strengthSessions: 2, highIntensitySessions: 0 },
    trainingAgeProxy: 'established',
    inference: { dataQuality: 'high', observedWindowDays: 28, diagnostics: [] },
};

describe('athletic capability maintenance policy alignment (ADR-0033, issue #805)', () => {
    const claim = getActiveKnowledgeClaim(KNOWLEDGE_CLAIM_IDS.athleticCapabilityMaintenancePolicy);

    it('registers the policy as a product heuristic without invented scientific certainty', () => {
        expect(claim).toMatchObject({
            claimType: 'heuristic', maturity: 'heuristic', evidenceCertainty: 'not_applicable',
            recommendationStrength: 'conditional', safetyImpact: 'high', version: 2,
        });
        expect(claim.limitations.some(item => item.includes('not a validated physiological cliff'))).toBe(true);
        expect(claim.limitations.some(item => item.includes('7-10-day football/event-block'))).toBe(true);
        expect(claim.limitations.some(item => item.includes('unknown historical variant'))).toBe(true);
        const coverage = ENGINE_KNOWLEDGE_COVERAGE.find(item => item.id === 'evergreen.athletic_capability_maintenance');
        expect(coverage).toMatchObject({ classification: 'product_heuristic', coverage: 'covered' });
        expect(coverage?.knowledgeRefs).toContain(KNOWLEDGE_CLAIM_IDS.athleticCapabilityMaintenancePolicy);
    });

    it('matches the implemented interval and date-aware placement semantics', () => {
        expect(ATHLETIC_CAPABILITY_TARGET_INTERVAL_DAYS).toBe(14);
        expect(ATHLETIC_CAPABILITY_TARGET_INTERVAL_DAYS).toBe(MECHANICAL_CONTINUITY_WINDOW_DAYS);
        expect(claim.statement).toContain('fixed 14-day maximum gap');
        expect(claim.statement).toContain('last qualifying exposure + 13 days');
        expect(claim.statement).toContain('not-before and target date equal to that due date');
        expect(claim.statement).toContain('Observation span must be proven');
        expect(claim.statement).toContain('current-date coverage urgency both enforce that date');
        const cadence = evaluateCapabilityCadence({
            asOfDate: '2026-09-10', planningHorizonDays: 7, observedWindowDays: 28,
            preference: { enabled: true, capabilities: ['sport_skill'] },
            exposures: [{ date: '2026-09-02', workoutId: 'field_controlled_maintenance_01' }],
        }).find(item => item.capability === 'sport_skill');
        expect(cadence).toMatchObject({ status: 'due', notBeforeDate: '2026-09-15', targetDate: '2026-09-15' });
    });

    it('names exactly the implemented capability vocabulary and identity mapping', () => {
        expect([...ATHLETIC_CAPABILITIES]).toEqual([...ATHLETIC_CAPABILITY_KEYS]);
        for (const capability of ATHLETIC_CAPABILITIES) expect(claim.statement).toContain(capability);
        for (const identity of ATHLETIC_CAPABILITY_IDENTITIES) {
            expect(claim.statement).toContain(identity.workoutId);
            expect(mechanicalIdentityFor(identity.workoutId)?.planningUse).toBe('maintenance_candidate');
            expect(athleticCapabilityStageFor(identity.workoutId)).toBe(mechanicalIdentityFor(identity.workoutId)?.stage);
        }
        const accelDecel = ATHLETIC_CAPABILITY_IDENTITIES.find(item =>
            item.workoutId === 'field_acceleration_braking_01' && item.capability === 'acceleration_deceleration');
        expect(accelDecel?.qualifyingVariants).toEqual(['full', 'reduced']);
        expect(claim.statement).toContain('acceleration_deceleration only full/reduced because return_to_training omits braking');
    });

    it('states consent precedence, evergreen-only authority and the ADR-0044 status vocabulary', () => {
        for (const phrase of [
            'unavailable modalities always win', 'avoided modalities block the optional injection',
            'deprioritized modalities stay a soft preference', 'never promotes the modality into preferred modalities',
            'deliberately_suspended/event_directed_mode', 'capability_maintenance_unfulfilled',
            'disabled, insufficient_history, satisfied, due, overdue', 'plannable, blocked, deliberately_suspended, unknown',
        ]) expect(claim.statement).toContain(phrase);
        const explicitPreference = getActiveKnowledgeClaim(KNOWLEDGE_CLAIM_IDS.fieldCatalogExplicitPreferencePolicy);
        expect(explicitPreference.statement).toContain('UNAVAILABLE_MODALITY');
        expect(explicitPreference.statement).toContain('capability-maintenance consent');
    });

    it('guarantees an optional mechanical requirement for the opt-in, independent of sport_readiness', () => {
        const optedIn = resolveEvidenceBackedStrategy({ priorities: ['endurance'], capabilityMaintenanceEnabled: true }, ESTABLISHED);
        expect(optedIn.requirements.find(item => item.adaptation === 'mechanical_exposure')?.priority).toBe('optional');
        const optedOut = resolveEvidenceBackedStrategy({ priorities: ['endurance'] }, ESTABLISHED);
        expect(optedOut.requirements.some(item => item.adaptation === 'mechanical_exposure')).toBe(false);
        const suspended = resolveEvidenceBackedStrategy({ priorities: ['endurance'], capabilityMaintenanceEnabled: true, isAdverseRecovery: true }, ESTABLISHED);
        expect(suspended.requirements.some(item => item.adaptation === 'mechanical_exposure')).toBe(false);
        expect(suspended.warnings.some(item => item.code === 'mechanical_exposure_withheld')).toBe(true);
    });
});
