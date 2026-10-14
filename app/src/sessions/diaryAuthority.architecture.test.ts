import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * #895 WP7 — structure guards for the canonical execution diary.
 *
 *  1. `services/sessionExecutionService.ts` is the only production module that builds a
 *     Firestore reference into the diary collections (decision D1). The one other module
 *     that names a diary collection may only READ it.
 *  2. The diary-write internals (`sessionDiaryWrite`, `sessionDiaryReceipts`) are reachable
 *     only through the execution service; response, observation, outcome and engine
 *     modules cannot reach them, even transitively.
 *
 * Raw-trace containment for planning payloads is already pinned by the normalized-field
 * guards in `engine/contextBriefResponseArchitecture.test.ts`; structured-over-provider
 * identity is pinned behaviorally in `training-occurrence/structuredIdentityAuthority.test.ts`.
 */

const SRC_DIR = dirname(dirname(fileURLToPath(import.meta.url)));

const DIARY_COLLECTIONS = new Set(['session_executions', 'session_execution_locks', 'diaryMutations']);
const REFERENCE_BUILDERS = new Set(['doc', 'collection', 'collectionGroup']);

/** The single write authority (D1). */
const WRITE_AUTHORITY = 'services/sessionExecutionService.ts';

/** Modules that name a diary collection but must only read it, with the collection they touch. */
const READ_ONLY_REFERENCERS: Readonly<Record<string, string>> = {
    // Reads the deterministic execution lock inside its own transaction to refuse a manual
    // replacement once an execution exists; it never writes the lock.
    'services/manualRecommendationReplacementService.ts': 'session_execution_locks',
};

const DIARY_WRITE_INTERNALS = ['services/sessionDiaryWrite.ts', 'services/sessionDiaryReceipts.ts'];

/** Production modules allowed to import a diary-write internal at runtime. */
const INTERNALS_IMPORTERS = new Set([WRITE_AUTHORITY]);

/** Engine IO adapters that statically reach the execution service through read-only history
 * services (`strengthHistoryReadService`). They are the sanctioned Firestore provider, not
 * evaluators; remove an entry here when the adapter stops depending on the service. */
const STATIC_REACH_ADAPTERS = new Set(['engine/firestoreTrainingHistory.ts']);

/** The only engine modules CLAUDE.md lets lazily import a service as a default provider. */
const LAZY_IO_ENTRY_POINTS = new Set(['engine/rules.ts', 'engine/trainingIntent.ts', 'engine/replay.ts']);

const NON_DIARY_DOMAINS = ['engine/', 'responses/', 'observations/', 'outcomes/', 'knowledge/'];

function productionFiles(directory = SRC_DIR): string[] {
    return readdirSync(directory, { withFileTypes: true })
        .flatMap(entry => {
            const absolutePath = join(directory, entry.name);
            if (entry.isDirectory()) return productionFiles(absolutePath);
            if (!entry.isFile() || !/\.tsx?$/.test(entry.name) || /\.(test|spec)\.tsx?$/.test(entry.name)) return [];
            return [absolutePath];
        })
        .sort();
}

const rel = (absolutePath: string): string => relative(SRC_DIR, absolutePath).replaceAll('\\', '/');

function parse(absolutePath: string): ts.SourceFile {
    return ts.createSourceFile(
        rel(absolutePath),
        readFileSync(absolutePath, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
        absolutePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
}

function resolveSpecifier(fromAbsolute: string, specifier: string): string | null {
    if (!specifier.startsWith('.')) return null;
    const base = resolve(dirname(fromAbsolute), specifier);
    for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]) {
        if (existsSync(candidate)) return rel(candidate);
    }
    return null;
}

/** Runtime edges only: `import type` and all-type-only specifier lists are erased. With
 * `includeDynamic`, lazy `import()` edges count too. The engine's sanctioned IO entry
 * points (`trainingIntent.ts`, `rules.ts`, `replay.ts`) lazily import services as a default
 * provider, so transitive reachability is asserted on static edges only while DIRECT
 * imports are asserted including dynamic ones. */
function runtimeImportGraph(includeDynamic: boolean, dynamicSources?: (file: string) => boolean): Map<string, string[]> {
    const graph = new Map<string, string[]>();
    for (const absolutePath of productionFiles()) {
        const edges: string[] = [];
        const visit = (node: ts.Node): void => {
            let specifier: string | undefined;
            if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
                const clause = node.importClause;
                const runtime = !clause || (!clause.isTypeOnly && (
                    clause.name !== undefined
                    || (clause.namedBindings !== undefined && (
                        ts.isNamespaceImport(clause.namedBindings)
                        || clause.namedBindings.elements.some(element => !element.isTypeOnly)
                    ))
                ));
                if (runtime) specifier = node.moduleSpecifier.text;
            } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier) && !node.isTypeOnly) {
                specifier = node.moduleSpecifier.text;
            } else if (includeDynamic && (dynamicSources?.(rel(absolutePath)) ?? true) && ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword
                && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
                specifier = node.arguments[0].text;
            }
            const target = specifier ? resolveSpecifier(absolutePath, specifier) : null;
            if (target) edges.push(target);
            ts.forEachChild(node, visit);
        };
        visit(parse(absolutePath));
        graph.set(rel(absolutePath), edges);
    }
    return graph;
}

