import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ANTHROPOMETRY_DIR = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = dirname(ANTHROPOMETRY_DIR);
const ENGINE_DIR = join(SRC_DIR, 'engine');

function listProductionEngineFiles(): string[] {
    return readdirSync(ENGINE_DIR, { withFileTypes: true })
        .filter(entry => entry.isFile() && /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name))
        .map(entry => join(ENGINE_DIR, entry.name));
}

describe('engine isolation from anthropometry (ADR-0039 D-BC-AUTH)', () => {
    it('proves that engine source files have zero imports of anthropometry', () => {
        const engineFiles = listProductionEngineFiles();
        expect(engineFiles.length).toBeGreaterThan(10);

        const violations: string[] = [];

        for (const filePath of engineFiles) {
            const content = readFileSync(filePath, 'utf8');
            const relativePath = relative(SRC_DIR, filePath).replaceAll('\\', '/');

            // Search for any import referencing anthropometry
            if (/from\s+['"].*anthropometry.*['"]/i.test(content) || /import\s*\(['"].*anthropometry.*['"]\)/i.test(content)) {
                violations.push(relativePath);
            }
        }

        expect(violations).toEqual([]);
    });
});
