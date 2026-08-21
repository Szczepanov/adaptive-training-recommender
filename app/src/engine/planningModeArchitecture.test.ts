import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';

const ENGINE_DIR = dirname(fileURLToPath(import.meta.url));
/**
 * Scans the whole application source, not only `engine/`. The rule this guard enforces is
 * about *consumers* of the effective mode, and the consumers most likely to get it wrong
 * are UI components — `WeekAheadStrip.tsx` branched on the persisted profile field and
 * survived an engine-only scan, hiding the evergreen week purpose from precisely the
 * event_directed athletes whose events had passed. `.tsx` is included for the same reason.
 */
const SRC_DIR = dirname(ENGINE_DIR);
/**
 * Paths relative to `src/`, not basenames — the scan now spans directories where a
 * basename could collide. Each entry owns the persisted field itself rather than
 * consuming the effective mode:
 *   - the authority, and the validators that guard the stored value;
 *   - the settings editor, which must read the athlete's *stated* intent in order to let
 *     them change it. Reading the field to edit it is not deriving a mode from it.
 */
const DIRECT_PROFILE_ACCESS_ALLOWLIST = new Set([
    'engine/planningMode.ts',
    'engine/validation.ts',
    // HA1 keeps the pre-existing validators byte-for-byte in validationCore.ts while
    // validation.ts adds the health-context compatibility wrapper. Both remain schema
    // validation boundaries; neither derives the effective runtime planning mode.
    'engine/validationCore.ts',
    'components/preferences/TrainingPlanSection.tsx',
    'components/preferences/usePreferences.ts',
]);

function productionEngineFiles(directory = SRC_DIR): string[] {
    return readdirSync(directory, { withFileTypes: true })
        .flatMap(entry => {
            const absolutePath = join(directory, entry.name);
            if (entry.isDirectory()) return productionEngineFiles(absolutePath);
            if (!entry.isFile() || !/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) return [];
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

function lineOf(source: ts.SourceFile, node: ts.Node): number {
    return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

describe('planning-mode architecture authority', () => {
    it('keeps effective planning-mode derivation inside planningMode.ts, across the whole app', () => {
        const violations: string[] = [];
        const modeLiterals = planningModeLiterals();

        for (const absolutePath of productionEngineFiles()) {
            const fileName = relative(SRC_DIR, absolutePath).replaceAll('\\', '/');
            const sourceText = readFileSync(absolutePath, 'utf8');
            // ScriptKind must follow the extension. Parsing a .tsx file as TS silently
            // disables JSX parsing, so every expression inside a JSX attribute becomes
            // invisible to the traversal below -- which would make the whole reason this
            // scan was widened to components inert.
            const source = ts.createSourceFile(
                fileName, sourceText, ts.ScriptTarget.Latest, true,
                fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
            );

            const visit = (node: ts.Node): void => {
                // PlanningContext mode literals are authority output. Production code outside
                // planningMode.ts may consume the resolved value, but must not construct it.
                // Derive the literal set from PlanningMode itself so a future third mode is
                // guarded automatically when the union widens.
                if (fileName !== 'engine/planningMode.ts'
                    && ts.isPropertyAssignment(node)
                    && propertyName(node.name) === 'mode'
                    && ts.isStringLiteral(node.initializer)
                    && modeLiterals.has(node.initializer.text)) {
                    violations.push(`${fileName}:${lineOf(source, node)} constructs effective mode '${node.initializer.text}'`);
                }

                // No engine module may even read the persisted profile's mode to make its own
                // decision. Validation modules are the only non-authority exceptions because
                // they check the persisted schema rather than deriving runtime behavior. This
                // also catches aliasing such as `const mode = profile.planningMode` before a
                // later branch.
                if (!DIRECT_PROFILE_ACCESS_ALLOWLIST.has(fileName) && isPlanningModeAccess(node)) {
                    violations.push(`${fileName}:${lineOf(source, node)} reads TrainingIntentProfile.planningMode outside the authority`);
                }

                // A focus-event null/existence test must never be used outside the authority
                // module to choose one of the effective planning-mode literals.
                const focusCondition = ts.isIfStatement(node)
                    ? node.expression
                    : ts.isConditionalExpression(node)
                        ? node.condition
                        : null;
                if (fileName !== 'engine/planningMode.ts'
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
