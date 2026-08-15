import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';

const ENGINE_DIR = dirname(fileURLToPath(import.meta.url));
const MODE_LITERALS = new Set(['evergreen', 'event_directed']);
const DIRECT_PROFILE_BRANCH_ALLOWLIST = new Set(['planningMode.ts', 'validation.ts']);

function productionEngineFiles(): string[] {
    return readdirSync(ENGINE_DIR, { withFileTypes: true })
        .filter(entry => entry.isFile()
            && entry.name.endsWith('.ts')
            && !entry.name.endsWith('.test.ts'))
        .map(entry => entry.name)
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

function containsModeLiteral(node: ts.Node): boolean {
    return subtreeContains(node, candidate => ts.isStringLiteral(candidate) && MODE_LITERALS.has(candidate.text));
}

function lineOf(source: ts.SourceFile, node: ts.Node): number {
    return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

describe('planning-mode architecture authority', () => {
    it('keeps effective planning-mode derivation inside planningMode.ts', () => {
        const violations: string[] = [];

        for (const fileName of productionEngineFiles()) {
            const sourceText = readFileSync(join(ENGINE_DIR, fileName), 'utf8');
            const source = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

            const visit = (node: ts.Node): void => {
                // PlanningContext mode literals are authority output. Production code outside
                // planningMode.ts may consume the resolved value, but must not construct it.
                if (fileName !== 'planningMode.ts'
                    && ts.isPropertyAssignment(node)
                    && propertyName(node.name) === 'mode'
                    && ts.isStringLiteral(node.initializer)
                    && MODE_LITERALS.has(node.initializer.text)) {
                    violations.push(`${fileName}:${lineOf(source, node)} constructs effective mode '${node.initializer.text}'`);
                }

                // Persisted profile validation may inspect planningMode for schema validity;
                // all behavioral branching on that field belongs to planningMode.ts.
                if (!DIRECT_PROFILE_BRANCH_ALLOWLIST.has(fileName)) {
                    const condition = ts.isIfStatement(node) || ts.isWhileStatement(node) || ts.isDoStatement(node)
                        ? node.expression
                        : ts.isConditionalExpression(node) || ts.isSwitchStatement(node)
                            ? node.condition ?? node.expression
                            : null;
                    if (condition && subtreeContains(condition, isPlanningModeAccess)) {
                        violations.push(`${fileName}:${lineOf(source, node)} branches directly on TrainingIntentProfile.planningMode`);
                    }
                }

                // A focus-event null/existence test must never be used outside the authority
                // module to choose one of the effective planning-mode literals.
                if (fileName !== 'planningMode.ts'
                    && (ts.isIfStatement(node) || ts.isConditionalExpression(node))
                    && subtreeContains(node.expression, isFocusEventAccess)
                    && containsModeLiteral(node)) {
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
