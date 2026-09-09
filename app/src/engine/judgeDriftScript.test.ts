import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../../scripts/check-plan-judge-drift.mjs', import.meta.url));
const roots: string[] = [];

afterEach(() => {
    while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

function summary(commit: string, promptSha256 = 'prompt-a') {
    return {
        schema: 'adaptive-training-recommender/ai-plan-judge-summary@3',
        provenance: {
            corpusCommit: commit,
            judgeModel: 'judge-model',
            judgeProvider: 'local',
            promptSha256,
            responseSchemaSha256: 'schema-a',
            caseSetSha256: 'case-set-a',
        },
        familyCount: 1,
        caseCount: 1,
        meanSensitivityQuality: 5,
        scoreAverages: { overall: 5 },
        familySensitivity: [{ familyId: 'family-a', sensitivityQuality: 5 }],
    };
}

function setup() {
    const root = mkdtempSync(join(tmpdir(), 'judge-drift-'));
    roots.push(root);
    const appDir = join(root, 'app');
    const currentPath = join(appDir, 'artifacts/ai-plan-judge/latest/judge-summary.json');
    const baselinePath = join(root, 'docs/analysis/plan-judge-baseline.json');
    mkdirSync(dirname(currentPath), { recursive: true });
    mkdirSync(dirname(baselinePath), { recursive: true });
    writeFileSync(currentPath, JSON.stringify(summary('current')));
    writeFileSync(baselinePath, JSON.stringify(summary('baseline')));
    return { appDir };
}

function run(appDir: string) {
    return spawnSync(process.execPath, [SCRIPT, '--previous'], { cwd: appDir, encoding: 'utf8' });
}

function setupWithSettings(baselineSettings: Record<string, unknown>, currentSettings: Record<string, unknown>) {
    const root = mkdtempSync(join(tmpdir(), 'judge-drift-settings-'));
    roots.push(root);
    const appDir = join(root, 'app');
    const currentPath = join(appDir, 'artifacts/ai-plan-judge/latest/judge-summary.json');
    const baselinePath = join(root, 'docs/analysis/plan-judge-baseline.json');
    mkdirSync(dirname(currentPath), { recursive: true });
    mkdirSync(dirname(baselinePath), { recursive: true });

    const current = summary('same-commit');
    (current.provenance as Record<string, unknown>).judgeSettings = currentSettings;
    const baseline = summary('same-commit');
    (baseline.provenance as Record<string, unknown>).judgeSettings = baselineSettings;

    writeFileSync(currentPath, JSON.stringify(current));
    writeFileSync(baselinePath, JSON.stringify(baseline));
    return { appDir };
}

function runDirect(appDir: string, extraArgs: string[] = []) {
    return spawnSync(process.execPath, [SCRIPT, ...extraArgs], { cwd: appDir, encoding: 'utf8' });
}

describe('judge:diff:prev provenance hardening', () => {
    it('fails closed when no previous artifact exists', () => {
        const { appDir } = setup();
        const result = run(appDir);
        expect(result.status).toBe(1);
        expect(result.stderr).toContain('cannot compare with --previous');
    });

    it('does not borrow the current prompt hash for a historical diff artifact', () => {
        const { appDir } = setup();
        const historyDir = join(appDir, 'artifacts/ai-plan-judge/history');
        mkdirSync(historyDir, { recursive: true });
        writeFileSync(join(historyDir, 'diff-2026-08-23T10-00-00-000Z.json'), JSON.stringify({
            comparedAt: '2026-08-23T10:00:00.000Z',
            current: {
                corpusCommit: 'previous',
                judgeModel: 'judge-model',
                judgeProvider: 'local',
                promptSha256: 'prompt-b',
                responseSchemaSha256: 'schema-a',
                caseSetSha256: 'case-set-a',
                familyCount: 1,
                caseCount: 1,
                meanSensitivityQuality: 5,
                scoreAverages: { overall: 5 },
            },
            familyDeltas: { 'family-a': { current: 5 } },
        }));

        const result = run(appDir);
        expect(result.status).toBe(1);
        expect(result.stderr).toContain('Judge prompt hash changed');
    });

    it('rejects legacy previous artifacts that lack immutable case-set provenance', () => {
        const { appDir } = setup();
        const historyDir = join(appDir, 'artifacts/ai-plan-judge/history');
        mkdirSync(historyDir, { recursive: true });
        writeFileSync(join(historyDir, 'diff-2026-08-23T10-00-00-000Z.json'), JSON.stringify({
            comparedAt: '2026-08-23T10:00:00.000Z',
            current: {
                corpusCommit: 'previous',
                judgeModel: 'judge-model',
                judgeProvider: 'local',
                promptSha256: 'prompt-a',
                responseSchemaSha256: 'schema-a',
                familyCount: 1,
                caseCount: 1,
                meanSensitivityQuality: 5,
                scoreAverages: { overall: 5 },
            },
            familyDeltas: { 'family-a': { current: 5 } },
        }));

        const result = run(appDir);
        expect(result.status).toBe(1);
        expect(result.stderr).toContain('missing case-set provenance');
    });

    it('auto-resolves 4B baseline when judgeModel matches 4B and 4B baseline exists', () => {
        const root = mkdtempSync(join(tmpdir(), 'judge-drift-4b-'));
        roots.push(root);
        const appDir = join(root, 'app');
        const currentPath = join(appDir, 'artifacts/ai-plan-judge/latest/judge-summary.json');
        const baseline4bPath = join(root, 'docs/analysis/plan-judge-baseline.4b.json');
        mkdirSync(dirname(currentPath), { recursive: true });
        mkdirSync(dirname(baseline4bPath), { recursive: true });

        const current4b = summary('current');
        current4b.provenance.judgeModel = 'hf.co/empero-ai/Qwen3.8-4B-Distill-GGUF';
        const baseline4b = summary('baseline');
        baseline4b.provenance.judgeModel = 'hf.co/empero-ai/Qwen3.8-4B-Distill-GGUF';

        writeFileSync(currentPath, JSON.stringify(current4b));
        writeFileSync(baseline4bPath, JSON.stringify(baseline4b));

        const result = spawnSync(process.execPath, [SCRIPT], { cwd: appDir, encoding: 'utf8' });
        expect(result.status).toBe(0);
        expect(result.stdout).toContain('Baseline (4B)');
        expect(result.stdout).toContain('Diff check complete');
    });
});

describe('judge:diff settings comparability guard', () => {
    it('fails closed when sample count differs from the baseline', () => {
        const { appDir } = setupWithSettings(
            { samples: 5, packetVersion: 'v2', thinkingEnabled: false, numCtx: 65536 },
            { samples: 1, packetVersion: 'v2', thinkingEnabled: false, numCtx: 65536 },
        );
        const result = runDirect(appDir);
        expect(result.status).toBe(1);
        expect(result.stderr).toContain('NOT COMPARABLE');
        expect(result.stderr).toContain('Sample count changed: 5 -> 1');
        expect(result.stderr).toContain('judge:e2e');
    });

    it('fails closed when packet version, thinking mode, and context window all differ', () => {
        const { appDir } = setupWithSettings(
            { samples: 5, packetVersion: 'v2', thinkingEnabled: false, numCtx: 65536 },
            { samples: 5, packetVersion: 'v1', thinkingEnabled: true, numCtx: 32768 },
        );
        const result = runDirect(appDir);
        expect(result.status).toBe(1);
        expect(result.stderr).toContain('Packet version changed: v2 -> v1');
        expect(result.stderr).toContain('Thinking mode changed: false -> true');
        expect(result.stderr).toContain('Context window (num_ctx) changed: 65536 -> 32768');
    });

    it('does not flag a settings match', () => {
        const { appDir } = setupWithSettings(
            { samples: 5, packetVersion: 'v2', thinkingEnabled: false, numCtx: 65536 },
            { samples: 5, packetVersion: 'v2', thinkingEnabled: false, numCtx: 65536 },
        );
        const result = runDirect(appDir);
        expect(result.status).toBe(0);
        expect(result.stdout).toContain('Diff check complete');
        expect(result.stdout).not.toContain('Judge run settings differ');
    });

    it('downgrades to a warning under --allow-settings-change', () => {
        const { appDir } = setupWithSettings(
            { samples: 5, packetVersion: 'v2', thinkingEnabled: false, numCtx: 65536 },
            { samples: 1, packetVersion: 'v1', thinkingEnabled: true, numCtx: 32768 },
        );
        const result = runDirect(appDir, ['--allow-settings-change']);
        expect(result.status).toBe(0);
        expect(result.stdout).toContain('Comparability Warnings');
        expect(result.stdout).toContain('Continuing because --allow-settings-change was supplied');
    });

    it('treats missing settings on either side as a non-fatal warning, not a proven mismatch', () => {
        const { appDir } = setup();
        const result = runDirect(appDir);
        expect(result.status).toBe(0);
        expect(result.stdout).toContain('not recorded on one side');
    });
});
