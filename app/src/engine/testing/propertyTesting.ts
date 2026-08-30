import { createPseudoRandom, type PseudoRandom } from './adversarialGenerators';

export interface PropertyTestOptions {
    iterations?: number;
    seed?: number;
}

export interface PropertyTestResult {
    passed: boolean;
    iterations: number;
    seed: number;
    counterexample?: unknown;
    error?: Error;
}

/**
 * Lightweight, deterministic property testing runner.
 * Evaluates the predicate `property(sample, index)` across N generated samples.
 */
export function checkProperty<T>(
    generator: (prng: PseudoRandom, index: number) => T,
    property: (sample: T, index: number) => void,
    options: PropertyTestOptions = {},
): PropertyTestResult {
    const iterations = options.iterations ?? 500;
    const seed = options.seed ?? 4242;
    const prng = createPseudoRandom(seed);

    for (let i = 0; i < iterations; i++) {
        const sample = generator(prng, i);
        try {
            property(sample, i);
        } catch (error) {
            return {
                passed: false,
                iterations: i + 1,
                seed,
                counterexample: sample,
                error: error instanceof Error ? error : new Error(String(error)),
            };
        }
    }

    return {
        passed: true,
        iterations,
        seed,
    };
}