function calleeName(call: ts.CallExpression): string | undefined {
    if (ts.isIdentifier(call.expression)) return call.expression.text;
    if (ts.isPropertyAccessExpression(call.expression)) return call.expression.name.text;
    return undefined;
}

interface DiaryReference {
    file: string;
    collection: string;
    node: ts.CallExpression;
}

const DIARY_PATH_SEGMENT = /(^|\/)(session_executions|session_execution_locks|diaryMutations)(\/|$)/;
/** Diary subcollections, which can be reached directly through a collection group query. */
const DIARY_GROUP_NAMES = new Set(['entries', 'restEvents', 'diaryMutations']);

/** Text pieces of a path-like argument: plain strings, template heads/spans, and a same-file
 * `const NAME = '...'` that an identifier argument points at. */
function literalPieces(argument: ts.Expression): string[] {
    if (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument)) return [argument.text];
    if (ts.isTemplateExpression(argument)) {
        return [argument.head.text, ...argument.templateSpans.map(span => span.literal.text)];
    }
    if (ts.isIdentifier(argument)) {
        const pieces: string[] = [];
        const visit = (node: ts.Node): void => {
            if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === argument.text
                && node.initializer && !ts.isIdentifier(node.initializer)) {
                pieces.push(...literalPieces(node.initializer));
            }
            ts.forEachChild(node, visit);
        };
        visit(argument.getSourceFile());
        return pieces;
    }
    return [];
}

function namedCollection(call: ts.CallExpression): string | undefined {
    const builder = calleeName(call) ?? '';
    for (const argument of call.arguments) {
        for (const piece of literalPieces(argument)) {
            if (DIARY_COLLECTIONS.has(piece)) return piece;
            const match = DIARY_PATH_SEGMENT.exec(piece);
            if (match) return match[2];
            if (builder === 'collectionGroup' && DIARY_GROUP_NAMES.has(piece)) return piece;
        }
    }
    return undefined;
}

/** Every `doc(...)` / `collection(...)` / `collectionGroup(...)` call naming a diary collection,
 * whether by literal, slash-joined or interpolated path, same-file constant, or group name. */
function diaryReferences(): DiaryReference[] {
    const references: DiaryReference[] = [];
    for (const absolutePath of productionFiles()) {
        const source = parse(absolutePath);
        const visit = (node: ts.Node): void => {
            if (ts.isCallExpression(node) && REFERENCE_BUILDERS.has(calleeName(node) ?? '')) {
                const collection = namedCollection(node);
                if (collection) references.push({ file: rel(absolutePath), collection, node });
            }
            ts.forEachChild(node, visit);
        };
        visit(source);
    }
    return references;
}

/** True when the reference is only ever passed to `.get(...)` (directly or via one variable). */
function isReadOnlyUse(reference: DiaryReference): boolean {
    const isGetArgument = (expression: ts.Node): boolean => {
        const parent = expression.parent;
        return ts.isCallExpression(parent)
            && ts.isPropertyAccessExpression(parent.expression)
            && parent.expression.name.text === 'get'
            && parent.arguments.includes(expression as ts.Expression);
    };
    const parent = reference.node.parent;
    if (isGetArgument(reference.node)) return true;
    if (!ts.isVariableDeclaration(parent) || !ts.isIdentifier(parent.name)) return false;

    const name = parent.name.text;
    let uses = 0;
    let allReads = true;
    const visit = (node: ts.Node): void => {
        if (ts.isIdentifier(node) && node.text === name && node !== parent.name) {
            uses += 1;
            if (!isGetArgument(node)) allReads = false;
        }
        ts.forEachChild(node, visit);
    };
    visit(reference.node.getSourceFile());
    return uses > 0 && allReads;
}

function reachable(start: string, graph: Map<string, string[]>): Set<string> {
    const seen = new Set<string>();
    const stack = [start];
    while (stack.length > 0) {
        const current = stack.pop()!;
        if (seen.has(current)) continue;
        seen.add(current);
        stack.push(...(graph.get(current) ?? []));
    }
    return seen;
}

