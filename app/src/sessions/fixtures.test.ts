import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EXERCISES } from '../workouts/exercises';

/**
 * Guards the M0.2 reviewed fixture corpus.
 *
 * The corpus is normative: ADR-0023 D-MSESSION says the fixtures define what the schema
 * must express, and plan items M2.1 (validators), M3.7 (import preview), M4.x (runner) and
 * the visual suite all build against them. A fixture that lies about its own content is
 * therefore worse than a missing one — it teaches every downstream consumer the wrong shape.
 *
 * This file caught seven `kind: "catalog"` references to exercise ids absent from
 * `workouts/exercises.ts` on the day the corpus landed. Without it, M2.1's resolver would
 * have been written against dangling references.
 */

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const INVALID_CASES_PATH = join(FIXTURES_DIR, 'invalid', 'invalid-cases.json');
const CATALOG_IDS = new Set(EXERCISES.map(exercise => exercise.id));
const SESSION_INTENTS = new Set([
    'training', 'testing', 'competition', 'rehab_return', 'recovery', 'skill_technical',
]);
const CHOICE_ACTION_KINDS = new Set([
    'select_alternative', 'reduce_load_percent', 'reduce_sets', 'reduce_reps',
    'omit_step', 'end_block', 'end_session',
]);

interface FixtureFile {
    name: string;
    json: unknown;
}

function fixtureFiles(): FixtureFile[] {
    return readdirSync(FIXTURES_DIR)
        .filter(name => name.endsWith('.json'))
        .sort()
        .map(name => ({ name, json: JSON.parse(readFileSync(join(FIXTURES_DIR, name), 'utf8')) as unknown }));
}

/** Every `exerciseRef` in the tree, paired with a readable path to it. */
function exerciseRefs(node: unknown, path = '$'): { path: string; ref: Record<string, unknown> }[] {
    if (Array.isArray(node)) {
        return node.flatMap((child, index) => exerciseRefs(child, `${path}[${index}]`));
    }
    if (node === null || typeof node !== 'object') return [];

    const record = node as Record<string, unknown>;
    const here = typeof record.exerciseRef === 'object' && record.exerciseRef !== null
        ? [{ path: `${path}.exerciseRef`, ref: record.exerciseRef as Record<string, unknown> }]
        : [];

    return [
        ...here,
        ...Object.entries(record).flatMap(([key, value]) => exerciseRefs(value, `${path}.${key}`)),
    ];
}

function collectSteps(node: unknown): Record<string, unknown>[] {
    if (Array.isArray(node)) return node.flatMap(collectSteps);
    if (node === null || typeof node !== 'object') return [];
    const record = node as Record<string, unknown>;
    const here = record.kind === 'exercise' && typeof record.id === 'string' ? [record] : [];
    return [...here, ...Object.values(record).flatMap(collectSteps)];
}

function collectBlocks(node: unknown): Record<string, unknown>[] {
    if (Array.isArray(node)) return node.flatMap(collectBlocks);
    if (node === null || typeof node !== 'object') return [];
    const record = node as Record<string, unknown>;
    const here = typeof record.id === 'string' && Array.isArray(record.steps) && typeof record.executionMode === 'string'
        ? [record]
        : [];
    return [...here, ...Object.values(record).flatMap(collectBlocks)];
}

function invalidCases(): Record<string, unknown>[] {
    const manifest = JSON.parse(readFileSync(INVALID_CASES_PATH, 'utf8')) as Record<string, unknown>;
    return Array.isArray(manifest.cases) ? manifest.cases as Record<string, unknown>[] : [];
}

