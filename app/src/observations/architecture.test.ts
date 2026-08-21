import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';

const OBSERVATIONS_DIR = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = dirname(OBSERVATIONS_DIR);

const SELECTION_PREFIXES = [
    'engine/optimizer',
    'engine/planner',
    'engine/rules',
    'engine/weeklyAllocation',
    'engine/evergreenPlanning',
    'engine/sequenceSearch',
] as const;

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
        const fileName = relative(SRC_DIR, absolutePath).replaceAll('\\', '/');
        const source = ts.createSourceFile(
            fileName,
            readFileSync(absolutePath, 'utf8'),
            ts.ScriptTarget.Latest,
            true,
            fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
        );
        const edges: string[] = [];

        const visit = (node: ts.Node): void => {
            if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
                const clause = node.importClause;
                const typeOnlyDeclaration = clause?.isTypeOnly === true;
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
        graph.set(fileName, edges);
    }

    return graph;
}

function reachableFrom(graph: Map<string, string[]>, start: string): Set<string> {
    const reachable = new Set<string>();
    const queue = [...(graph.get(start) ?? [])];
    while (queue.length > 0) {
        const module = queue.pop()!;
        if (reachable.has(module)) continue;
        reachable.add(module);
        queue.push(...(graph.get(module) ?? []));
    }
    return reachable;
}

function isSelectionModule(path: string): boolean {
    return SELECTION_PREFIXES.some(prefix => path.startsWith(prefix));
}

function isOutcomeEvidenceModule(path: string): boolean {
    return path.startsWith('observations/') || path.startsWith('outcomes/');
}

describe('Performance outcome evidence architecture boundary (OV1.4)', () => {
    const graph = runtimeImportGraph();

    it('observation evidence cannot reach production selection/ranking modules at runtime', () => {
        const observationModules = Array.from(graph.keys()).filter(path => path.startsWith('observations/'));
        expect(observationModules.length).toBeGreaterThan(0);

        for (const module of observationModules) {
            for (const dependency of reachableFrom(graph, module)) {
                expect(
                    isSelectionModule(dependency),
                    `Evidence module "${module}" must not reach production selection module "${dependency}"`,
                ).toBe(false);
            }
        }
    });

    it('production selection/ranking cannot consume OV outcome evidence at runtime, directly or transitively', () => {
        const selectionModules = Array.from(graph.keys()).filter(isSelectionModule);
        expect(selectionModules.length).toBeGreaterThan(0);

        for (const module of selectionModules) {
            for (const dependency of reachableFrom(graph, module)) {
                expect(
                    isOutcomeEvidenceModule(dependency),
                    `Selection module "${module}" must not reach evidence-only module "${dependency}" without a separate ADR/ship decision`,
                ).toBe(false);
            }
        }
    });
});
