import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../../scripts/check-persona-judge-drift.mjs', import.meta.url));
const roots: string[] = [];

afterEach(() => {
    while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

function baselineJson(judgeSettings?: Record<string, unknown>) {
    return {
        provenance: {
            judgeModel: 'judge-model',
            judgeProvider: 'local',
            ...(judgeSettings ? { judgeSettings } : {}),
        },
        familyCount: 1,
        caseCount: 1,
        meanSensitivityQuality: 5,
        scoreAverages: { overall: 5 },
        familySensitivity: [{ familyId: 'family-a', sensitivityQuality: 5 }],
    };
}

function scoreRow() {
    return {
        familyId: 'family-a',
        familyAssessment: { sensitivity_quality: 5 },
        caseScores: [{ scores: { overall: 5 } }],
    };
}

function setup(baselineSettings: Record<string, unknown> | undefined, manifest: Record<string, unknown> | null) {
    const root = mkdtempSync(join(tmpdir(), 'persona-judge-drift-'));
    roots.push(root);
    const appDir = join(root, 'app');
    const outputDir = join(appDir, 'artifacts/persona-plan-judge/latest');
    const baselinePath = join(root, 'docs/analysis/persona-judge-baseline.json');
    mkdirSync(outputDir, { recursive: true });
    mkdirSync(dirname(baselinePath), { recursive: true });

    writeFileSync(join(outputDir, 'corpus.json'), JSON.stringify({ commit: 'same-commit' }));
    writeFileSync(join(outputDir, 'judge-scores.jsonl'), `${JSON.stringify(scoreRow())}\n`);
    if (manifest) writeFileSync(join(outputDir, 'judge-run-manifest.json'), JSON.stringify(manifest));
    writeFileSync(baselinePath, JSON.stringify(baselineJson(baselineSettings)));

    return { appDir };
}

function run(appDir: string, extraArgs: string[] = []) {
    return spawnSync(process.execPath, [SCRIPT, ...extraArgs], { cwd: appDir, encoding: 'utf8' });
}

describe('persona:diff settings comparability guard', () => {
    it('fails closed when sample count differs from the baseline', () => {
        const { appDir } = setup(
            { samples: 5, thinkingEnabled: true },
            { judgeModel: 'judge-model', judgeProvider: 'local', samples: 1, thinkingEnabled: true },
        );
        const result = run(appDir);
        expect(result.status).toBe(1);
        expect(result.stderr).toContain('NOT COMPARABLE');
        expect(result.stderr).toContain('Sample count changed: 5 -> 1');
        expect(result.stderr).toContain('persona:e2e');
    });

    it('fails closed when thinking mode differs from the baseline', () => {
        const { appDir } = setup(
            { samples: 5, thinkingEnabled: true },
            { judgeModel: 'judge-model', judgeProvider: 'local', samples: 5, thinkingEnabled: false },
        );
        const result = run(appDir);
        expect(result.status).toBe(1);
        expect(result.stderr).toContain('Thinking mode changed: true -> false');
    });

    it('does not flag a settings match', () => {
        const { appDir } = setup(
            { samples: 5, thinkingEnabled: true },
            { judgeModel: 'judge-model', judgeProvider: 'local', samples: 5, thinkingEnabled: true },
        );
        const result = run(appDir);
        expect(result.status).toBe(0);
        expect(result.stdout).toContain('Persona diff check complete');
        expect(result.stdout).not.toContain('Judge run settings differ');
    });

    it('downgrades to a warning under --allow-settings-change', () => {
        const { appDir } = setup(
            { samples: 5, thinkingEnabled: true },
            { judgeModel: 'judge-model', judgeProvider: 'local', samples: 1, thinkingEnabled: false },
        );
        const result = run(appDir, ['--allow-settings-change']);
        expect(result.status).toBe(0);
        expect(result.stdout).toContain('Comparability Warnings');
        expect(result.stdout).toContain('Continuing because --allow-settings-change was supplied');
    });

    it('treats missing settings on either side as a non-fatal warning, not a proven mismatch', () => {
        const { appDir } = setup(undefined, { judgeModel: 'judge-model', judgeProvider: 'local' });
        const result = run(appDir);
        expect(result.status).toBe(0);
        expect(result.stdout).toContain('not recorded on one side');
    });
});
