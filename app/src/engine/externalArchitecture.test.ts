import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';

const ENGINE_DIR = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = dirname(ENGINE_DIR);

function productionFiles(directory = SRC_DIR): string[] {
    return readdirSync(directory, { withFileTypes: true })
        .flatMap(entry => {
            const absolutePath = join(directory, entry.name);
            if (entry.isDirectory()) return productionFiles(absolutePath);
            if (!entry.isFile() || !/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) return [];
            return [absolutePath];
        })
        .sort();
}

function parse(absolutePath: string): ts.SourceFile {
    const fileName = relative(SRC_DIR, absolutePath).replaceAll('\\', '/');
    return ts.createSourceFile(
        fileName,
        readFileSync(absolutePath, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
        fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
}

/** Resolves a relative specifier to a `src/`-relative module path, or null when it points
 * outside the scanned tree (a package, an asset). */
function resolveSpecifier(fromAbsolute: string, specifier: string): string | null {
    if (!specifier.startsWith('.')) return null;
    const base = resolve(dirname(fromAbsolute), specifier);
    for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]) {
        if (existsSync(candidate)) return relative(SRC_DIR, candidate).replaceAll('\\', '/');
    }
    return null;
}

/**
 * `src/`-relative module path -> the modules it imports **at runtime**.
 *
 * `import type` and inline `type` specifiers are excluded deliberately: they are erased
 * before any code runs, so a type-only reference cannot make one module call into another.
 * `externalSession.ts` itself relies on this — it imports `evaluateReadinessAndSafetyEnvelope`
 * from `rules.ts` purely to name its own parameter type.
 */
function runtimeImportGraph(): Map<string, string[]> {
    const graph = new Map<string, string[]>();

    for (const absolutePath of productionFiles()) {
        const source = parse(absolutePath);
        const edges: string[] = [];

        const visit = (node: ts.Node): void => {
            if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
                const clause = node.importClause;
                const typeOnlyDeclaration = clause?.isTypeOnly === true;
                const hasValueBinding = !clause
                    // A side-effect import (`import './x'`) executes the module.
                    || (!typeOnlyDeclaration && (
                        clause.name !== undefined
                        || (clause.namedBindings !== undefined && (
                            ts.isNamespaceImport(clause.namedBindings)
                            || clause.namedBindings.elements.some(element => !element.isTypeOnly)
                        ))
                    ));
                if (hasValueBinding) {
                    const target = resolveSpecifier(absolutePath, node.moduleSpecifier.text);
                    if (target) edges.push(target);
                }
            }
            node.forEachChild(visit);
        };
        visit(source);

        graph.set(relative(SRC_DIR, absolutePath).replaceAll('\\', '/'), edges);
    }

    return graph;
}

/** Shortest runtime import path from `from` to `to`, or null when none exists. */
function importPath(graph: Map<string, string[]>, from: string, to: string): string[] | null {
    const queue: string[][] = [[from]];
    const seen = new Set([from]);
    while (queue.length > 0) {
        const path = queue.shift()!;
        for (const next of graph.get(path[path.length - 1]) ?? []) {
            if (next === to) return [...path, next];
            if (seen.has(next)) continue;
            seen.add(next);
            queue.push([...path, next]);
        }
    }
    return null;
}

describe('external adjudication is not a second selection path', () => {
    const graph = runtimeImportGraph();

    it.each(['engine/optimizer.ts', 'engine/planner.ts', 'engine/microcycle.ts', 'engine/weeklyAllocation.ts'])(
        '%s never reaches externalSession.ts at runtime',
        selectionModule => {
            expect(
                importPath(graph, selectionModule, 'engine/externalSession.ts'),
                'ADR-0019 D-EXT: selection ranks catalog templates and knows nothing about imported ones. '
                + 'An imported session is adjudicated after selection, never alongside it.',
            ).toBeNull();
        },
    );

    it('the critique layer cannot reach adjudication, so no finding can become a verdict', () => {
        // D-CRITIQUE is a one-way boundary. Enforcing it structurally rather than by
        // inspection means a future caller cannot quietly let a weekly finding downgrade a
        // session the athlete's own plan author prescribed.
        expect(
            importPath(graph, 'engine/externalCritique.ts', 'engine/externalSession.ts'),
        ).toBeNull();
    });

    it('adjudication stays free of I/O, so it can be replayed from persisted inputs alone', () => {
        for (const module of ['engine/externalSession.ts', 'engine/externalCritique.ts', 'engine/externalPlacement.ts']) {
            expect(importPath(graph, module, 'firebase.ts'), `${module} performs I/O`).toBeNull();
            expect((graph.get(module) ?? []).filter(edge => edge.startsWith('services/')), module).toEqual([]);
        }
    });

    it('detects a real edge, so a null result above means absence rather than a broken scan', () => {
        expect(importPath(graph, 'engine/externalSession.ts', 'engine/eligibility.ts')).toEqual([
            'engine/externalSession.ts', 'engine/eligibility.ts',
        ]);
        expect(importPath(graph, 'engine/externalCritique.ts', 'engine/optimizer.ts')).not.toBeNull();
    });
});

describe('the decision journal cannot reach the engine (Phase 9.0.6)', () => {
    const graph = runtimeImportGraph();
    const JOURNAL_MODULES = [
        'services/decisionJournalService.ts',
        'engine/shadowLog.ts',
        'services/shadowLogService.ts',
    ];
    const SELECTION_MODULES = ['engine/rules.ts', 'engine/optimizer.ts', 'engine/planner.ts', 'engine/trainingIntent.ts'];

    // A journal the engine reads is evidence contaminated by its own effect -- the same
    // one-way boundary D-CRITIQUE draws for the weekly critique, enforced structurally
    // rather than by intention.
    for (const journalModule of JOURNAL_MODULES) {
        it.each(SELECTION_MODULES)(`%s never reaches ${journalModule} at runtime`, selectionModule => {
            expect(
                importPath(graph, selectionModule, journalModule),
                'Phase 9.0.6: the decision journal and its export are evidence collected to compare '
                + `against the engine, not a second input to it. No production selection or safety `
                + `path may import ${journalModule}.`,
            ).toBeNull();
        });
    }
});
