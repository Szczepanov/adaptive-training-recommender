import { describe, expect, it } from 'vitest';
import { buildHistoryFeatureSummary, materializeEffectiveDose, normalizeHistory, type RecentHistoryEntry } from './optimizer';
import { ENRICHED_TEMPLATES } from './templates';

function thresholdCrossingFixture() {
    const template = ENRICHED_TEMPLATES.find(candidate =>
        !!candidate.easierDose
        && !!candidate.costProfile
        && candidate.systemicCost >= 0.4
        && candidate.systemicCost * candidate.easierDose.doseRatio < 0.4
    );
    expect(template, 'expected an easier dose that crosses the legacy 0.40 recovery-streak threshold').toBeDefined();
    return { template: template!, easierDose: template!.easierDose! };
}

function projectedEntry(date: string): RecentHistoryEntry {
    const { template, easierDose } = thresholdCrossingFixture();
    const effective = materializeEffectiveDose(template, easierDose);
    return {
        date,
        templateId: template.id,
        category: template.category,
        modality: template.modality,
        systemicCost: effective.systemicCost,
        lowerBodyCost: effective.costProfile?.lowerBody ?? 0,
        durationMin: effective.durationMin,
        source: 'projected',
    };
}

describe('projected history policy boundary', () => {
    it('keeps effective projected loads from silently migrating authored threshold policies', () => {
        const { template, easierDose } = thresholdCrossingFixture();
        const effective = materializeEffectiveDose(template, easierDose);
        expect(effective.systemicCost).toBeLessThan(0.4);

        const [normalized] = normalizeHistory([projectedEntry('2026-08-03')], '2026-08-04');
        expect(normalized.systemicCost).toBe(template.systemicCost);
        expect(normalized.lowerBodyCost).toBe(template.costProfile!.lowerBody);

        const history = normalizeHistory([
            projectedEntry('2026-08-01'),
            projectedEntry('2026-08-02'),
            projectedEntry('2026-08-03'),
        ], '2026-08-04');
        const summary = buildHistoryFeatureSummary(history, '2026-08-04');
        expect(summary.consecutiveHardStreak).toBe(3);
    });

    it('does not rewrite non-projected history', () => {
        const { template, easierDose } = thresholdCrossingFixture();
        const effective = materializeEffectiveDose(template, easierDose);
        const [normalized] = normalizeHistory([{
            date: '2026-08-03',
            templateId: template.id,
            category: template.category,
            modality: template.modality,
            systemicCost: effective.systemicCost,
            lowerBodyCost: effective.costProfile?.lowerBody ?? 0,
        }], '2026-08-04');

        expect(normalized.systemicCost).toBeCloseTo(effective.systemicCost, 8);
        expect(normalized.lowerBodyCost).toBeCloseTo(effective.costProfile!.lowerBody, 8);
    });
});
