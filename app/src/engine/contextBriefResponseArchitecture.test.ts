import { readFileSync, readdirSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type {
    ActivityPowerDurationPeak,
    ActivityPrescribedTarget,
    ActivityResponseTelemetry,
    ActivitySegmentIdentitySource,
    ActivitySegmentSummary,
    ActivitySteadyHalfSummary,
} from './models';

const ENGINE_DIR = import.meta.dirname;
const SRC_DIR = resolve(ENGINE_DIR, '..');

function sourceFiles(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return sourceFiles(path);
        return /\.tsx?$/.test(entry.name) && !/\.(?:test|spec)\.tsx?$/.test(entry.name) ? [resolve(path)] : [];
    });
}

const SOURCE_FILES = sourceFiles(SRC_DIR);
const SOURCE_FILE_SET = new Set(SOURCE_FILES);
const GUARDED_MODULES = new Set([
    'contextBriefComparability.ts',
    'contextBriefResponseFeatures.ts',
    'contextBriefResponseSummary.ts',
    'contextBriefSessionResponse.ts',
    'contextBriefActivityTelemetry.ts',
    'contextBriefPlanningHandoff.ts',
].map(file => resolve(ENGINE_DIR, file)));
const ALLOWED_DIRECT_IMPORTERS = new Set([
    'engine/contextBriefActivityTelemetry.ts',
    'engine/contextBriefPlanningHandoff.ts',
    'engine/contextBriefResponseFeatures.ts',
    'engine/contextBriefResponseSummary.ts',
    'engine/contextBriefSessionResponse.ts',
    'services/contextBriefService.ts',
]);

function sourceRelative(path: string): string {
    return relative(SRC_DIR, path).replaceAll('\\', '/');
}

function importedSpecifiers(source: string): string[] {
    const staticImports = [...source.matchAll(/\b(?:from\s*|import\s*)['"]([^'"]+)['"]/g)]
        .map(match => match[1]);
    const dynamicImports = [...source.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]/g)]
        .map(match => match[1]);
    return [...new Set([...staticImports, ...dynamicImports])];
}

function resolveSourceImport(importer: string, specifier: string): string | undefined {
    if (!specifier.startsWith('.')) return undefined;

    const rawTarget = resolve(dirname(importer), specifier);
    const extension = extname(rawTarget);
    const typescriptBase = ['.js', '.jsx', '.mjs', '.cjs'].includes(extension)
        ? rawTarget.slice(0, -extension.length)
        : rawTarget;
    const candidates = [
        rawTarget,
        `${typescriptBase}.ts`,
        `${typescriptBase}.tsx`,
        join(typescriptBase, 'index.ts'),
        join(typescriptBase, 'index.tsx'),
    ];

    return candidates.find(candidate => SOURCE_FILE_SET.has(candidate));
}

function productionImportGraph(): Map<string, Set<string>> {
    const graph = new Map<string, Set<string>>();

    for (const file of SOURCE_FILES) {
        const dependencies = new Set<string>();
        const source = readFileSync(file, 'utf8');
        for (const specifier of importedSpecifiers(source)) {
            const target = resolveSourceImport(file, specifier);
            if (target) dependencies.add(target);
        }
        graph.set(file, dependencies);
    }

    return graph;
}

function reachesGuardedModule(
    start: string,
    graph: ReadonlyMap<string, ReadonlySet<string>>,
    visiting = new Set<string>(),
): boolean {
    if (GUARDED_MODULES.has(start)) return true;
    if (visiting.has(start)) return false;

    visiting.add(start);
    for (const dependency of graph.get(start) ?? []) {
        if (reachesGuardedModule(dependency, graph, visiting)) return true;
    }
    return false;
}

type HasOnlyKeys<T, Keys extends keyof T> = Exclude<keyof T, Keys> extends never ? true : never;
const RESPONSE_HAS_ONLY_NORMALIZED_FIELDS: HasOnlyKeys<ActivityResponseTelemetry,
    'derivationVersion' | 'sourceResolution' | 'segmentCountTotal' | 'segmentsTruncated' | 'segments' | 'powerDurationPeaks' | 'steadyHalves'> = true;
