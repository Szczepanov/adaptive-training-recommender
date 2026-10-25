import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';

// ADR-0052 Phase 1 (#1144): ledger record types must survive the engine's later deletion
// (Phase 3), so nothing under ledger/ may reach app/src/engine/, directly or transitively.
const LEDGER_DIR = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = dirname(LEDGER_DIR);

function ledgerSourceFiles(): string[] {
    return readdirSync(LEDGER_DIR, { withFileTypes: true })
        .filter(entry => entry.isFile() && /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name))
        .map(entry => join(LEDGER_DIR, entry.name))
        .sort();
}

function resolveSpecifier(fromAbsolute: string, specifier: string): string | null {
    if (!specifier.startsWith('.')) return null;
    const base = resolve(dirname(fromAbsolute), specifier);
    const candidates = /\.tsx?$/.test(base)
        ? [base]
        : [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')];
    return candidates.find(candidate => existsSync(candidate)) ?? null;
}

function relativeImports(absolutePath: string): string[] {
    const source = ts.createSourceFile(absolutePath, readFileSync(absolutePath, 'utf8'), ts.ScriptTarget.Latest, false);
    return source.statements.flatMap(statement => {
        const specifier = (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement))
            ? statement.moduleSpecifier
            : undefined;
        return specifier && ts.isStringLiteral(specifier) ? [specifier.text] : [];
    });
}

/** Every app/src file reachable from the ledger modules through relative imports. */
function reachableFromLedger(): Map<string, string> {
    const reachedFrom = new Map<string, string>();
    const queue = ledgerSourceFiles().map(file => ({ file, from: '(ledger root)' }));
    while (queue.length > 0) {
        const { file, from } = queue.shift()!;
        const key = relative(SRC_DIR, file).replaceAll('\\', '/');
        if (reachedFrom.has(key)) continue;
        reachedFrom.set(key, from);
        for (const specifier of relativeImports(file)) {
            const target = resolveSpecifier(file, specifier);
            if (target) queue.push({ file: target, from: key });
        }
    }
    return reachedFrom;
}

describe('ledger module boundary (ADR-0052)', () => {
    it('has at least one ledger module to check', () => {
        expect(ledgerSourceFiles().length).toBeGreaterThan(0);
    });

    it('never reaches app/src/engine/, directly or transitively', () => {
        const engineReached = [...reachableFromLedger()]
            .filter(([file]) => file.startsWith('engine/'))
            .map(([file, from]) => `${from} -> ${file}`);
        expect(engineReached).toEqual([]);
    });
});
