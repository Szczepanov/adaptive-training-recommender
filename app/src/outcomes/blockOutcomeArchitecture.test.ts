import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';

const OUTCOMES_DIR = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = dirname(OUTCOMES_DIR);

const SELECTION_MODULES = [
    'engine/rules.ts',
    'engine/optimizer.ts',
    'engine/planner.ts',
    'engine/trainingIntent.ts',
] as const;

const BLOCK_EVIDENCE_MODULES = [
    'observations/progress.ts',
    'outcomes/blockOutcome.ts',
    'services/blockOutcomeReportService.ts',
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
    const candidates = /\.tsx?$/.test(base)
        ? [base]
        : [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')];
    for (const candidate of candidates) {
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
            // setParentNodes=false: this file's traversal never reads node.parent, so skip
            // the extra pass the parser would otherwise spend wiring parent pointers up --
            // this parses the whole app source tree synchronously on every run.
            false,
            fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
        );
        const edges: string[] = [];
        const visit = (node: ts.Node): void => {
            if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
                const clause = node.importClause;
                const hasValueBinding = !clause || (!clause.isTypeOnly && (
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
            if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
                const exportClause = node.exportClause;
                const hasValueBinding = !node.isTypeOnly && (
                    exportClause === undefined
                    || (ts.isNamespaceExport(exportClause)
                        ? true
                        : exportClause.elements.some(element => !element.isTypeOnly))
                );
                if (hasValueBinding) {
                    const target = resolveSpecifier(absolutePath, node.moduleSpecifier.text);
                    if (target) edges.push(target);
                }
            }
            if (ts.isCallExpression(node)
                && node.expression.kind === ts.SyntaxKind.ImportKeyword
                && node.arguments.length === 1) {
                const [specifier] = node.arguments;
                if (specifier && ts.isStringLiteral(specifier)) {
                    const target = resolveSpecifier(absolutePath, specifier.text);
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

describe('OV5/OV6 block evidence remains evidence-only', () => {
    const graph = runtimeImportGraph();

    it.each(SELECTION_MODULES)('%s cannot reach progress, block verdict or report service at runtime', selector => {
        expect(graph.has(selector), `selector ${selector} must exist in graph`).toBe(true);
        for (const evidenceModule of BLOCK_EVIDENCE_MODULES) {
            expect(
                importPath(graph, selector, evidenceModule),
                `${selector} must not consume evidence-only ${evidenceModule}`,
            ).toBeNull();
        }
    });

    it('detects a known production edge so absence checks cannot pass with a broken graph', () => {
        expect(importPath(graph, 'engine/planner.ts', 'engine/optimizer.ts')).not.toBeNull();
    });
});
