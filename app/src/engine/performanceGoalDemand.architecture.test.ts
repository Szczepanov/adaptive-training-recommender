import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';

const ENGINE_DIR = dirname(fileURLToPath(import.meta.url));
const FIELD = 'performanceGoalDemands';

function productionEngineFiles(directory = ENGINE_DIR): string[] {
    return readdirSync(directory, { withFileTypes: true })
        .flatMap(entry => {
            const absolutePath = join(directory, entry.name);
            if (entry.isDirectory()) return productionEngineFiles(absolutePath);
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

function hasForbiddenFieldReference(absolutePath: string): boolean {
    const fileName = relative(ENGINE_DIR, absolutePath).replaceAll('\\', '/');
    const source = ts.createSourceFile(
        fileName,
        readFileSync(absolutePath, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
        fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );

    let forbidden = false;
    const visit = (node: ts.Node): void => {
        if (forbidden) return;
        const isExactFieldToken = (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
            && node.text === FIELD;
        if (isExactFieldToken) {
            const isContractDeclaration = fileName === 'models.ts'
                && ts.isPropertySignature(node.parent)
                && node.parent.name === node;
            const isCompositionWrite = fileName === 'adapters.ts'
                && ts.isPropertyAssignment(node.parent)
                && node.parent.name === node;
            if (!isContractDeclaration && !isCompositionWrite) {
                forbidden = true;
                return;
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(source);
    return forbidden;
}

/**
 * Stage 2/PG5.1 (ADR-0041): UserContext.performanceGoalDemands is populated at the
 * composition boundary but must have NO engine consumer yet. Scan every production
 * engine module recursively, not only today's top-level planner files, so a new helper
 * cannot quietly consume the field while the named entry points remain clean.
 *
 * Exactly two source references are allowed:
 * - models.ts declares the UserContext contract;
 * - adapters.ts writes the projection into that contract.
 *
 * Any other engine identifier or computed-string reference is a premature PG5.2/PG7
 * consumer and must fail until the recommendation-authority work lands deliberately.
 */
describe('performanceGoalDemands has no engine consumer yet (Stage 2/PG5.1 scope guard)', () => {
    const files = productionEngineFiles();

    it.each(files)('%s does not consume performanceGoalDemands', absolutePath => {
        expect(
            hasForbiddenFieldReference(absolutePath),
            `Unexpected performanceGoalDemands consumer in ${relative(ENGINE_DIR, absolutePath).replaceAll('\\', '/')}`,
        ).toBe(false);
    });
});
