import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';

// ADR-0052 Phase 1 (#1144 PR1-11): assessment trial reduction and derivation must survive the
// engine's later deletion (Phase 3), so the import graph rooted at assessmentReducers.ts,
// assessmentDerivation.ts and assessmentTrials.ts may never reach app/src/engine/, directly or
// transitively. Note: contextBriefAssessments.ts (which imports UserGoal from engine/models)
// is the known, out-of-scope edge in observations/ and is intentionally not a root here.
const OBSERVATIONS_DIR = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = dirname(OBSERVATIONS_DIR);

const ENTRY_FILES = [
    join(OBSERVATIONS_DIR, 'assessmentReducers.ts'),
    join(OBSERVATIONS_DIR, 'assessmentDerivation.ts'),
    join(OBSERVATIONS_DIR, 'assessmentTrials.ts'),
] as const;

/** Every module a file names: static, re-export, side-effect, inline `import('x').T` and `import()`. */
function specifiersOf(absolutePath: string): string[] {
    const info = ts.preProcessFile(readFileSync(absolutePath, 'utf8'), true, true);
    return info.importedFiles.map(reference => reference.fileName);
}

function resolveSpecifier(fromAbsolute: string, specifier: string): string | null {
    const base = resolve(dirname(fromAbsolute), specifier.split('?')[0]);
    const stem = base.replace(/\.(m?js|jsx)$/, '');
    const candidates = /\.tsx?$/.test(base)
        ? [base]
        : [`${stem}.ts`, `${stem}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')];
    return candidates.find(candidate => existsSync(candidate)) ?? null;
}

/** Every app/src file reachable from the assessment reducer roots through relative imports, plus unresolved edges. */
function walkFromAssessmentReducers(): { reachedFrom: Map<string, string>; unresolved: string[] } {
    const reachedFrom = new Map<string, string>();
    const unresolved: string[] = [];
    const queue = ENTRY_FILES.map(file => ({ file, from: '(assessment reducers root)' }));
    while (queue.length > 0) {
        const { file, from } = queue.shift()!;
        const key = relative(SRC_DIR, file).replaceAll('\\', '/');
        if (reachedFrom.has(key)) continue;
        reachedFrom.set(key, from);
        for (const specifier of specifiersOf(file).filter(s => s.startsWith('.'))) {
            const target = resolveSpecifier(file, specifier);
            if (target) queue.push({ file: target, from: key });
            else unresolved.push(`${key} -> ${specifier}`);
        }
    }
    return { reachedFrom, unresolved };
}

describe('assessment reducers module boundary (ADR-0052, #1144 PR1-11)', () => {
    it('walks all three assessment reducer roots', () => {
        for (const entry of ENTRY_FILES) {
            expect(existsSync(entry)).toBe(true);
        }
    });

    it('never reaches app/src/engine/, directly or transitively', () => {
        const engineReached = [...walkFromAssessmentReducers().reachedFrom]
            .filter(([file]) => file.startsWith('engine/'))
            .map(([file, from]) => `${from} -> ${file}`);
        expect(engineReached).toEqual([]);
    });

    it('resolves every relative import it walks, so no edge is skipped silently', () => {
        expect(walkFromAssessmentReducers().unresolved).toEqual([]);
    });
});
