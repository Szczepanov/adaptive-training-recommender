import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';

const SESSIONS_DIR = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = dirname(SESSIONS_DIR);

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

function resolveSpecifier(fromAbsolute: string, specifier: string): string | null {
    if (!specifier.startsWith('.')) return null;
    const base = resolve(dirname(fromAbsolute), specifier);
    for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]) {
        if (existsSync(candidate)) return relative(SRC_DIR, candidate).replaceAll('\\', '/');
    }
    return null;
}

function runtimeImportGraph(): Map<string, string[]> {
    const graph = new Map<string, string[]>();

    for (const absolutePath of productionFiles()) {
        const source = parse(absolutePath);
        const edges: string[] = [];

        const visit = (node: ts.Node): void => {
            if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
                const clause = node.importClause;
                const typeOnlyDeclaration = clause?.isTypeOnly === true;
                // `import type { X }` is erased before anything runs, and so is
                // `import { type X }` — the inline specifier form. Counting the inline form
                // as a runtime edge would fail this suite for a module that only names a
                // type, which is exactly what M2.1's `sessions/models.ts` consumers will do
                // under `verbatimModuleSyntax`. A bare `import './x'` does execute.
                const hasValueBinding = !clause
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
            ts.forEachChild(node, visit);
        };

        visit(source);
        graph.set(relative(SRC_DIR, absolutePath).replaceAll('\\', '/'), edges);
    }

    return graph;
}

describe('Multidomain sessions architecture and dependency boundaries (M0.3 / ADR-0023)', () => {
    const graph = runtimeImportGraph();

    it('sessions/ domain modules do not import engine optimizer or planner modules at runtime', () => {
        const forbiddenPrefixes = [
            'engine/optimizer',
            'engine/planner',
            'engine/rules',
            'engine/weeklyAllocation',
            'engine/evergreenPlanning',
            'engine/sequenceSearch',
        ];

        const sessionModules = Array.from(graph.keys()).filter(path => path.startsWith('sessions/'));

        for (const mod of sessionModules) {
            const imports = graph.get(mod) ?? [];
            for (const imp of imports) {
                for (const forbidden of forbiddenPrefixes) {
                    expect(
                        imp.startsWith(forbidden),
                        `Session domain module "${mod}" must not import selection/ranking module "${imp}"`,
                    ).toBe(false);
                }
            }
        }
    });

    it('new session UI components do not import optimizer policy or ranking internals at runtime', () => {
        const forbiddenOptimizer = [
            'engine/optimizer',
            'engine/planner',
            'engine/rules',
            'engine/weeklyAllocation',
            'engine/evergreenPlanning',
            'engine/sequenceSearch',
        ];

        // Legacy Home currently composes recommendation evaluation and therefore imports
        // engine/rules.ts. ADR-0023 does not silently refactor that established boundary;
        // it prevents the new general runner/session UI from adding another policy entry.
        const uiModules = Array.from(graph.keys()).filter(path => path.startsWith('components/session/'));

        for (const mod of uiModules) {
            const imports = graph.get(mod) ?? [];
            for (const imp of imports) {
                for (const forbidden of forbiddenOptimizer) {
                    expect(
                        imp.startsWith(forbidden),
                        `UI component "${mod}" must not import optimizer internal "${imp}"`,
                    ).toBe(false);
                }
            }
        }
    });
});