describe('canonical execution diary authority (#895 WP7)', () => {
    it('only the execution service builds references into the diary collections, plus audited read-only lookups', () => {
        const outsideAuthority = diaryReferences().filter(reference => reference.file !== WRITE_AUTHORITY);

        const unexpected = outsideAuthority
            .filter(reference => READ_ONLY_REFERENCERS[reference.file] !== reference.collection)
            .map(reference => `${reference.file}: ${reference.collection}`);
        expect(unexpected).toEqual([]);

        const writers = outsideAuthority.filter(reference => !isReadOnlyUse(reference)).map(reference => `${reference.file}: ${reference.collection}`);
        expect(writers).toEqual([]);

        // The authority itself must still be the place that builds these references.
        expect(diaryReferences().some(reference => reference.file === WRITE_AUTHORITY && reference.collection === 'session_executions')).toBe(true);
    });

    it('the read-only allowlist has no stale entries', () => {
        const referencing = new Set(diaryReferences().map(reference => reference.file));
        for (const file of Object.keys(READ_ONLY_REFERENCERS)) expect(referencing.has(file)).toBe(true);
    });

    it('detects a write-shaped reference (self-test of the read-only classifier)', () => {
        const source = ts.createSourceFile(
            'probe.ts',
            "const ref = doc(db, 'users', u, 'session_execution_locks', id); transaction.get(ref); transaction.set(ref, {});",
            ts.ScriptTarget.Latest,
            true,
        );
        let probe: DiaryReference | undefined;
        const visit = (node: ts.Node): void => {
            if (ts.isCallExpression(node) && calleeName(node) === 'doc') probe = { file: 'probe.ts', collection: 'session_execution_locks', node };
            ts.forEachChild(node, visit);
        };
        visit(source);
        expect(probe).toBeDefined();
        expect(isReadOnlyUse(probe!)).toBe(false);
    });

    it.each([
        ['an interpolated template path', "doc(db, `users/${u}/session_executions/${id}`)"],
        ['a slash-joined string path', "doc(db, 'users/u1/session_executions/e1')"],
        ['a same-file constant', "const C = 'session_executions'; collection(db, 'users', u, C)"],
        ['a collection group over a diary subcollection', "collectionGroup(db, 'entries')"],
    ])('the reference scanner catches %s', (_label, code) => {
        const source = ts.createSourceFile('probe.ts', code, ts.ScriptTarget.Latest, true);
        let found: string | undefined;
        const visit = (node: ts.Node): void => {
            if (ts.isCallExpression(node) && REFERENCE_BUILDERS.has(calleeName(node) ?? '')) found ??= namedCollection(node);
            ts.forEachChild(node, visit);
        };
        visit(source);
        expect(found).toBeDefined();
    });

    it('diary-write internals are imported only by the execution service', () => {
        const graph = runtimeImportGraph(true);
        const importers = [...graph.entries()]
            .filter(([file, edges]) => !DIARY_WRITE_INTERNALS.includes(file) && edges.some(edge => DIARY_WRITE_INTERNALS.includes(edge)))
            .map(([file]) => file)
            .sort();
        expect(importers.filter(file => !INTERNALS_IMPORTERS.has(file))).toEqual([]);
        expect(importers).toContain(WRITE_AUTHORITY);
    });

    it('engine, response, observation, outcome and knowledge modules never import the diary-write path directly', () => {
        const graph = runtimeImportGraph(true);
        const protectedTargets = new Set([...DIARY_WRITE_INTERNALS, WRITE_AUTHORITY]);
        const violations = [...graph.entries()]
            .filter(([file]) => NON_DIARY_DOMAINS.some(prefix => file.startsWith(prefix)))
            .filter(([, edges]) => edges.some(edge => protectedTargets.has(edge)))
            .map(([file]) => file)
            .sort();
        expect(violations).toEqual([]);
    });

    it('those domains cannot reach the diary-write path, except through the sanctioned lazy entry points and read adapter', () => {
        // Lazy `import()` counts everywhere EXCEPT from the three orchestration entry points.
        const graph = runtimeImportGraph(true, file => !LAZY_IO_ENTRY_POINTS.has(file));
        const protectedTargets = new Set([...DIARY_WRITE_INTERNALS, WRITE_AUTHORITY]);
        const violations = [...graph.keys()]
            .filter(file => NON_DIARY_DOMAINS.some(prefix => file.startsWith(prefix)))
            .filter(file => !STATIC_REACH_ADAPTERS.has(file))
            .filter(file => [...reachable(file, graph)].some(target => protectedTargets.has(target)))
            .sort();
        expect(violations).toEqual([]);
    });

    it('the allowlisted history adapter only calls read methods on the history services', () => {
        const source = parse(join(SRC_DIR, 'engine/firestoreTrainingHistory.ts'));
        const called = new Set<string>();
        const visit = (node: ts.Node): void => {
            if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
                && ts.isIdentifier(node.expression.expression)
                && ['strengthHistoryReadService', 'executionService', 'sessionExecutionService'].includes(node.expression.expression.text)) {
                called.add(`${node.expression.expression.text}.${node.expression.name.text}`);
            }
            ts.forEachChild(node, visit);
        };
        visit(source);
        expect([...called].filter(call => !/^(get|list|read)/i.test(call.split('.')[1] ?? ''))).toEqual([]);
        expect(called.size).toBeGreaterThan(0);
    });

    it('the static-reach adapter allowlist has no stale entries', () => {
        const graph = runtimeImportGraph(false);
        for (const adapter of STATIC_REACH_ADAPTERS) {
            expect([...reachable(adapter, graph)].some(target => target === WRITE_AUTHORITY)).toBe(true);
        }
    });
});
