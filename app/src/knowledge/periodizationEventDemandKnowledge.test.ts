import { describe, expect, it } from 'vitest';
import { ENGINE_KNOWLEDGE_COVERAGE } from './knowledgeCoverage';
import {
    getActiveKnowledgeClaim,
    getKnowledgeSource,
    KNOWLEDGE_CLAIM_IDS,
    validateCanonicalSportsKnowledgeRegistry,
} from './sportsKnowledgeRegistry';
import { EVENT_PRESETS, resolveDemandProfile } from '../engine/eventPresets';
import { evaluatePeriodizationPhase } from '../engine/periodization';
import type { UserEvent } from '../engine/models';

const coverageById = (id: string) => ENGINE_KNOWLEDGE_COVERAGE.find(item => item.id === id);

describe('periodization and event-demand evidence pack (SKR3 W1)', () => {
    it('keeps the canonical registry structurally valid with the new module merged in', () => {
        const result = validateCanonicalSportsKnowledgeRegistry();
        expect(result.errors).toEqual([]);
        expect(result.valid).toBe(true);
    });

    it('records block periodization as viable without claiming universal superiority or validating product scalars', () => {
        const claim = getActiveKnowledgeClaim(KNOWLEDGE_CLAIM_IDS.blockStructuredProgression);
        expect(claim).toMatchObject({
            claimType: 'intervention',
            evidenceCertainty: 'low',
            recommendationStrength: 'conditional',
            maturity: 'emerging',
        });
        expect(claim.statement).toContain('does not establish consistent superiority');
        expect(claim.limitations.join(' ')).toContain('no clear 8-12-week model advantage');
        expect(claim.limitations.join(' ')).toContain('35/84');

        const meta = getKnowledgeSource('MOLMEN-2019-BLOCK-PERIODIZATION-META');
        expect(meta.sourceType).toBe('systematic_review');
        expect(meta.synthesisMethods).toContain('meta_analysis');
        expect(meta.externalIds).toEqual(expect.arrayContaining([
            { type: 'pmid', value: '31802956' },
            { type: 'doi', value: '10.2147/OAJSM.S180408' },
        ]));

        // The cyclist-specific review and load-matched randomized trial are the counterweight to
        // the older positive pooled signal: the registry must preserve both sides of the evidence.
        const cyclistReview = getKnowledgeSource('GALAN-RIOJA-2023-CYCLIST-PERIODIZATION-REVIEW');
        expect(cyclistReview.sourceType).toBe('systematic_review');
        expect(cyclistReview.externalIds).toEqual(expect.arrayContaining([
            { type: 'pmid', value: '36640771' },
            { type: 'doi', value: '10.1123/ijspp.2022-0302' },
        ]));
        expect(cyclistReview.notes).toContain('no evidence currently favors a specific periodization model');

        const cyclistTrial = getKnowledgeSource('ALMQUIST-2022-CYCLIST-PERIODIZATION-RCT');
        expect(cyclistTrial.sourceType).toBe('randomized_trial');
        expect(cyclistTrial.externalIds).toEqual(expect.arrayContaining([
            { type: 'pmid', value: '35299664' },
            { type: 'pmcid', value: 'PMC8921659' },
            { type: 'doi', value: '10.3389/fphys.2022.837634' },
        ]));
        expect(cyclistTrial.notes).toContain('no between-group performance advantage');

        // Issurin is the conceptual framework, deliberately not registered as a review synthesis.
        const framework = getKnowledgeSource('ISSURIN-2010-PERIODIZATION-REVIEW');
        expect(framework.sourceType).toBe('expert_practice');
        expect(framework.notes).toContain('not itself a systematic review');
    });

    it('supports duration/morphology-dependent performance limiters without validating preset vectors', () => {
        const claim = getActiveKnowledgeClaim(KNOWLEDGE_CLAIM_IDS.eventDurationLimiterShift);
        expect(claim).toMatchObject({ claimType: 'descriptive', evidenceCertainty: 'moderate', maturity: 'established' });
        expect(claim.statement).toContain('maximal aerobic');
        expect(claim.statement).toContain('sustainable fraction');
        expect(claim.statement).toContain('fatigue resistance');
        expect(claim.limitations.join(' ')).toContain('validate the exact 0-1 numeric value');
        expect(claim.limitations.join(' ')).toContain('strength_meet');

        const foundation = getKnowledgeSource('JOYNER-2008-ENDURANCE-PHYSIOLOGY-REVIEW');
        expect(foundation.externalIds).toEqual(expect.arrayContaining([
            { type: 'pmid', value: '17901124' },
            { type: 'pmcid', value: 'PMC2375555' },
            { type: 'doi', value: '10.1113/jphysiol.2007.143834' },
        ]));

        const cyclingReview = getKnowledgeSource('SANDERS-2021-CYCLING-POWER-PROFILE-REVIEW');
        expect(cyclingReview.externalIds).toEqual(expect.arrayContaining([{ type: 'pmid', value: '33271501' }]));
        expect(cyclingReview.notes).toContain('stage type materially changes');
        expect(cyclingReview.notes).not.toContain('time trials');

        const directRaceData = getKnowledgeSource('EBERT-2006-ROAD-CYCLING-POWER-COHORT');
        expect(directRaceData.sourceType).toBe('cohort');
        expect(directRaceData.externalIds).toEqual(expect.arrayContaining([
            { type: 'pmid', value: '19124890' },
            { type: 'doi', value: '10.1123/ijspp.1.4.324' },
        ]));
        expect(directRaceData.notes).toContain('207 races');
        expect(directRaceData.notes).toContain('Criteriums');

        expect(getKnowledgeSource('SHARMA-2020-TRIATHLON-DISTANCE-PHYSIOLOGY-CHAPTER').externalIds)
            .toEqual(expect.arrayContaining([{ type: 'doi', value: '10.1007/978-3-030-22357-1_2' }]));
    });

    it('keeps every product scalar registered as a not_applicable-certainty heuristic', () => {
        for (const id of [
            KNOWLEDGE_CLAIM_IDS.phaseBoundariesScalesPolicy,
            KNOWLEDGE_CLAIM_IDS.objectiveThresholdsPolicy,
            KNOWLEDGE_CLAIM_IDS.multiEventContributionPolicy,
            KNOWLEDGE_CLAIM_IDS.eventDemandPresetsPolicy,
        ]) {
            expect(getActiveKnowledgeClaim(id)).toMatchObject({
                claimType: 'heuristic', maturity: 'heuristic', evidenceCertainty: 'not_applicable',
            });
        }
        // Multi-event merge logic is scheduling, not physiology: it must stay evidence-free by design.
        const multiEvent = getActiveKnowledgeClaim(KNOWLEDGE_CLAIM_IDS.multiEventContributionPolicy);
        expect(multiEvent.limitations.join(' ')).toContain('no sports-science literature addresses how');

        // Contributor tapers were de-duplicated onto the canonical taper policy (see
        // periodizationTaperAlignment.test.ts). The claim must describe that delegation, including
        // its real resolution order -- this pack's first draft asserted a duplicated 14/5-day
        // contributor window table, written against pre-fix code. The legacy A/B defaults still
        // exist, but only as the canonical policy's own fallback.
        expect(multiEvent.statement).toContain('canonical taper-policy authority');
        expect(multiEvent.statement).toContain('athlete-authored start override first');
    });

    describe('claim ↔ live-constant alignment', () => {
        const CYCLING_TT_DEMAND = resolveDemandProfile('cycling_event', 'time_trial');
        const CYCLING_CRIT_DEMAND = resolveDemandProfile('cycling_event', 'criterium');

        it('pins the registered preset examples and source/coverage prose to the authored EVENT_PRESETS table', () => {
            const claim = getActiveKnowledgeClaim(KNOWLEDGE_CLAIM_IDS.eventDemandPresetsPolicy);

            expect(claim.statement).toContain('thresholdPower (0.95)');
            expect(CYCLING_TT_DEMAND.thresholdPower).toBe(0.95);
            expect(CYCLING_TT_DEMAND.repeatedSurges).toBe(0.1);
            expect(CYCLING_TT_DEMAND.sprintPower).toBe(0.1);

            expect(claim.statement).toContain('0.85/0.9/0.7');
            expect(CYCLING_CRIT_DEMAND.vo2MaxPower).toBe(0.85);
            expect(CYCLING_CRIT_DEMAND.repeatedSurges).toBe(0.9);
            expect(CYCLING_CRIT_DEMAND.sprintPower).toBe(0.7);
            expect(CYCLING_CRIT_DEMAND.aerobicEndurance).toBe(0.5);

            // The claim, product-policy source and coverage rationale all state the authored count;
            // drift in any of them means the knowledge artifact is stale. The original draft said 22.
            const presetCount = Object.values(EVENT_PRESETS).reduce((total, list) => total + list.length, 0);
            expect(claim.statement).toContain('19 authored event presets');
            expect(presetCount).toBe(19);

            const policySource = getKnowledgeSource('PRODUCT-PERIODIZATION-EVENT-DEMAND-POLICY-V1');
            expect(policySource.notes).toContain('19 authored event-preset demand vectors');
            expect(policySource.notes).not.toContain('22 authored');

            const coverage = coverageById('event.demand_presets');
            expect(coverage?.coverageRationale).toContain('19 authored preset vectors');
            expect(coverage?.coverageRationale).not.toContain('22 preset');
        });

        it('pins the registered phase boundaries and scales to evaluatePeriodizationPhase output', () => {
            const claim = getActiveKnowledgeClaim(KNOWLEDGE_CLAIM_IDS.phaseBoundariesScalesPolicy);
            expect(claim.statement).toContain('Specificity begins at <=35 days');
            expect(claim.statement).toContain('Build at <=84 days');

            const event = (date: string): UserEvent => ({
                id: 'a-race', title: 'A race', date, priority: 'A', lifecycle: 'scheduled',
                category: 'cycling_event', demandProfile: CYCLING_TT_DEMAND,
            });

            // 30 days out -> Specificity, volume 1.0 / intensity 1.1 (the claim's stated scales).
            const specificity = evaluatePeriodizationPhase([event('2026-10-01')], '2026-09-01');
            expect(specificity.phase.phaseName).toBe('Specificity');
            expect(specificity.phase.volumeScale).toBe(1.0);
            expect(specificity.phase.intensityScale).toBe(1.1);

            // 60 days out -> Build, volume 1.1 / intensity 0.9.
            const build = evaluatePeriodizationPhase([event('2026-10-31')], '2026-09-01');
            expect(build.phase.phaseName).toBe('Build');
            expect(build.phase.volumeScale).toBe(1.1);
            expect(build.phase.intensityScale).toBe(0.9);

            // 120 days out -> Base, volume 1.0 / intensity 0.8.
            const base = evaluatePeriodizationPhase([event('2026-12-30')], '2026-09-01');
            expect(base.phase.phaseName).toBe('Base');
            expect(base.phase.volumeScale).toBe(1.0);
            expect(base.phase.intensityScale).toBe(0.8);
        });
    });

    it('moves its five families to partial without claiming full coverage', () => {
        for (const id of [
            'periodization.phase_boundaries_scales',
            'periodization.objective_thresholds',
            'periodization.multi_event_contribution',
            'event.demand_presets',
            'spacing.pre_event_restrictions',
        ]) {
            const item = coverageById(id);
            expect(item?.coverage).toBe('partial');
            expect(item?.researchPriority).not.toBe('none');
        }

        const phaseCoverage = coverageById('periodization.phase_boundaries_scales');
        expect(phaseCoverage?.coverageRationale).toContain('not consistently superior');
        expect(phaseCoverage?.coverageRationale).not.toContain('can outperform');

        // Reclassified in this pack: an authored 0-1 vector table is an encoding, not a constant.
        expect(coverageById('event.demand_presets')?.classification).toBe('product_heuristic');
    });
});