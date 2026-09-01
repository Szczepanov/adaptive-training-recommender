import { describe, expect, it } from 'vitest';
import type { Recommendation } from '../models';
import { ENRICHED_TEMPLATES_BY_ID } from '../templates';
import { materializeEffectiveSimulationTemplate, recommendationAsDay, toCompletedExposure, traceFromRecommendation } from './analyze';

describe('effective-dose simulation evidence', () => {
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
        const exposure = toCompletedExposure(day);
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
});
