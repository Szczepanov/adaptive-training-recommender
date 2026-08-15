import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';

const ENGINE_DIR = dirname(fileURLToPath(import.meta.url));
const DIRECT_PROFILE_BRANCH_ALLOWLIST = new Set(['planningMode.ts', 'validation.ts']);

function productionEngineFiles(directory = ENGINE_DIR): string[] {
    return readdirSync(directory, { withFileTypes: true })
        .flatMap(entry => {
            const absolutePath = join(directory, entry.name);
            if (entry.isDirectory()) return productionEngineFiles(absolutePath);
            if (!entry.isFile() || !entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts')) return [];
            return [absolutePath];
        })
        .sort();
}

function propertyName(node: ts.Node): string | null {
    if (ts.isIdentifier(node)) return node.text;
    if (ts.isStringLiteral(node)) return node.text;
    return null;
}

function subtreeContains(node: ts.Node, predicate: (candidate: ts.Node) => boolean): boolean {
    if (predicate(node)) return true;
    let found = false;
    node.forEachChild(child => {
        if (!found && subtreeContains(child, predicate)) found = true;
    });
    return found;
}

function planningModeLiterals(): Set<string> {
    const modelsPath = join(ENGINE_DIR, 'models.ts');
    const source = ts.createSourceFile(
        'models.ts',
        readFileSync(modelsPath, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS,
    );
    const modes = new Set<string>();

    const visit = (node: ts.Node): void => {
        if (ts.isTypeAliasDeclaration(node) && node.name.text === 'PlanningMode') {
            const collectLiteral = (candidate: ts.Node): void => {
                if (ts.isLiteralTypeNode(candidate) && ts.isStringLiteral(candidate.literal)) {
                    modes.add(candidate.literal.text);
                }
                candidate.forEachChild(collectLiteral);
            };
            collectLiteral(node.type);
            return;
        }
        node.forEachChild(visit);
    };
    visit(source);

    if (modes.size === 0) {
        throw new Error('Architecture guard could not resolve PlanningMode literals from engine/models.ts');
    }
    return modes;
}

function isPlanningModeAccess(node: ts.Node): boolean {
    return (ts.isPropertyAccessExpression(node) && node.name.text === 'planningMode')
        || (ts.isElementAccessExpression(node)
            && ts.isStringLiteral(node.argumentExpression)
            && node.argumentExpression.text === 'planningMode');
}

function isFocusEventAccess(node: ts.Node): boolean {
    return (ts.isPropertyAccessExpression(node) && node.name.text === 'focusEvent')
        || (ts.isElementAccessExpression(node)
            && ts.isStringLiteral(node.argumentExpression)
            && node.argumentExpression.text === 'focusEvent');
}

function containsModeLiteral(node: ts.Node, modeLiterals: ReadonlySet<string>): boolean {
    return subtreeContains(node, candidate => ts.isStringLiteral(candidate) && modeLiterals.has(candidate.text));
}

function branchCondition(node: ts.Node): ts.Expression | null {
    if (ts.isIfStatement(node) || ts.isWhileStatement(node) || ts.isDoStatement(node)) return node.expression;
    if (ts.isConditionalExpression(node)) return node.condition;
    if (ts.isSwitchStatement(node)) return node.expression;
    return null;
}

function lineOf(source: ts.SourceFile, node: ts.Node): number {
    return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

describe('planning-mode architecture authority', () => {
    it('keeps effective planning-mode derivation inside planningMode.ts', () => {
        const violations: string[] = [];
        const modeLiterals = planningModeLiterals();

        for (const absolutePath of productionEngineFiles()) {
            const fileName = relative(ENGINE_DIR, absolutePath).replaceAll('\\', '/');
            const baseName = fileName.split('/').at(-1) ?? fileName;
            const sourceText = readFileSync(absolutePath, 'utf8');
            const source = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

            const visit = (node: ts.Node): void => {
                // PlanningContext mode literals are authority output. Production code outside
                // planningMode.ts may consume the resolved value, but must not construct it.
                // Derive the literal set from PlanningMode itself so a future third mode is
                // guarded automatically when the union widens.
                if (baseName !== 'planningMode.ts'
                    && ts.isPropertyAssignment(node)
                    && propertyName(node.name) === 'mode'
                    && ts.isStringLiteral(node.initializer)
                    && modeLiterals.has(node.initializer.text)) {
                    violations.push(`${fileName}:${lineOf(source, node)} constructs effective mode '${node.initializer.text}'`);
                }

                // Persisted profile validation may inspect planningMode for schema validity;
                // all behavioral branching on that field belongs to planningMode.ts.
                if (!DIRECT_PROFILE_BRANCH_ALLOWLIST.has(baseName)) {
                    const condition = branchCondition(node);
                    if (condition && subtreeContains(condition, isPlanningModeAccess)) {
                        violations.push(`${fileName}:${lineOf(source, node)} branches directly on TrainingIntentProfile.planningMode`);
                    }
                }

                // A focus-event null/existence test must never be used outside the authority
                // module to choose one of the effective planning-mode literals.
                const focusCondition = ts.isIfStatement(node)
                    ? node.expression
                    : ts.isConditionalExpression(node)
                        ? node.condition
                        : null;
                if (baseName !== 'planningMode.ts'
                    && focusCondition
                    && subtreeContains(focusCondition, isFocusEventAccess)
                    && containsModeLiteral(node, modeLiterals)) {
                    violations.push(`${fileName}:${lineOf(source, node)} derives planning mode from focusEvent`);
                }

                node.forEachChild(visit);
            };
            visit(source);
        }

        expect(
            violations,
            'ADR-0017 requires planningMode.ts to be the sole authority that derives effective planning mode. Consume PlanningContext.mode downstream instead of re-deriving it.',
        ).toEqual([]);
    });
});
