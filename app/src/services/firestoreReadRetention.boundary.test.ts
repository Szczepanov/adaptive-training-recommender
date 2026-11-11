import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

// Collections written with `runTransaction`. A retained watch target sees a transaction
// commit only when the watch stream pushes it, so retaining these would let a read right
// after a commit (including a write guard elsewhere) return pre-commit state. See
// firestoreReadRetention.ts.
const TRANSACTION_WRITTEN = [
    'daily_recommendations',
    'session_occurrences',
    'external_plans',
    'trainingSettings',
    'execution_prescriptions',
    'progression_experiment_claim',
    'progression_experiment_activations',
    'intent_blocks',
];

const SRC = join(__dirname, '..');

function sourceFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) return sourceFiles(path);
        return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
    });
}

describe('firestoreReadRetention boundary', () => {
    it('is not used by a module that reads a transaction-written collection', () => {
        const offenders = sourceFiles(SRC)
            .filter(path => /\bget(?:Doc|Docs)Retained\b/.test(readFileSync(path, 'utf8')))
            .filter(path => !path.endsWith('firestoreReadRetention.ts'))
            .flatMap(path => {
                const text = readFileSync(path, 'utf8');
                return TRANSACTION_WRITTEN
                    .filter(name => new RegExp(`['"\`/]${name}['"\`/]`).test(text))
                    .map(name => `${relative(SRC, path)} references ${name}`);
            });
        expect(offenders).toEqual([]);
    });
});
