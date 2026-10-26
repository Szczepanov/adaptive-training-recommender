import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';

// ADR-0052 Phase 1 (#1144): derived metrics and D-FLAGS evaluators must survive the engine's
// later deletion (Phase 3), so nothing under derived/ may reach app/src/engine/, directly or
// transitively. The engine may import derived/; never the reverse. Tests are exempt, so a
// parity test may still compare a derived evaluator with its engine counterpart.
const DERIVED_DIR = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = dirname(DERIVED_DIR);

function sourceFilesUnder(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true })
        .flatMap(entry => {
            const absolutePath = join(directory, entry.name);
            if (entry.isDirectory()) return sourceFilesUnder(absolutePath);
            return entry.isFile() && /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)
                ? [absolutePath]
                : [];
        })
        .sort();
}

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

/** Every app/src file reachable from derived/ through relative imports, plus edges it could not follow. */
function walkFromDerived(): { reachedFrom: Map<string, string>; unresolved: string[] } {
    const reachedFrom = new Map<string, string>();
    const unresolved: string[] = [];
    const queue = sourceFilesUnder(DERIVED_DIR).map(file => ({ file, from: '(derived root)' }));
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

describe('derived module boundary (ADR-0052)', () => {
    it('has at least one derived module to check', () => {
        expect(sourceFilesUnder(DERIVED_DIR).length).toBeGreaterThan(0);
    });

    it('never reaches app/src/engine/, directly or transitively', () => {
        const engineReached = [...walkFromDerived().reachedFrom]
            .filter(([file]) => file.startsWith('engine/'))
            .map(([file, from]) => `${from} -> ${file}`);
        expect(engineReached).toEqual([]);
    });

    it('resolves every relative import it walks, so no edge is skipped silently', () => {
        expect(walkFromDerived().unresolved).toEqual([]);
    });
});
