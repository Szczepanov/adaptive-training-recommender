import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const NUTRITION_DIR = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = dirname(dirname(NUTRITION_DIR));
const ENGINE_DIR = join(SRC_DIR, 'engine');

function listProductionEngineFiles(dir: string = ENGINE_DIR): string[] {
    const entries = readdirSync(dir, { withFileTypes: true });
    const files: string[] = [];

    for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
            files.push(...listProductionEngineFiles(fullPath));
        } else if (entry.isFile() && /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
            files.push(fullPath);
        }
    }

    return files;
}

describe('engine isolation from nutrition (ADR-0042)', () => {
    it('keeps nutritionAdherenceYesterday out of engine decision logic', () => {
        const allowedBoundaryFiles = new Set([
            'engine/models.ts',
            'engine/validationCore.ts',
        ]);
        const violations: string[] = [];

        for (const filePath of listProductionEngineFiles()) {
            const content = readFileSync(filePath, 'utf8');
            const relativePath = relative(SRC_DIR, filePath).replaceAll('\\', '/');
            if (content.includes('nutritionAdherenceYesterday') && !allowedBoundaryFiles.has(relativePath)) {
                violations.push(relativePath);
            }
        }

        expect(violations).toEqual([]);
    });

    it('proves that engine source files have zero imports of nutrition', () => {
        const engineFiles = listProductionEngineFiles();
        expect(engineFiles.length).toBeGreaterThan(10);

        const violations: string[] = [];

        for (const filePath of engineFiles) {
            const content = readFileSync(filePath, 'utf8');
            const relativePath = relative(SRC_DIR, filePath).replaceAll('\\', '/');

            // Search for any import referencing nutrition
            if (/from\s+['"].*nutrition.*['"]/i.test(content) || /import\s*\(['"].*nutrition.*['"]\)/i.test(content)) {
                violations.push(relativePath);
            }
        }

        expect(violations).toEqual([]);
    });
});