const SOURCE_RESOLUTION_HAS_ONLY_NORMALIZED_FIELDS: HasOnlyKeys<ActivityResponseTelemetry['sourceResolution'],
    'powerSeconds' | 'hrSeconds' | 'cadenceSeconds'> = true;
const TARGET_HAS_ONLY_NORMALIZED_FIELDS: HasOnlyKeys<ActivityPrescribedTarget,
    'kind' | 'value' | 'low' | 'high' | 'text'> = true;
const SEGMENT_HAS_ONLY_NORMALIZED_FIELDS: HasOnlyKeys<ActivitySegmentSummary,
    'segmentIndex' | 'segmentType' | 'identitySource' | 'startOffsetSeconds' | 'durationSeconds' | 'prescribedTarget'
    | 'averagePowerWatts' | 'peak1sPowerWatts' | 'peak5sPowerWatts' | 'peak10sPowerWatts' | 'averageHrBpm' | 'endHrBpm'
    | 'maxHrBpm' | 'averageCadenceRpm' | 'maxCadenceRpm' | 'firstThirdPowerWatts' | 'middleThirdPowerWatts'
    | 'lastThirdPowerWatts' | 'lastThirdHrBpm' | 'evidenceConfidence'> = true;
const PEAK_HAS_ONLY_NORMALIZED_FIELDS: HasOnlyKeys<ActivityPowerDurationPeak,
    'durationSeconds' | 'powerWatts' | 'confidence' | 'elapsedBeforeSeconds' | 'activityHalf'> = true;
const HALVES_HAVE_ONLY_NORMALIZED_FIELDS: HasOnlyKeys<ActivitySteadyHalfSummary,
    'firstPowerWatts' | 'secondPowerWatts' | 'firstHrBpm' | 'secondHrBpm' | 'firstCadenceRpm' | 'secondCadenceRpm'> = true;
type ReconciledStepIdentityIsNotSelectable =
    Extract<ActivitySegmentIdentitySource, 'reconciled_workout_step'> extends never ? true : never;
const RECONCILED_STEP_IDENTITY_IS_NOT_SELECTABLE: ReconciledStepIdentityIsNotSelectable = true;

describe('training-response architecture (#814)', () => {
    it('keeps response comparability inside the display-only context-brief boundary', () => {
        const responseImporters = new Set<string>();

        for (const file of SOURCE_FILES) {
            const source = readFileSync(file, 'utf8');
            for (const specifier of importedSpecifiers(source)) {
                const target = resolveSourceImport(file, specifier);
                if (target && GUARDED_MODULES.has(target)) responseImporters.add(sourceRelative(file));
            }
        }

        expect([...responseImporters].sort()).toEqual([...ALLOWED_DIRECT_IMPORTERS].sort());
    });

    it('keeps non-context-brief engine modules transitively isolated from response comparability', () => {
        const graph = productionImportGraph();
        const authorityViolations = SOURCE_FILES
            .filter(file => {
                const relativePath = sourceRelative(file);
                return relativePath.startsWith('engine/')
                    && !relativePath.startsWith('engine/contextBrief')
                    && reachesGuardedModule(file, graph);
            })
            .map(sourceRelative)
            .sort();

        expect(authorityViolations).toEqual([]);
    });

    it('keeps persisted response telemetry limited to normalized summary fields', () => {
        expect(RESPONSE_HAS_ONLY_NORMALIZED_FIELDS).toBe(true);
        expect(SOURCE_RESOLUTION_HAS_ONLY_NORMALIZED_FIELDS).toBe(true);
        expect(TARGET_HAS_ONLY_NORMALIZED_FIELDS).toBe(true);
        expect(SEGMENT_HAS_ONLY_NORMALIZED_FIELDS).toBe(true);
        expect(PEAK_HAS_ONLY_NORMALIZED_FIELDS).toBe(true);
        expect(HALVES_HAVE_ONLY_NORMALIZED_FIELDS).toBe(true);
    });

    it('keeps reconciled step identity unavailable until a shared alignment contract exists', () => {
        expect(RECONCILED_STEP_IDENTITY_IS_NOT_SELECTABLE).toBe(true);
    });
});
