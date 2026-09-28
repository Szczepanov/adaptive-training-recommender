import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { assertEvidenceLabelsMatchProvenance, historicalSourceTreeSha256 } from './training-occurrence-source-tree.mjs';

const roots = [];

afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('historicalSourceTreeSha256', () => {
    it('binds tracked and untracked source while excluding ignored private artifacts', () => {
        const root = mkdtempSync(path.join(os.tmpdir(), 'to4-source-tree-'));
        roots.push(root);
        const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'ignore' });
        writeFileSync(path.join(root, '.gitignore'), 'artifacts/\n', 'utf8');
        writeFileSync(path.join(root, 'source.ts'), 'export const value = 1;\n', 'utf8');
        git('init');
        git('config', 'user.name', 'Test');
        git('config', 'user.email', 'test@example.invalid');
        git('add', '.gitignore', 'source.ts');
        git('commit', '-m', 'fixture');

        const baseline = historicalSourceTreeSha256(root);
        writeFileSync(path.join(root, 'source.ts'), 'export const value = 2;\n', 'utf8');
        expect(historicalSourceTreeSha256(root)).not.toBe(baseline);
        writeFileSync(path.join(root, 'source.ts'), 'export const value = 1;\n', 'utf8');
        writeFileSync(path.join(root, 'extra.ts'), 'export const extra = true;\n', 'utf8');
        expect(historicalSourceTreeSha256(root)).not.toBe(baseline);
        rmSync(path.join(root, 'extra.ts'));
        mkdirSync(path.join(root, 'artifacts'));
        writeFileSync(path.join(root, 'artifacts', 'private.json'), '{"private":true}', 'utf8');
        expect(historicalSourceTreeSha256(root)).toBe(baseline);
    });

    it('rejects labels from a different source tree', () => {
        const provenance = { recordsSha256: 'a'.repeat(64), sourceCommit: 'commit', sourceTreeSha256: 'b'.repeat(64) };
        expect(() => assertEvidenceLabelsMatchProvenance(provenance, provenance, 'Occurrence')).not.toThrow();
        expect(() => assertEvidenceLabelsMatchProvenance({ ...provenance, sourceTreeSha256: 'c'.repeat(64) }, provenance, 'Occurrence'))
            .toThrow(/source commit and source tree/);
    });
});
