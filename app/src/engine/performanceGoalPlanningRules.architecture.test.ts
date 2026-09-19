import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';

const ENGINE_DIR = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = dirname(ENGINE_DIR);
const MODULE_FILE = 'engine/performanceGoalPlanningRules.ts';

function productionSourceFiles(directory = SRC_DIR): string[] {
    return readdirSync(directory, { withFileTypes: true })
        .flatMap(entry => {
            const absolutePath = join(directory, entry.name);
            if (entry.isDirectory()) return productionSourceFiles(absolutePath);
            if (
                !entry.isFile()
                || !/\.tsx?$/.test(entry.name)
                || /\.test\.tsx?$/.test(entry.name)
                || /\.d\.ts$/.test(entry.name)
            ) return [];
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

function importsPlanningRulesModule(absolutePath: string): boolean {
    const fileName = relative(SRC_DIR, absolutePath).replaceAll('\\', '/');
    const source = ts.createSourceFile(
        fileName,
        readFileSync(absolutePath, 'utf8'),
        ts.ScriptTarget.Latest,
        false,
        fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );

    let imports = false;
    const visit = (node: ts.Node): void => {
        if (imports) return;
        // Dynamic `await import('./x')` is this codebase's own documented lazy-import pattern
        // for evaluators that reach for IO only when the caller injected no provider (see
        // CLAUDE.md and existing uses in rules.ts/trainingIntent.ts/replay.ts) -- a future PG7
        // consumer could plausibly reach for exactly this pattern, so it must be caught just
        // like a static import/re-export.
        const isDynamicImportCall = ts.isCallExpression(node)
            && node.expression.kind === ts.SyntaxKind.ImportKeyword
            && node.arguments.length > 0
            && ts.isStringLiteralLike(node.arguments[0]);
        const specifier = ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)
            ? node.moduleSpecifier
            : ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)
                ? node.moduleSpecifier
                : isDynamicImportCall
                    ? (node.arguments[0] as ts.StringLiteralLike)
                    : null;
        if (specifier && resolveSpecifier(absolutePath, specifier.text) === MODULE_FILE) {
            imports = true;
            return;
        }
        ts.forEachChild(node, visit);
    };
    visit(source);
    return imports;
}

/**
 * Stage 2/PG5.2 (plan section PG5): performanceGoalPlanningRules.ts is shipped as a
 * fully-implemented, reviewed registry with no production consumer yet, mirroring PG5.1's
 * performanceGoalDemand.architecture.test.ts guard. PG7 deliberately relaxes this once weekly
 * allocation/reservation actually wires the classifier in (see the plan's PG5 "Recommended
 * next-session sequencing" note and docs/analysis/2026-09-19-stage2-weekly-allocation-
 * integration-points.md).
 */
describe('performanceGoalPlanningRules has no production consumer yet (Stage 2/PG5.2 scope guard)', () => {
    const files = productionSourceFiles().filter(absolutePath => relative(SRC_DIR, absolutePath).replaceAll('\\', '/') !== MODULE_FILE);

    it.each(files)('%s does not import performanceGoalPlanningRules', absolutePath => {
        expect(
            importsPlanningRulesModule(absolutePath),
            `Unexpected performanceGoalPlanningRules consumer in ${relative(SRC_DIR, absolutePath).replaceAll('\\', '/')}`,
        ).toBe(false);
    });
});
