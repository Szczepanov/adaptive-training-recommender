import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type {
    ActivityPowerDurationPeak,
    ActivityResponseTelemetry,
    ActivitySegmentSummary,
    ActivitySteadyHalfSummary,
} from './models';

const ENGINE_DIR = import.meta.dirname;
const SRC_DIR = resolve(ENGINE_DIR, '..');
const GUARDED_MODULES = new Set([
    'contextBriefComparability.ts',
    'contextBriefResponseFeatures.ts',
    'contextBriefResponseSummary.ts',
    'contextBriefSessionResponse.ts',
].map(file => resolve(ENGINE_DIR, file)));

function sourceFiles(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return sourceFiles(path);
        return /\.tsx?$/.test(entry.name) && !/\.(?:test|spec)\.tsx?$/.test(entry.name) ? [path] : [];
    });
}

type HasOnlyKeys<T, Keys extends keyof T> = Exclude<keyof T, Keys> extends never ? true : never;
const RESPONSE_HAS_ONLY_BOUNDED_FIELDS: HasOnlyKeys<ActivityResponseTelemetry,
    'derivationVersion' | 'sourceResolution' | 'segmentCountTotal' | 'segmentsTruncated' | 'segments' | 'powerDurationPeaks' | 'steadyHalves'> = true;
const SEGMENT_HAS_ONLY_NORMALIZED_FIELDS: HasOnlyKeys<ActivitySegmentSummary,
    'segmentIndex' | 'segmentType' | 'identitySource' | 'startOffsetSeconds' | 'durationSeconds' | 'prescribedTarget'
    | 'averagePowerWatts' | 'peak1sPowerWatts' | 'peak5sPowerWatts' | 'peak10sPowerWatts' | 'averageHrBpm' | 'endHrBpm'
    | 'maxHrBpm' | 'averageCadenceRpm' | 'maxCadenceRpm' | 'firstThirdPowerWatts' | 'middleThirdPowerWatts'
    | 'lastThirdPowerWatts' | 'lastThirdHrBpm' | 'evidenceConfidence'> = true;
const PEAK_HAS_ONLY_NORMALIZED_FIELDS: HasOnlyKeys<ActivityPowerDurationPeak,
    'durationSeconds' | 'powerWatts' | 'confidence' | 'elapsedBeforeSeconds' | 'activityHalf'> = true;
const HALVES_HAVE_ONLY_NORMALIZED_FIELDS: HasOnlyKeys<ActivitySteadyHalfSummary,
    'firstPowerWatts' | 'secondPowerWatts' | 'firstHrBpm' | 'secondHrBpm' | 'firstCadenceRpm' | 'secondCadenceRpm'> = true;

describe('training-response architecture (#814)', () => {
    it('keeps response comparability outputs inside the display-only brief path', () => {
        const responseImporters = new Set<string>();

        for (const file of sourceFiles(SRC_DIR)) {
            const source = readFileSync(file, 'utf8');
            for (const match of source.matchAll(/\b(?:from\s*|import\s*)['"]([^'"]+)['"]/g)) {
                const specifier = match[1];
                if (!specifier.startsWith('.')) continue;
                const target = resolve(dirname(file), specifier.endsWith('.ts') ? specifier : `${specifier}.ts`);
                if (GUARDED_MODULES.has(target)) responseImporters.add(relative(SRC_DIR, file).replaceAll('\\', '/'));
            }
        }

        expect([...responseImporters].sort()).toEqual([
            'engine/contextBriefActivityTelemetry.ts',
            'engine/contextBriefResponseFeatures.ts',
            'engine/contextBriefResponseSummary.ts',
            'engine/contextBriefSessionResponse.ts',
        ]);
    });

    it('keeps persisted response telemetry limited to normalized bounded fields', () => {
        expect(RESPONSE_HAS_ONLY_BOUNDED_FIELDS).toBe(true);
        expect(SEGMENT_HAS_ONLY_NORMALIZED_FIELDS).toBe(true);
        expect(PEAK_HAS_ONLY_NORMALIZED_FIELDS).toBe(true);
        expect(HALVES_HAVE_ONLY_NORMALIZED_FIELDS).toBe(true);
    });
});
