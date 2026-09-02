import { describe, it, expect } from 'vitest';
import {
    evaluateStrengthSpacingStatus,
    classifyCandidateStrength,
    type StrengthExposureLike,
} from './strengthSpacingPolicy';
import { evaluateRecoveryConstraints } from './optimizer';
import type { SessionTemplate, SessionHistoryEntry } from './models';

function createTemplate(overrides: Partial<SessionTemplate> = {}): SessionTemplate {
    return {
        id: 'test_tpl',
        title: 'Test Template',
        description: 'Test description',
        modality: 'Strength',
        category: 'Full-body Strength',
        systemicCost: 0.5,
        durationMin: 45,
        durationMax: 45,
        requiredEquipment: [],
        environment: 'indoor',
        safetyTags: [],
        costProfile: { systemic: 0.5, cardiovascular: 0.1, lowerBody: 0.5, upperBody: 0.5, impactTissue: 0.2, neuromuscular: 0.5 },
        stimulusProfile: { aerobicEndurance: 0.1, thresholdPower: 0, vo2MaxPower: 0, repeatedSurges: 0, sprintPower: 0, fatigueResistance: 0, maxStrength: 0.7, hypertrophy: 0.6 },
        ...overrides,
    };
}

describe('strengthSpacingPolicy', () => {
    const fullBodyCandidate = createTemplate({
        id: 'str_full_03',
        title: 'Reduced Full-body Strength Maintenance',
        category: 'Full-body Strength',
        modality: 'Strength',
    });

    const lowerBodyCandidate = createTemplate({
        id: 'str_lower_01',
        title: 'Lower Body Strength',
        category: 'Lower-body Strength',
        modality: 'Strength',
    });

    const upperBodyCandidate = createTemplate({
        id: 'str_upper_01',
        title: 'Upper-body Strength',
        category: 'Upper-body Strength',
        modality: 'Strength',
        costProfile: { systemic: 0.3, cardiovascular: 0.05, lowerBody: 0, upperBody: 0.6, impactTissue: 0.05, neuromuscular: 0.3 },
    });

    const cyclingCandidate = createTemplate({
        id: 'end_easy_01',
        title: 'Aerobic Recovery Spin',
        category: 'Easy Endurance',
        modality: 'Cycling',
    });

    const plannerGap = { minimumGapDays: 2 } as const;

    describe('classifyCandidateStrength', () => {
        it('classifies explicit strength anatomy and non-strength candidates', () => {
            expect(classifyCandidateStrength(fullBodyCandidate)).toBe('full_body');
            expect(classifyCandidateStrength(lowerBodyCandidate)).toBe('lower_body');
            expect(classifyCandidateStrength(upperBodyCandidate)).toBe('upper_body');
            expect(classifyCandidateStrength(cyclingCandidate)).toBe('none');
        });

        it('fails closed for a Strength candidate without an upper/lower/full category', () => {
            const powerCandidate = createTemplate({ category: 'Power Maintenance', modality: 'Strength' });
            expect(classifyCandidateStrength(powerCandidate)).toBe('full_body');
        });
    });

    describe('evaluateStrengthSpacingStatus', () => {
        it('restricts full-body candidate on Day +1 using the caller-supplied planner gap', () => {
            const history: StrengthExposureLike[] = [{
                localDate: '2026-09-01',
                modality: 'Strength',
                performedOccurrenceId: 'pto-1',
            }];

            const status = evaluateStrengthSpacingStatus(history, '2026-09-02', fullBodyCandidate, plannerGap);
            expect(status.isRestricted).toBe(true);
            expect(status.reasonCode).toBe('RECENT_STRENGTH_SPACING_VIOLATION');
            expect(status.daysSinceLastStrength).toBe(1);
            expect(status.lastStrengthLocalDate).toBe('2026-09-01');
            expect(status.rationale).toContain('minimum 2-day athlete-local date gap');
            expect(status.rationale).not.toContain('48h');
            expect(status.rationale).not.toContain('48 hour');
        });

        it('restricts lower-body candidate after generic provider strength', () => {
            const history: StrengthExposureLike[] = [{
                date: '2026-09-01',
                type: 'strength_training',
            }];

            const status = evaluateStrengthSpacingStatus(history, '2026-09-02', lowerBodyCandidate, plannerGap);
            expect(status.isRestricted).toBe(true);
            expect(status.reasonCode).toBe('RECENT_STRENGTH_SPACING_VIOLATION');
        });

        it('allows upper-body candidate on a later date as the recovery-safe exception', () => {
            const history: StrengthExposureLike[] = [{
                localDate: '2026-09-01',
                modality: 'Strength',
            }];

            const status = evaluateStrengthSpacingStatus(history, '2026-09-02', upperBodyCandidate, plannerGap);
            expect(status.isRestricted).toBe(false);
            expect(status.daysSinceLastStrength).toBe(1);
        });

        it('allows lower/full-body after a proven upper-body-only prior exposure', () => {
            const history: StrengthExposureLike[] = [{
                localDate: '2026-09-01',
                modality: 'Strength',
                category: 'Upper-body Strength',
            }];

            expect(evaluateStrengthSpacingStatus(history, '2026-09-02', lowerBodyCandidate, plannerGap).isRestricted).toBe(false);
            expect(evaluateStrengthSpacingStatus(history, '2026-09-02', fullBodyCandidate, plannerGap).isRestricted).toBe(false);
        });

        it('does not restrict non-strength candidates', () => {
            const history: StrengthExposureLike[] = [{
                localDate: '2026-09-01',
                modality: 'Strength',
            }];

            const status = evaluateStrengthSpacingStatus(history, '2026-09-02', cyclingCandidate, plannerGap);
            expect(status.isRestricted).toBe(false);
        });

        it('restricts a second strength recommendation on the same athlete-local date', () => {
            const history: StrengthExposureLike[] = [{
                localDate: '2026-09-02',
                modality: 'Strength',
            }];

            const status = evaluateStrengthSpacingStatus(history, '2026-09-02', upperBodyCandidate, plannerGap);
            expect(status.isRestricted).toBe(true);
            expect(status.reasonCode).toBe('SAME_DAY_STRENGTH_VIOLATION');
            expect(status.daysSinceLastStrength).toBe(0);
        });

        it('allows full-body once the configured local-day gap is satisfied', () => {
            const history: StrengthExposureLike[] = [{
                localDate: '2026-08-31',
                modality: 'Strength',
            }];

            const status = evaluateStrengthSpacingStatus(history, '2026-09-02', fullBodyCandidate, plannerGap);
            expect(status.isRestricted).toBe(false);
            expect(status.daysSinceLastStrength).toBe(2);
        });

        it('honors an existing planner override of a one-day minimum gap', () => {
            const history: StrengthExposureLike[] = [{
                localDate: '2026-09-01',
                modality: 'Strength',
            }];

            const status = evaluateStrengthSpacingStatus(history, '2026-09-02', fullBodyCandidate, { minimumGapDays: 1 });
            expect(status.isRestricted).toBe(false);
        });
    });

    describe('optimizer integration', () => {
        it('uses canonical performed exposures for the new strength-spacing gate', () => {
            const reasons = evaluateRecoveryConstraints(fullBodyCandidate, '2026-09-02', [], {
                recentPerformedExposures: [{
                    localDate: '2026-09-01',
                    modality: 'Strength',
                    performedOccurrenceId: 'pto-canonical-1',
                }],
                resolveMinimumDaysAfterHardLowerBody: () => undefined,
            });

            expect(reasons).toContain('RECENT_STRENGTH_SPACING_VIOLATION');
        });

        it('does not resurrect legacy recent-strength evidence when canonical facts are explicitly empty', () => {
            const legacyHistory: SessionHistoryEntry[] = [{
                date: '2026-09-01',
                modality: 'Strength',
                role: 'supporting',
                intensityClass: 'easy',
                systemicCost: 0,
                lowerBodyCost: 0,
            }];

            const reasons = evaluateRecoveryConstraints(fullBodyCandidate, '2026-09-02', legacyHistory, {
                recentPerformedExposures: [],
                resolveMinimumDaysAfterHardLowerBody: () => undefined,
            });

            expect(reasons).not.toContain('RECENT_STRENGTH_SPACING_VIOLATION');
        });
    });
});
