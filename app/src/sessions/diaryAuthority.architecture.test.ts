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
// Repository-wide source scans need headroom under coverage and concurrent verification.
const SOURCE_SCAN_TIMEOUT = 60_000;

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
const parsedSources = new Map<string, ts.SourceFile>();

function parse(absolutePath: string): ts.SourceFile {
    const cached = parsedSources.get(absolutePath);
    if (cached) return cached;
    const source = ts.createSourceFile(
        rel(absolutePath),
        readFileSync(absolutePath, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
        absolutePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    parsedSources.set(absolutePath, source);
    return source;
}

function resolveSpecifier(fromAbsolute: string, specifier: string): string | null {
    if (!specifier.startsWith('.')) return null;
    const base = resolve(dirname(fromAbsolute), specifier);
    if (/\.tsx?$/.test(base) && existsSync(base)) return rel(base);
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
    if (ts.isIdentifier(call.expression)) {
        const localName = call.expression.text;
        for (const statement of call.getSourceFile().statements) {
            if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)
                || !/^firebase\/firestore(?:\/lite)?$/.test(statement.moduleSpecifier.text)) continue;
            const bindings = statement.importClause?.namedBindings;
            if (!bindings || !ts.isNamedImports(bindings)) continue;
            const imported = bindings.elements.find(element => element.name.text === localName);
            if (imported) return imported.propertyName?.text ?? imported.name.text;
        }
        return localName;
    }
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
const pathInitializers = new WeakMap<ts.SourceFile, Map<string, ts.Expression[]>>();

/** Text pieces of a path-like argument: plain strings, template heads/spans, and a same-file
 * `const NAME = '...'` that an identifier argument points at. */
function literalPieces(argument: ts.Expression): string[] {
    if (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument)) return [argument.text];
    if (ts.isTemplateExpression(argument)) {
        return [argument.head.text, ...argument.templateSpans.map(span => span.literal.text)];
    }
    if (ts.isIdentifier(argument)) {
        const source = argument.getSourceFile();
        let initializers = pathInitializers.get(source);
        if (!initializers) {
            initializers = new Map<string, ts.Expression[]>();
            const visit = (node: ts.Node): void => {
                if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)
                    && node.initializer && !ts.isIdentifier(node.initializer)) {
                    const values = initializers!.get(node.name.text) ?? [];
                    values.push(node.initializer);
                    initializers!.set(node.name.text, values);
                }
                ts.forEachChild(node, visit);
            };
            visit(source);
            pathInitializers.set(source, initializers);
        }
        return (initializers.get(argument.text) ?? []).flatMap(literalPieces);
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

function reachingTargets(targets: Set<string>, graph: Map<string, string[]>): Set<string> {
    const reverse = new Map<string, string[]>();
    for (const [source, edges] of graph) {
        for (const target of edges) {
            const callers = reverse.get(target) ?? [];
            callers.push(source);
            reverse.set(target, callers);
        }
    }
    return new Set([...targets].flatMap(target => [...reachable(target, reverse)]));
}

