import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PLAN_SCRIPT = fileURLToPath(new URL('../../scripts/check-plan-judge-drift.mjs', import.meta.url));
const PERSONA_SCRIPT = fileURLToPath(new URL('../../scripts/check-persona-judge-drift.mjs', import.meta.url));
const roots: string[] = [];

const planSettings = {
    samples: 5,
    packetVersion: 'v2',
    thinkingEnabled: false,
    baseSeed: 424242,
    seedStrategy: 'derived',
    temperature: 0.1,
    numCtx: 65536,
    numPredict: 16384,
    rubricScale: '0-10',
    isPairwise: false,
};

afterEach(() => {
    while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

function planSummary(commit: string, settings: Record<string, unknown>) {
    return {
        schema: 'adaptive-training-recommender/ai-plan-judge-summary@3',
        provenance: {
            corpusCommit: commit,
            judgeModel: 'judge-model',
            judgeProvider: 'local',
            promptSha256: 'prompt-a',
            responseSchemaSha256: 'schema-a',
            caseSetSha256: 'case-set-a',
            corpusSha256: 'corpus-a',
            familiesSha256: 'families-a',
            judgeSettings: settings,
        },
        familyCount: 1,
        caseCount: 1,
        meanSensitivityQuality: 5,
        scoreAverages: { overall: 5 },
        familySensitivity: [{ familyId: 'family-a', sensitivityQuality: 5 }],
    };
}

function setupPlan(baselineSettings: Record<string, unknown>, currentSettings: Record<string, unknown>) {
    const root = mkdtempSync(join(tmpdir(), 'judge-settings-provenance-'));
    roots.push(root);
    const appDir = join(root, 'app');
    const currentPath = join(appDir, 'artifacts/ai-plan-judge/latest/judge-summary.json');
    const baselinePath = join(root, 'docs/analysis/plan-judge-baseline.json');
    mkdirSync(dirname(currentPath), { recursive: true });
    mkdirSync(dirname(baselinePath), { recursive: true });
    writeFileSync(currentPath, JSON.stringify(planSummary('current', currentSettings)));
    writeFileSync(baselinePath, JSON.stringify(planSummary('baseline', baselineSettings)));
    return { appDir };
}

function setupPersona(baselineSettings: Record<string, unknown>, manifest: Record<string, unknown>) {
    const root = mkdtempSync(join(tmpdir(), 'persona-settings-provenance-'));
    roots.push(root);
    const appDir = join(root, 'app');
    const outputDir = join(appDir, 'artifacts/persona-plan-judge/latest');
    const baselinePath = join(root, 'docs/analysis/persona-judge-baseline.json');
    mkdirSync(outputDir, { recursive: true });
    mkdirSync(dirname(baselinePath), { recursive: true });

    writeFileSync(join(outputDir, 'corpus.json'), JSON.stringify({ commit: 'same-commit' }));
    writeFileSync(join(outputDir, 'judge-scores.jsonl'), `${JSON.stringify({
        familyId: 'family-a',
        familyAssessment: { sensitivity_quality: 5 },
        caseScores: [{ scores: { overall: 5 } }],
    })}\n`);
    writeFileSync(join(outputDir, 'judge-run-manifest.json'), JSON.stringify(manifest));
    writeFileSync(baselinePath, JSON.stringify({
        provenance: { judgeModel: 'judge-model', judgeProvider: 'local', judgeSettings: baselineSettings },
        familyCount: 1,
        caseCount: 1,
        meanSensitivityQuality: 5,
        scoreAverages: { overall: 5 },
        familySensitivity: [{ familyId: 'family-a', sensitivityQuality: 5 }],
    }));
    return { appDir };
}

describe('judge settings provenance completeness', () => {
    it('warns when an individual plan-judge setting is missing instead of silently skipping it', () => {
        const { numPredict: _omitted, ...partialBaseline } = planSettings;
        const { appDir } = setupPlan(partialBaseline, planSettings);
        const result = spawnSync(process.execPath, [PLAN_SCRIPT], { cwd: appDir, encoding: 'utf8' });

        expect(result.status).toBe(0);
        expect(result.stdout).toContain('Judge run settings are incomplete');
        expect(result.stdout).toContain('Prediction budget (num_predict) (baseline)');
    });

    it('carries judge settings through historical diff artifacts so --previous can reject drift', () => {
        const { appDir } = setupPlan(planSettings, planSettings);
        const historyDir = join(appDir, 'artifacts/ai-plan-judge/history');
        mkdirSync(historyDir, { recursive: true });
        writeFileSync(join(historyDir, 'diff-2026-09-08T10-00-00-000Z.json'), JSON.stringify({
            comparedAt: '2026-09-08T10:00:00.000Z',
            current: {
                corpusCommit: 'previous',
                judgeModel: 'judge-model',
                judgeProvider: 'local',
                promptSha256: 'prompt-a',
                responseSchemaSha256: 'schema-a',
                caseSetSha256: 'case-set-a',
                corpusSha256: 'corpus-old',
                familiesSha256: 'families-old',
                judgeSettings: { ...planSettings, samples: 1 },
                familyCount: 1,
                caseCount: 1,
                meanSensitivityQuality: 5,
                scoreAverages: { overall: 5 },
            },
            familyDeltas: { 'family-a': { current: 5 } },
        }));

        const result = spawnSync(process.execPath, [PLAN_SCRIPT, '--previous'], { cwd: appDir, encoding: 'utf8' });
        expect(result.status).toBe(1);
        expect(result.stderr).toContain('Sample count changed: 1 -> 5');
    });

    it('warns when an individual persona-judge setting is missing', () => {
        const { appDir } = setupPersona(
            { samples: 5, baseSeed: 424242, thinkingEnabled: true },
            {
                judgeModel: 'judge-model',
                judgeProvider: 'local',
                samples: 5,
                baseSeed: 424242,
                seedStrategy: 'derived',
                thinkingEnabled: true,
            },
        );
        const result = spawnSync(process.execPath, [PERSONA_SCRIPT], { cwd: appDir, encoding: 'utf8' });

        expect(result.status).toBe(0);
        expect(result.stdout).toContain('Judge run settings are incomplete');
        expect(result.stdout).toContain('Seed strategy (baseline)');
    });

    it('treats persona seed drift as non-comparable', () => {
        const { appDir } = setupPersona(
            { samples: 5, baseSeed: 424242, seedStrategy: 'derived', thinkingEnabled: true },
            {
                judgeModel: 'judge-model',
                judgeProvider: 'local',
                samples: 5,
                baseSeed: 424243,
                seedStrategy: 'derived',
                thinkingEnabled: true,
            },
        );
        const result = spawnSync(process.execPath, [PERSONA_SCRIPT], { cwd: appDir, encoding: 'utf8' });

        expect(result.status).toBe(1);
        expect(result.stderr).toContain('Base seed changed: 424242 -> 424243');
    });
});
