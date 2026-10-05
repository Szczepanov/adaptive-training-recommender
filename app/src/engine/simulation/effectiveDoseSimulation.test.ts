import { describe, expect, it } from 'vitest';
import type { Recommendation } from '../models';
import { ENRICHED_TEMPLATES_BY_ID } from '../templates';
import { materializeEffectiveSimulationTemplate, recommendationAsDay, toCompletedExposure, traceFromRecommendation } from './analyze';

describe('effective-dose simulation evidence', () => {
    it('records the resolved prescription duration instead of the authored template minimum', () => {
        const template = ENRICHED_TEMPLATES_BY_ID.get('end_easy_01');
        expect(template).toBeDefined();
        if (!template) throw new Error('end_easy_01 must exist for this regression fixture');

        const recommendation = {
            template,
            mode: 'train',
            rationale: 'full-dose Zone 2 regression fixture',
            plannedDose: { volume: 1, intensity: 1 },
        } as Recommendation;

        expect(template.durationMin).toBe(30);
        const day = recommendationAsDay('2026-08-23', recommendation, 'Build');
        const exposure = toCompletedExposure(day, recommendation);

        // The linked cycling_zone2_standard_01 full prescription is 60 minutes. Simulated
        // performed=recommended history must therefore record 60, not the template's 30-minute
        // admissibility floor; otherwise 28-day training-age evidence decays spuriously.
        expect(exposure.trainingRecordLike.duration_min).toBe(60);
    });

    it('carries an automatic easier dose into traces and accumulated simulation history', () => {
        const template = ENRICHED_TEMPLATES_BY_ID.get('mob_01');
        expect(template?.easierDose).toBeDefined();
        if (!template?.easierDose) throw new Error('mob_01 must expose easierDose for this regression fixture');

        const recommendation = {
            template,
            activeDose: template.easierDose,
            mode: 'modify',
            rationale: 'modify-tier regression fixture',
        } as Recommendation;

        const effective = materializeEffectiveSimulationTemplate(template, template.easierDose);
        expect(effective.durationMin).toBe(template.easierDose.durationMin);
        expect(effective.durationMax).toBe(template.easierDose.durationMax);
        expect(effective.costProfile?.systemic).toBeCloseTo((template.costProfile?.systemic ?? 0) * template.easierDose.doseRatio, 6);

        const day = recommendationAsDay('2026-08-24', recommendation, 'Build');
        const exposure = toCompletedExposure(day, recommendation);
        expect(day.template.durationMin).toBe(template.easierDose.durationMin);
        expect(exposure.trainingRecordLike.duration_min).toBe(template.easierDose.durationMin);
        expect(exposure.costProfile.systemic).toBeCloseTo((template.costProfile?.systemic ?? 0) * template.easierDose.doseRatio, 6);
        if (template.stimulusProfile) {
            expect(exposure.stimulusProfile?.aerobicEndurance).toBeCloseTo(template.stimulusProfile.aerobicEndurance * template.easierDose.doseRatio, 6);
        }

        const trace = traceFromRecommendation(0, '2026-08-24', recommendation);
        expect(trace.mode).toBe('modify');
        expect(trace.selected.durationMin).toBe(template.easierDose.durationMin);
        expect(trace.selected.projectedCost.systemic).toBeCloseTo(exposure.costProfile.systemic, 6);
        expect(trace.selected.stimulusProfile).toEqual(exposure.stimulusProfile ?? null);
    });

    it('materializes active dose when the forecast day still carries the authored template', () => {
        const template = ENRICHED_TEMPLATES_BY_ID.get('mob_01');
        expect(template?.easierDose).toBeDefined();
        if (!template?.easierDose) throw new Error('mob_01 must expose easierDose for this regression fixture');

        const exposure = toCompletedExposure({
            date: '2026-08-25',
            dayOffset: 1,
            confidence: 'provisional',
            phaseName: 'Build',
            template,
            activeDose: template.easierDose,
            mode: 'train',
            rationale: 'authored template plus active dose',
            addressesObjectives: [],
        });

        expect(exposure.templateId).toBe(template.id);
        expect(exposure.trainingRecordLike.duration_min).toBe(template.easierDose.durationMin);
        expect(exposure.costProfile.systemic).toBeCloseTo(
            (template.costProfile?.systemic ?? 0) * template.easierDose.doseRatio,
            6,
        );
        expect(exposure.stimulusProfile?.aerobicEndurance).toBeCloseTo(
            (template.stimulusProfile?.aerobicEndurance ?? 0) * template.easierDose.doseRatio,
            6,
        );
    });
});