/** Check method references too, so extracting a write method cannot hide it from the guard. */
function historyServiceMethods(source: ts.SourceFile): string[] {
    const receivers = new Set(['strengthHistoryReadService', 'sessionExecutionService', 'executionService']);
    for (const statement of source.statements) {
        if (!ts.isImportDeclaration(statement)) continue;
        const bindings = statement.importClause?.namedBindings;
        if (!bindings || !ts.isNamedImports(bindings)) continue;
        for (const binding of bindings.elements) {
            if (receivers.has(binding.propertyName?.text ?? binding.name.text)) receivers.add(binding.name.text);
        }
    }
    const methods: string[] = [];
    const visit = (node: ts.Node): void => {
        if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
            const receiver = node.expression;
            const receiverName = ts.isIdentifier(receiver) ? receiver.text
                : ts.isPropertyAccessExpression(receiver) && receiver.expression.kind === ts.SyntaxKind.ThisKeyword
                    ? receiver.name.text : undefined;
            if (receiverName && receivers.has(receiverName)) {
                methods.push(ts.isPropertyAccessExpression(node) ? node.name.text
                    : ts.isStringLiteral(node.argumentExpression) ? node.argumentExpression.text : '<computed>');
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(source);
    return methods;
}

describe('canonical execution diary authority (#895 WP7)', () => {
    it('only the execution service builds references into the diary collections, plus audited read-only lookups', () => {
        const references = diaryReferences();
        const outsideAuthority = references.filter(reference => reference.file !== WRITE_AUTHORITY);

        const unexpected = outsideAuthority
            .filter(reference => READ_ONLY_REFERENCERS[reference.file] !== reference.collection)
            .map(reference => `${reference.file}: ${reference.collection}`);
        expect(unexpected).toEqual([]);

        const writers = outsideAuthority.filter(reference => !isReadOnlyUse(reference)).map(reference => `${reference.file}: ${reference.collection}`);
        expect(writers).toEqual([]);

        // The authority itself must still be the place that builds these references.
        expect(references.some(reference => reference.file === WRITE_AUTHORITY && reference.collection === 'session_executions')).toBe(true);
    }, SOURCE_SCAN_TIMEOUT);

    it('the read-only allowlist has no stale entries', () => {
        const referencing = new Set(diaryReferences().map(reference => reference.file));
        for (const file of Object.keys(READ_ONLY_REFERENCERS)) expect(referencing.has(file)).toBe(true);
    }, SOURCE_SCAN_TIMEOUT);

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
        ['a renamed Firestore import', "import { doc as diaryDoc } from 'firebase/firestore'; diaryDoc(db, 'users', u, 'session_executions', id)"],
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

    it('resolves explicit TypeScript extensions in runtime imports', () => {
        expect(resolveSpecifier(join(SRC_DIR, 'engine/probe.ts'), '../services/sessionExecutionService.ts')).toBe(WRITE_AUTHORITY);
    });

    it('diary-write internals are imported only by the execution service', () => {
        const graph = runtimeImportGraph(true);
        const importers = [...graph.entries()]
            .filter(([file, edges]) => !DIARY_WRITE_INTERNALS.includes(file) && edges.some(edge => DIARY_WRITE_INTERNALS.includes(edge)))
            .map(([file]) => file)
            .sort();
        expect(importers.filter(file => !INTERNALS_IMPORTERS.has(file))).toEqual([]);
        expect(importers).toContain(WRITE_AUTHORITY);
    }, SOURCE_SCAN_TIMEOUT);

    it('engine, response, observation, outcome and knowledge modules never import the diary-write path directly', () => {
        const graph = runtimeImportGraph(true);
        const protectedTargets = new Set([...DIARY_WRITE_INTERNALS, WRITE_AUTHORITY]);
        const violations = [...graph.entries()]
            .filter(([file]) => NON_DIARY_DOMAINS.some(prefix => file.startsWith(prefix)))
            .filter(([, edges]) => edges.some(edge => protectedTargets.has(edge)))
            .map(([file]) => file)
            .sort();
        expect(violations).toEqual([]);
    }, SOURCE_SCAN_TIMEOUT);

    it('those domains cannot reach the diary-write path, except through the sanctioned lazy entry points and read adapter', () => {
        // Lazy `import()` counts everywhere EXCEPT from the three orchestration entry points.
        const graph = runtimeImportGraph(true, file => !LAZY_IO_ENTRY_POINTS.has(file));
        const protectedTargets = new Set([...DIARY_WRITE_INTERNALS, WRITE_AUTHORITY]);
        const reachesWritePath = reachingTargets(protectedTargets, graph);
        const violations = [...graph.keys()]
            .filter(file => NON_DIARY_DOMAINS.some(prefix => file.startsWith(prefix)))
            .filter(file => !STATIC_REACH_ADAPTERS.has(file))
            .filter(file => reachesWritePath.has(file))
            .sort();
        expect(violations).toEqual([]);
    }, SOURCE_SCAN_TIMEOUT);

    it('reverse reachability includes indirect callers and cycles but excludes unrelated branches', () => {
        const graph = new Map([
            ['engine', ['adapter']], ['adapter', ['service']], ['service', ['internal']],
            ['internal', ['service']], ['unrelated', ['readOnly']],
        ]);
        expect([...reachingTargets(new Set(['service']), graph)].sort()).toEqual(['adapter', 'engine', 'internal', 'service']);
    });

    it.each(['engine/firestoreTrainingHistory.ts', 'services/strengthHistoryReadService.ts'])('the history read path only references audited read methods in %s', file => {
        const methods = historyServiceMethods(parse(join(SRC_DIR, file)));
        expect(methods.filter(method => !['getSessionsInRange', 'getExecutionsInRange'].includes(method))).toEqual([]);
        expect(methods.length).toBeGreaterThan(0);
    });

    it.each([
        ['an injected service field', 'this.executionService.completeExecution(u, id)'],
        ['a renamed service import', "import { sessionExecutionService as diary } from '../services/sessionExecutionService'; diary.completeExecution(u, id)"],
        ['an extracted write method', 'const write = executionService.completeExecution'],
        ['an indexed write method', "this.executionService['completeExecution'](u, id)"],
    ])('detects write access through %s', (_label, code) => {
        expect(historyServiceMethods(ts.createSourceFile('probe.ts', code, ts.ScriptTarget.Latest, true))).toContain('completeExecution');
    });

    it('the static-reach adapter allowlist has no stale entries', () => {
        const graph = runtimeImportGraph(false);
        for (const adapter of STATIC_REACH_ADAPTERS) {
            expect([...reachable(adapter, graph)].some(target => target === WRITE_AUTHORITY)).toBe(true);
        }
    }, SOURCE_SCAN_TIMEOUT);
});
