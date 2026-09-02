import { describe, it, expect } from 'vitest';
import {
    evaluateStrengthSpacingStatus,
    classifyCandidateStrength,
    type StrengthExposureLike,
} from './strengthSpacingPolicy';
import type { SessionTemplate } from './models';

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

    describe('classifyCandidateStrength', () => {
        it('classifies full-body, lower-body, upper-body, and non-strength', () => {
            expect(classifyCandidateStrength(fullBodyCandidate)).toBe('full_body');
            expect(classifyCandidateStrength(lowerBodyCandidate)).toBe('lower_body');
            expect(classifyCandidateStrength(upperBodyCandidate)).toBe('upper_body');
            expect(classifyCandidateStrength(cyclingCandidate)).toBe('none');
        });
    });

    describe('evaluateStrengthSpacingStatus', () => {
        it('restricts full-body candidate on Day +1 following previous-day strength', () => {
            const history: StrengthExposureLike[] = [{
                date: '2026-09-01',
                modality: 'Strength',
                performedOccurrenceId: 'pto-1',
            }];

            const status = evaluateStrengthSpacingStatus(history, '2026-09-02', fullBodyCandidate);
            expect(status.isRestricted).toBe(true);
            expect(status.reasonCode).toBe('RECENT_STRENGTH_SPACING_VIOLATION');
            expect(status.daysSinceLastStrength).toBe(1);
            expect(status.lastStrengthLocalDate).toBe('2026-09-01');
            expect(status.rationale).toContain('2026-09-01');
            expect(status.rationale).toContain('requires 48h spacing');
        });

        it('restricts lower-body candidate on Day +1 following previous-day strength', () => {
            const history: StrengthExposureLike[] = [{
                date: '2026-09-01',
                type: 'strength_training', // e.g. Garmin type
            }];

            const status = evaluateStrengthSpacingStatus(history, '2026-09-02', lowerBodyCandidate);
            expect(status.isRestricted).toBe(true);
            expect(status.reasonCode).toBe('RECENT_STRENGTH_SPACING_VIOLATION');
        });

        it('allows upper-body candidate on Day +1 as a recovery-safe exception', () => {
            const history: StrengthExposureLike[] = [{
                date: '2026-09-01',
                modality: 'Strength',
            }];

            const status = evaluateStrengthSpacingStatus(history, '2026-09-02', upperBodyCandidate);
            expect(status.isRestricted).toBe(false);
            expect(status.daysSinceLastStrength).toBe(1);
        });

        it('does not restrict non-strength candidates (e.g. cycling/running)', () => {
            const history: StrengthExposureLike[] = [{
                date: '2026-09-01',
                modality: 'Strength',
            }];

            const status = evaluateStrengthSpacingStatus(history, '2026-09-02', cyclingCandidate);
            expect(status.isRestricted).toBe(false);
        });

        it('restricts any strength candidate on the same calendar day (diff = 0)', () => {
            const history: StrengthExposureLike[] = [{
                date: '2026-09-02',
                modality: 'Strength',
            }];

            const status = evaluateStrengthSpacingStatus(history, '2026-09-02', upperBodyCandidate);
            expect(status.isRestricted).toBe(true);
            expect(status.reasonCode).toBe('SAME_DAY_STRENGTH_VIOLATION');
            expect(status.daysSinceLastStrength).toBe(0);
        });

        it('allows full-body candidate when 2 or more days have elapsed (diff >= 2)', () => {
            const history: StrengthExposureLike[] = [{
                date: '2026-08-31',
                modality: 'Strength',
            }];

            const status = evaluateStrengthSpacingStatus(history, '2026-09-02', fullBodyCandidate);
            expect(status.isRestricted).toBe(false);
            expect(status.daysSinceLastStrength).toBe(2);
        });

        it('respects explicit allowConsecutiveFullBody override', () => {
            const history: StrengthExposureLike[] = [{
                date: '2026-09-01',
                modality: 'Strength',
            }];

            const status = evaluateStrengthSpacingStatus(history, '2026-09-02', fullBodyCandidate, {
                allowConsecutiveFullBody: true,
            });
            expect(status.isRestricted).toBe(false);
        });
    });
});
