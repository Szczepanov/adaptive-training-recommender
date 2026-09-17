import { describe, expect, it } from 'vitest';
import { splitCoachingRationale } from './rationaleDisplay';

const CURRENT_OPTIMIZER_TECHNICAL_CLAUSES = [
    '(Advances mandatory weekly recovery placement.)',
    '(Eligible for proactive weekly recovery placement.)',
    '(Advances an explicit required weekly programming role.)',
    "(Soft penalty applied: modality 'Running' is marked as avoided/disliked).",
    '(Event-modality coverage: Cycling has no exposure in the rolling 6-day history.)',
    '(Sequence intent: recondition/spread, preferred key gap 2d.)',
    '(Sequence soft preference x0.75: key-session gap 1d is below preferred 2d.)',
] as const;

describe('splitCoachingRationale', () => {
    it('separates the leading score sentence and technical parentheticals from the coaching narrative', () => {
        const result = splitCoachingRationale(
            'Base phase build toward your goal event. Coverage tier: 1. Benefit score: 3.40, Fatigue cost penalty: 0.12. (Advances an explicit required weekly programming role.) (Sequence intent: recondition/spread, preferred key gap 2d.)',
        );

        expect(result.coachingNarrative).toBe('Base phase build toward your goal event.');
        expect(result.technicalDetail).toContain('Coverage tier: 1. Benefit score: 3.40, Fatigue cost penalty: 0.12.');
        expect(result.technicalDetail).toContain('(Sequence intent: recondition/spread, preferred key gap 2d.)');
    });

    it.each(CURRENT_OPTIMIZER_TECHNICAL_CLAUSES)(
        'extracts the current optimizer technical suffix %s',
        clause => {
            const result = splitCoachingRationale(
                `Base phase (keep the effort conversational). Coverage tier: 1. Benefit score: 2.50, Fatigue cost penalty: 0.40. ${clause}`,
            );

            expect(result.coachingNarrative).toBe('Base phase (keep the effort conversational).');
            expect(result.technicalDetail).toContain('Coverage tier: 1. Benefit score: 2.50, Fatigue cost penalty: 0.40.');
            expect(result.technicalDetail).toContain(clause);
        },
    );

    it('leaves a rationale with no engine scoring internals untouched', () => {
        const result = splitCoachingRationale('Readiness is solid.');

        expect(result.coachingNarrative).toBe('Readiness is solid.');
        expect(result.technicalDetail).toBeNull();
    });

    it('preserves a genuinely athlete-relevant parenthetical, e.g. explaining a Rest/Mobility default', () => {
        const result = splitCoachingRationale('Rest day (no session template matched today\'s constraints).');

        expect(result.coachingNarrative).toBe('Rest day (no session template matched today\'s constraints).');
        expect(result.technicalDetail).toBeNull();
    });

    it('preserves athlete-facing text on both sides of an embedded score block', () => {
        const result = splitCoachingRationale(
            'Keep today aerobic. Coverage tier: 3. Benefit score: 1.10, Fatigue cost penalty: 0.20. Stay relaxed on the climbs.',
        );

        expect(result.coachingNarrative).toBe('Keep today aerobic. Stay relaxed on the climbs.');
        expect(result.technicalDetail).toBe('Coverage tier: 3. Benefit score: 1.10, Fatigue cost penalty: 0.20.');
    });

    it('falls back to a generic coaching narrative when the rationale is entirely scoring formula', () => {
        const result = splitCoachingRationale('Coverage tier: 2. Benefit score: 2.10, Fatigue cost penalty: 0.05.');

        expect(result.coachingNarrative).toBe('Optimized for current weekly phase and recovery balance.');
        expect(result.technicalDetail).toBe('Coverage tier: 2. Benefit score: 2.10, Fatigue cost penalty: 0.05.');
    });
});