describe('M0.2 fixture corpus', () => {
    const files = fixtureFiles();

    it('is present and covers the seven concepts the plan enumerates', () => {
        expect(files.length, 'M0.2 requires a fixture per enumerated concept').toBeGreaterThanOrEqual(7);
    });

    it.each(fixtureFiles().map(file => file.name))('%s uses the canonical v1 identity and intent vocabulary', name => {
        const file = files.find(candidate => candidate.name === name)!;
        expect(file.json, 'a fixture must be an object').toBeTypeOf('object');
        const definition = file.json as Record<string, unknown>;
        expect(definition.schemaVersion, `${name} must declare schemaVersion 1`).toBe(1);
        expect(definition.id, `${name} must use stable id, not definitionId`).toBeTypeOf('string');
        expect(definition.revision, `${name} must declare an immutable revision`).toBeTypeOf('number');
        expect(SESSION_INTENTS.has(String(definition.intent)), `${name} must declare a supported session intent`).toBe(true);
        expect(definition).not.toHaveProperty('schema');
        expect(definition).not.toHaveProperty('definitionId');

        for (const { path, ref } of exerciseRefs(definition)) {
            expect(ref.kind, `${name} ${path} must discriminate with exerciseRef.kind`).toBeTypeOf('string');
            expect(ref).not.toHaveProperty('state');
        }
    });

    // The defect this file exists for. A `catalog` ref asserts that the resolver can reach
    // real metadata — safety tags, equipment, contraindications. Claiming it for an id that
    // does not exist is exactly the "custom metadata creates false safety" risk the plan's
    // risk table names, arriving through the front door instead.
    it('never claims catalog resolution for an exercise id that does not exist', () => {
        const dangling = files.flatMap(file =>
            exerciseRefs(file.json)
                .filter(({ ref }) => ref.kind === 'catalog')
                .filter(({ ref }) => !CATALOG_IDS.has(String(ref.exerciseId)))
                .map(({ path, ref }) => `${file.name} ${path} -> ${String(ref.exerciseId)}`),
        );

        expect(
            dangling,
            'Either add the movement to workouts/exercises.ts (plan M3.5) or mark the step '
            + 'unresolved_free_text. Do not remap it to a similar catalog movement: a back squat '
            + 'is not a front squat, and the substitution would silently claim the wrong safety '
            + 'and cost metadata.',
        ).toEqual([]);
    });

    it('marks every unresolved movement with a display name and a resolution note', () => {
        const steps = files.flatMap(file =>
            collectSteps(file.json).map(step => ({ file: file.name, step })),
        );
        const unresolved = steps.filter(({ step }) => {
            const ref = step.exerciseRef as Record<string, unknown> | undefined;
            return ref?.kind === 'unresolved_free_text';
        });

        expect(unresolved.length, 'the corpus must exercise the unresolved path').toBeGreaterThan(0);

        for (const { file, step } of unresolved) {
            const ref = step.exerciseRef as Record<string, unknown>;
            const name = ref.name;
            expect(name, `${file} ${String(step.id)} needs a display name`).toBeTypeOf('string');

            // Two representations are legitimate and the corpus uses both: a step-level
            // `resolutionNote` travels with the step into the runner, while a file-level
            // `importWarnings` entry records what the importer flagged at parse time. Require
            // one of them — what must never happen is an unresolved movement carrying no
            // statement at all of what it may not claim.
            const importWarnings = (files.find(candidate => candidate.name === file)!.json as Record<string, unknown>)
                .importWarnings;
            const warned = Array.isArray(importWarnings)
                && importWarnings.some(warning => typeof warning === 'string' && warning.length > 0);

            expect(
                typeof step.resolutionNote === 'string' || warned,
                `${file} ${String(step.id)}: an unresolved movement must say what it may not claim, `
                + 'either as a step-level resolutionNote or a file-level importWarnings entry',
            ).toBe(true);
        }
    });

    // Performed entries reference planned steps by id (ADR-0023 D-MENTRY). A duplicate id
    // makes that reference ambiguous and the ambiguity only surfaces in stored history.
    it.each(fixtureFiles().map(file => file.name))('%s has unique step ids', name => {
        const file = files.find(candidate => candidate.name === name)!;
        const ids = collectSteps(file.json).map(step => String(step.id));
        expect(ids.length - new Set(ids).size, `${name} repeats a step id`).toBe(0);
    });

    it('resolves every companion reference to another reviewed definition', () => {
        const definitionIds = new Set(files.map(file => String((file.json as Record<string, unknown>).id)));
        const dangling: string[] = [];

        for (const file of files) {
            const companions = (file.json as Record<string, unknown>).companionSessions;
            if (!Array.isArray(companions)) continue;
            for (const companion of companions) {
                if (companion === null || typeof companion !== 'object') continue;
                const record = companion as Record<string, unknown>;
                if (!definitionIds.has(String(record.definitionRef))) {
                    dangling.push(`${file.name} ${String(record.id)} -> ${String(record.definitionRef)}`);
                }
                expect(record).not.toHaveProperty('instructions');
            }
        }

        expect(dangling, 'A companion is a separately executable definition, not display-only instructions').toEqual([]);
    });

    it('uses only bounded option actions with resolvable targets', () => {
        const issues: string[] = [];

        for (const file of files) {
            const blocks = collectBlocks(file.json);
            const blockIds = new Set(blocks.map(block => String(block.id)));
            const steps = collectSteps(file.json);
            const stepsById = new Map(steps.map(step => [String(step.id), step]));

            for (const block of blocks) {
                if (!Array.isArray(block.optionSets)) continue;
                for (const optionSet of block.optionSets) {
                    if (optionSet === null || typeof optionSet !== 'object') continue;
                    const choice = optionSet as Record<string, unknown>;
                    if (!stepsById.has(String(choice.appliesAtStepId))) {
                        issues.push(`${file.name} ${String(choice.id)} has dangling appliesAtStepId`);
                    }
                    if (!Array.isArray(choice.options)) continue;
                    for (const option of choice.options) {
                        if (option === null || typeof option !== 'object') continue;
                        const optionRecord = option as Record<string, unknown>;
                        if (!Array.isArray(optionRecord.actions)) {
                            issues.push(`${file.name} ${String(choice.id)}/${String(optionRecord.id)} has no actions array`);
                            continue;
                        }
                        for (const action of optionRecord.actions) {
                            if (action === null || typeof action !== 'object') continue;
                            const actionRecord = action as Record<string, unknown>;
                            const kind = String(actionRecord.kind);
                            if (!CHOICE_ACTION_KINDS.has(kind)) {
                                issues.push(`${file.name} ${String(choice.id)} has unsupported action ${kind}`);
                            }
                            if ('targetStepId' in actionRecord && !stepsById.has(String(actionRecord.targetStepId))) {
                                issues.push(`${file.name} ${String(choice.id)} has dangling targetStepId`);
                            }
                            if ('targetBlockId' in actionRecord && !blockIds.has(String(actionRecord.targetBlockId))) {
                                issues.push(`${file.name} ${String(choice.id)} has dangling targetBlockId`);
                            }
                            if (kind === 'select_alternative') {
                                const target = stepsById.get(String(actionRecord.targetStepId));
                                const alternatives = Array.isArray(target?.alternatives) ? target.alternatives : [];
                                const hasAlternative = alternatives.some(alternative =>
                                    alternative !== null
                                    && typeof alternative === 'object'
                                    && String((alternative as Record<string, unknown>).id) === String(actionRecord.alternativeId));
                                if (!hasAlternative) issues.push(`${file.name} ${String(choice.id)} has dangling alternativeId`);
                            }
                        }
                    }
                }
            }
        }

        expect(issues).toEqual([]);
    });

    it('does not grant unresolved movements 1RM authority', () => {
        const violations = files.flatMap(file => collectSteps(file.json)
            .filter(step => (step.exerciseRef as Record<string, unknown> | undefined)?.kind === 'unresolved_free_text')
            .filter(step => (step.load as Record<string, unknown> | undefined)?.kind === 'percent_one_rm')
            .map(step => `${file.name} ${String(step.id)}`));
        expect(violations).toEqual([]);
    });

    it('retains the reviewed invalid-case boundary for the future authoring validator', () => {
        const cases = invalidCases();
        const names = cases.map(testCase => String(testCase.name));
        expect(cases.length).toBeGreaterThanOrEqual(10);
        expect(new Set(names).size).toBe(names.length);
        expect(names).toEqual(expect.arrayContaining([
            'missing-intent',
            'range-inverted',
            'duplicate-step-id',
            'relative-load-dangling',
            'option-action-targets-missing-step',
            'unbounded-action-kind',
            'condition-loosens-injury-constraint',
            'author-supplied-systemic-cost',
            'unresolved-movement-claims-one-rm',
            'prose-in-place-of-structure',
            'utc-scheduled-date',
        ]));
        for (const testCase of cases) {
            expect(testCase.expectedIssuePath, `${String(testCase.name)} needs an exact issue path`).toBeTypeOf('string');
            expect(testCase.definition, `${String(testCase.name)} needs an invalid definition`).toBeTypeOf('object');
        }
    });
});
