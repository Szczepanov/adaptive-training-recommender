import { describe, expect, it } from 'vitest';
import type { DimensionalFatigue, SessionHistoryEntry, SessionTemplate } from '../engine/models';
import { decayFatigue } from '../engine/fatigue';
import {
    evaluateRecoveryConstraints,
    intensityClassForTemplate,
    isIntensityClassAdmissible,
} from '../engine/optimizer';
import { getActiveKnowledgeClaim, KNOWLEDGE_CLAIM_IDS } from './sportsKnowledge';

function template(overrides: Partial<SessionTemplate> = {}): SessionTemplate {
    return {
        id: 'knowledge_alignment_fixture',
        title: 'Knowledge alignment fixture',
        description: 'Synthetic fixture used only to verify evidence-policy alignment.',
        category: 'Technical Skill',
        modality: 'Cycling',
        durationMin: 30,
        durationMax: 30,
        requiredEquipment: [],
        environment: 'either',
        safetyTags: [],
        systemicCost: 0,
        objectiveTransferable: true,
        ...overrides,
    } as SessionTemplate;
}

function history(overrides: Partial<SessionHistoryEntry>): SessionHistoryEntry {
    return {
        date: '2026-08-29',
        modality: 'Cycling',
        role: 'supporting',
        intensityClass: 'easy',
        systemicCost: 0,
        lowerBodyCost: 0,
        ...overrides,
    } as SessionHistoryEntry;
}

describe('load + intensity + recovery product-claim alignment', () => {
    it('pins the registered intensity-band claim to the current public classifier boundary', () => {
        getActiveKnowledgeClaim(KNOWLEDGE_CLAIM_IDS.internalLoadIntensityBands);

        expect(intensityClassForTemplate(template({ systemicCost: 0.29 }))).toBe('easy');
        expect(intensityClassForTemplate(template({ systemicCost: 0.30 }))).toBe('moderate');
        expect(intensityClassForTemplate(template({ systemicCost: 0.59 }))).toBe('moderate');
        expect(intensityClassForTemplate(template({ systemicCost: 0.60 }))).toBe('hard');
        expect(isIntensityClassAdmissible('hard', 0.79)).toBe(false);
        expect(isIntensityClassAdmissible('hard', 0.80)).toBe(true);
    });

    it('pins the rolling hard-density claim to three prior >=0.5 sessions in six days', () => {
        getActiveKnowledgeClaim(KNOWLEDGE_CLAIM_IDS.rollingHardDensityCap);
        const targetDate = '2026-08-30';
        const prior = [
            history({ date: '2026-08-29', systemicCost: 0.5 }),
            history({ date: '2026-08-27', systemicCost: 0.5 }),
            history({ date: '2026-08-25', systemicCost: 0.5 }),
        ];

        expect(evaluateRecoveryConstraints(template({ systemicCost: 0.49 }), targetDate, prior, {}))
            .not.toContain('ROLLING_HARD_CAP_EXCEEDED');
        expect(evaluateRecoveryConstraints(template({ systemicCost: 0.50 }), targetDate, prior, {}))
            .toContain('ROLLING_HARD_CAP_EXCEEDED');
    });

    it('pins previous-day anchor and default hard-lower-body spacing claims', () => {
        getActiveKnowledgeClaim(KNOWLEDGE_CLAIM_IDS.anchorSpacing);
        getActiveKnowledgeClaim(KNOWLEDGE_CLAIM_IDS.hardLowerBodySpacing);
        const targetDate = '2026-08-30';

        const anchorCandidate = template({ category: 'Hard Endurance', systemicCost: 0.6 });
        expect(evaluateRecoveryConstraints(anchorCandidate, targetDate, [history({ role: 'anchor' })], {}))
            .toContain('QUALITY_SPACING_VIOLATION');

        const lowerBodyCandidate = template({
            category: 'Lower-body Strength',
            modality: 'Strength',
            systemicCost: 0.5,
            costProfile: { systemic: 0.5, cardiovascular: 0.1, lowerBody: 0.6, upperBody: 0, impactTissue: 0.2, neuromuscular: 0.5 },
        });
        expect(evaluateRecoveryConstraints(lowerBodyCandidate, targetDate, [history({ lowerBodyCost: 0.6 })], {}))
            .toContain('HARD_LOWER_BODY_SPACING_VIOLATION');
        expect(evaluateRecoveryConstraints(lowerBodyCandidate, targetDate, [history({ date: '2026-08-28', lowerBodyCost: 0.6 })], {}))
            .not.toContain('HARD_LOWER_BODY_SPACING_VIOLATION');
    });

    it('pins the conservative strength/key-cycling adjacency claim without calling it scientific necessity', () => {
        const claim = getActiveKnowledgeClaim(KNOWLEDGE_CLAIM_IDS.strengthEnduranceAdjacency);
        expect(claim.limitations.join(' ')).toContain('same-day strength and endurance training is harmful');

        const keyCyclingCandidate = template({ category: 'Hard Endurance', modality: 'Cycling', systemicCost: 0.6 });
        const priorHeavyStrength = history({
            category: 'Lower-body Strength',
            modality: 'Strength',
            lowerBodyCost: 0.6,
        });
        expect(evaluateRecoveryConstraints(keyCyclingCandidate, '2026-08-30', [priorHeavyStrength], {}))
            .toContain('ANCHOR_PROTECTION_VIOLATION');
    });

    it('pins the registered fatigue half-lives to the current decay model', () => {
        getActiveKnowledgeClaim(KNOWLEDGE_CLAIM_IDS.fatigueDecayHalfLives);
        const full: DimensionalFatigue = {
            systemic: 1,
            cardiovascular: 1,
            lowerBody: 1,
            upperBody: 1,
            impactTissue: 1,
            neuromuscular: 1,
        };

        const after24 = decayFatigue(full, 24);
        const after36 = decayFatigue(full, 36);
        const after48 = decayFatigue(full, 48);
        expect(after24.cardiovascular).toBeCloseTo(0.5, 8);
        expect(after36.systemic).toBeCloseTo(0.5, 8);
        expect(after36.upperBody).toBeCloseTo(0.5, 8);
        expect(after36.neuromuscular).toBeCloseTo(0.5, 8);
        expect(after48.lowerBody).toBeCloseTo(0.5, 8);
        expect(after48.impactTissue).toBeCloseTo(0.5, 8);
    });
});
