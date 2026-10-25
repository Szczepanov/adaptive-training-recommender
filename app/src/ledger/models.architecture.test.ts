import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';

// ADR-0052 Phase 1 (#1144): ledger record types must survive the engine's later deletion
// (Phase 3), so nothing under ledger/ may reach app/src/engine/, directly or transitively.
const LEDGER_DIR = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = dirname(LEDGER_DIR);

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

interface Walk {
    reachedFrom: Map<string, string>;
    unresolved: string[];
}

/** Every app/src file reachable from ledger/ through relative imports, plus edges it could not follow. */
function walkFromLedger(): Walk {
    const reachedFrom = new Map<string, string>();
    const unresolved: string[] = [];
    const queue = sourceFilesUnder(LEDGER_DIR).map(file => ({ file, from: '(ledger root)' }));
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

function exportedNames(relativePath: string): Set<string> {
    const source = ts.createSourceFile(
        relativePath,
        readFileSync(join(SRC_DIR, relativePath), 'utf8'),
        ts.ScriptTarget.Latest,
        false,
    );
    const names = source.statements.flatMap(statement => {
        const exported = ts.canHaveModifiers(statement)
            && ts.getModifiers(statement)?.some(m => m.kind === ts.SyntaxKind.ExportKeyword);
        if (!exported) return [];
        if (ts.isVariableStatement(statement)) {
            return statement.declarationList.declarations.map(d => d.name.getText(source));
        }
        const named = statement as ts.DeclarationStatement;
        return named.name && ts.isIdentifier(named.name) ? [named.name.text] : [];
    });
    return new Set(names);
}

describe('ledger module boundary (ADR-0052)', () => {
    it('has at least one ledger module to check', () => {
        expect(sourceFilesUnder(LEDGER_DIR).length).toBeGreaterThan(0);
    });

    it('never reaches app/src/engine/, directly or transitively', () => {
        const engineReached = [...walkFromLedger().reachedFrom]
            .filter(([file]) => file.startsWith('engine/'))
            .map(([file, from]) => `${from} -> ${file}`);
        expect(engineReached).toEqual([]);
    });

    it('resolves every relative import it walks, so no edge is skipped silently', () => {
        expect(walkFromLedger().unresolved).toEqual([]);
    });

    it('declares no name that engine/models.ts also declares (export * would let the engine copy win)', () => {
        const ledger = exportedNames('ledger/models.ts');
        const shadowed = [...exportedNames('engine/models.ts')].filter(name => ledger.has(name));
        expect(shadowed).toEqual([]);
    });
});
