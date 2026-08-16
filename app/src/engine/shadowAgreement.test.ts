import { describe, expect, it } from 'vitest';
import { allShadowVerdictPairs, classifyAgreement, resolveEngineShadowVerdict, type AgreementClass } from './shadowAgreement';
import { SHADOW_VERDICTS, type ShadowVerdict } from './models';

// Every ordered pair of the five ShadowVerdict values, with its expected class asserted
// explicitly -- 9.0.4's "done when" requires every pair to have an asserted class, not
// just the ones that happen to exercise a code path.
const EXPECTED: Array<[ShadowVerdict, ShadowVerdict, AgreementClass]> = [
    ['proceed', 'proceed', 'agree'],
    ['proceed', 'scale', 'engine_less_conservative'],
    ['proceed', 'defer', 'engine_less_conservative'],
    ['proceed', 'skip', 'engine_less_conservative'],
    ['proceed', 'advisory', 'incomparable'],

    ['scale', 'proceed', 'engine_more_conservative'],
    ['scale', 'scale', 'agree'],
    ['scale', 'defer', 'engine_less_conservative'],
    ['scale', 'skip', 'engine_less_conservative'],
    ['scale', 'advisory', 'incomparable'],

    ['defer', 'proceed', 'engine_more_conservative'],
    ['defer', 'scale', 'engine_more_conservative'],
    ['defer', 'defer', 'agree'],
    ['defer', 'skip', 'agree'],
    ['defer', 'advisory', 'incomparable'],

    ['skip', 'proceed', 'engine_more_conservative'],
    ['skip', 'scale', 'engine_more_conservative'],
    ['skip', 'defer', 'agree'],
    ['skip', 'skip', 'agree'],
    ['skip', 'advisory', 'incomparable'],

    ['advisory', 'proceed', 'incomparable'],
    ['advisory', 'scale', 'incomparable'],
    ['advisory', 'defer', 'incomparable'],
    ['advisory', 'skip', 'incomparable'],
    ['advisory', 'advisory', 'incomparable'],
];

describe('resolveEngineShadowVerdict', () => {
    it('uses the mode ladder only when no exact imported-session verdict exists', () => {
        expect(resolveEngineShadowVerdict('train')).toBe('proceed');
        expect(resolveEngineShadowVerdict('modify')).toBe('scale');
        expect(resolveEngineShadowVerdict('recover')).toBe('defer');
    });

    it.each(SHADOW_VERDICTS)('preserves exact imported-session decision %s regardless of three-value mode', verdict => {
        expect(resolveEngineShadowVerdict('train', verdict)).toBe(verdict);
        expect(resolveEngineShadowVerdict('modify', verdict)).toBe(verdict);
        expect(resolveEngineShadowVerdict('recover', verdict)).toBe(verdict);
    });
});

describe('classifyAgreement', () => {
    it('covers every ordered pair of the five ShadowVerdict values (5x5 = 25)', () => {
        expect(EXPECTED).toHaveLength(25);
        expect(allShadowVerdictPairs()).toHaveLength(25);
        const coveredPairs = new Set(EXPECTED.map(([engine, external]) => `${engine}:${external}`));
        for (const [engine, external] of allShadowVerdictPairs()) {
            expect(coveredPairs.has(`${engine}:${external}`), `${engine} vs ${external} not covered`).toBe(true);
        }
    });

    it.each(EXPECTED)('classifies engine=%s vs external=%s as %s', (engine, external, expected) => {
        expect(classifyAgreement(engine, external)).toBe(expected);
    });

    it('asserts advisory rows as incomparable in both directions', () => {
        for (const verdict of SHADOW_VERDICTS) {
            expect(classifyAgreement('advisory', verdict)).toBe('incomparable');
            expect(classifyAgreement(verdict, 'advisory')).toBe('incomparable');
        }
    });

    it('treats defer and skip as equally conservative in both directions -- a placement question, not a load one', () => {
        expect(classifyAgreement('defer', 'skip')).toBe('agree');
        expect(classifyAgreement('skip', 'defer')).toBe('agree');
    });

    it('is symmetric in direction: swapping engine/external flips more/less conservative but not agree/incomparable', () => {
        for (const [engine, external] of allShadowVerdictPairs()) {
            const forward = classifyAgreement(engine, external);
            const backward = classifyAgreement(external, engine);
            if (forward === 'agree') expect(backward).toBe('agree');
            else if (forward === 'incomparable') expect(backward).toBe('incomparable');
            else if (forward === 'engine_more_conservative') expect(backward).toBe('engine_less_conservative');
            else expect(backward).toBe('engine_more_conservative');
        }
    });
});
