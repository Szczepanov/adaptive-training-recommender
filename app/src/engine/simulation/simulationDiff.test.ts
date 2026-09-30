import { describe, expect, it } from 'vitest';
import type { ScenarioResult, SimulationReport } from './analyze';
import {
  computeBaselineHash,
  computeCorpusHash,
  diffSimulationReports,
  formatSimulationDiffReport,
  normalizeSimulationReport,
} from './simulationDiff';

function makeMockScenario(overrides: Partial<ScenarioResult> & { scenarioId: string; label: string }): ScenarioResult {
  const { scenarioId, label, ...rest } = overrides;
  return {
    scenarioId,
    label,
    description: 'Test scenario description',
    tags: [],
    weeksSimulated: 4,
    totalDays: 28,
    categoryDistribution: { 'Easy Endurance': 8, Rest: 6 },
    modalityDistribution: { Cycling: 14, None: 6 },
    restOrRecoveryDayCount: 6,
    restOrRecoveryDayPct: 21.4,
    maxConsecutiveSameTemplateStreakWithinCall: 1,
    maxConsecutiveSameTemplateStreakAcrossWeeks: 1,
    objectiveResolution: [{ key: 'endurance', timesGenerated: 4, timesResolved: 4 }],
    objectiveCredits: [],
    utilityDiagnostics: { fragileSelectionCount: 0, lowerBenefitSelectionCount: 0, trainTierRestOrRecoveryCount: 0 },
    qualityWarnings: [],
    anchorWeeks: [],
    anchorScopeNote: null,
    fatigueTierDayCounts: { train: 18, modify: 4, recover: 6 },
    constraintViolations: [],
    allocationReports: [],
    decisionTraces: [],
    sequencingDiagnostics: {
      residualFatigueCollision: { perDay: [], meanCollision: 0, maxCollision: 0 },
      adjacentCostOverlap: { perPair: [], maxLowerBodyOverlap: 0, maxImpactTissueOverlap: 0, maxNeuromuscularOverlap: 0, meanOverlap: 0 },
      qualitySpacing: { gapsDays: [], minGapDays: null, medianGapDays: null, adjacentQualityDayCount: 0, longestQualityStreak: 0, qualityPer3DayWindowMax: 0, qualityPer7DayWindowMax: 0 },
      hardDayConcentration: { weekly: [] },
      opportunityCost: {
        daysWithRankingAudit: 0,
        utilityWinnerDifferentCount: 0,
        utilityWinnerBlockedCount: 0,
        utilityWinnerDifferentWithoutTierBlockCount: 0,
        meanBlockedUtilityGap: 0,
        maxBlockedUtilityGap: 0,
        blockedByTier: { coverage: 0, recovery: 0, benefit: 0 },
        perDay: [],
      },
    },
    weekSummaries: [],
    ...rest,
  };
}

function makeMockReport(scenarios: ScenarioResult[], overrides: Partial<SimulationReport> = {}): SimulationReport {
  return {
    commit: 'test-commit',
    capturedAt: '2026-09-30T10:00:00.000Z',
    engineVersion: 'v2',
    policyVersion: '2026-09-test-v1',
    scenarios,
    preferenceSensitivity: [],
    readinessSensitivity: [],
    ...overrides,
  };
}

describe('simulationDiff', () => {
  describe('deterministic corpus and baseline hashing', () => {
    it('produces identical corpus hashes regardless of scenario array ordering', () => {
      const s1 = makeMockScenario({ scenarioId: 's1', label: 'Scenario 1' });
      const s2 = makeMockScenario({ scenarioId: 's2', label: 'Scenario 2' });

      const hashA = computeCorpusHash([s1, s2]);
      const hashB = computeCorpusHash([s2, s1]);

      expect(hashA).toBe(hashB);
      expect(hashA.length).toBe(12);
    });

    it('computes deterministic baseline content hash', () => {
      const content = JSON.stringify({ commit: 'baseline', scenarios: [] });
      const hash = computeBaselineHash(content);
      expect(hash).toBe(computeBaselineHash(content));
      expect(hash.length).toBe(12);
    });
  });

  describe('runtime metadata normalization', () => {
    it('strips non-semantic capture timestamps and commit metadata', () => {
      const reportA = makeMockReport(
        [makeMockScenario({ scenarioId: 's1', label: 'Scenario 1' })],
        { commit: 'commit-aaa', capturedAt: '2026-01-01T00:00:00Z' },
      );
      const reportB = makeMockReport(
        [makeMockScenario({ scenarioId: 's1', label: 'Scenario 1' })],
        { commit: 'commit-bbb', capturedAt: '2026-09-30T23:59:59Z' },
      );

      const normA = normalizeSimulationReport(reportA);
      const normB = normalizeSimulationReport(reportB);

      expect(normA.commit).toBe('normalized');
      expect(normA.capturedAt).toBe('normalized');
      expect(normB.commit).toBe('normalized');
      expect(normB.capturedAt).toBe('normalized');

      const diff = diffSimulationReports(normA, normB);
      expect(diff.changesFound).toBe(false);
    });
  });

  describe('fixture 1: historical drift only', () => {
    it('reports baseline drift while PR-specific diff remains clean', () => {
      // Historical committed baseline has scenario with 28.6% rest
      const baselineScenario = makeMockScenario({
        scenarioId: 'cycling_gran_fondo_A',
        label: 'Cycling A-event (gran fondo)',
        restOrRecoveryDayPct: 28.6,
      });
      const baselineReport = makeMockReport([baselineScenario]);

      // Base branch already drifted to 21.4%
      const baseScenario = makeMockScenario({
        scenarioId: 'cycling_gran_fondo_A',
        label: 'Cycling A-event (gran fondo)',
        restOrRecoveryDayPct: 21.4,
      });
      const baseReport = makeMockReport([baseScenario]);

      // PR merge result has identical 21.4% (no PR changes to this scenario)
      const prMergeReport = makeMockReport([baseScenario]);

      const prDiff = diffSimulationReports(baseReport, prMergeReport);
      const baselineDrift = diffSimulationReports(baselineReport, baseReport);

      expect(prDiff.changesFound).toBe(false);
      expect(prDiff.modifiedScenarios).toHaveLength(0);

      expect(baselineDrift.changesFound).toBe(true);
      expect(baselineDrift.modifiedScenarios).toHaveLength(1);
      expect(baselineDrift.modifiedScenarios[0].diffs).toContain('  Rest/Recovery %: 28.6% -> 21.4%');

      const formatted = formatSimulationDiffReport({
        prDiff,
        baselineDrift,
        provenance: {
          baseSha: 'base123',
          prHeadSha: 'head456',
          mergeSha: 'merge789',
          baselineIdentity: 'basehash000',
          policyVersion: '2026-09-test-v1',
          scenarioCount: 1,
          corpusHash: 'corpushash01',
        },
      });

      expect(formatted).toContain('=== PR-specific Simulation Semantic Diff ===');
      expect(formatted).toContain('No PR-specific semantic changes detected.');
      expect(formatted).toContain('=== Existing Main-vs-Reviewed-Baseline Drift ===');
      expect(formatted).toContain('[MODIFIED] Cycling A-event (gran fondo) (cycling_gran_fondo_A):');
      expect(formatted).toContain('Rest/Recovery %: 28.6% -> 21.4%');
    });
  });

  describe('fixture 2: historical drift + incremental PR change', () => {
    it('isolates incremental PR delta in PR section while preserving historical drift in baseline section', () => {
      // Historical baseline: scenario A = 28.6%, scenario B = 10%
      const baselineReport = makeMockReport([
        makeMockScenario({ scenarioId: 'sc_A', label: 'Scenario A', restOrRecoveryDayPct: 28.6 }),
        makeMockScenario({ scenarioId: 'sc_B', label: 'Scenario B', restOrRecoveryDayPct: 10.0 }),
      ]);

      // Base: scenario A had already drifted to 21.4%; scenario B is 10%
      const baseReport = makeMockReport([
        makeMockScenario({ scenarioId: 'sc_A', label: 'Scenario A', restOrRecoveryDayPct: 21.4 }),
        makeMockScenario({ scenarioId: 'sc_B', label: 'Scenario B', restOrRecoveryDayPct: 10.0 }),
      ]);

      // PR: scenario A stays 21.4%; scenario B changed to 15.0%
      const prMergeReport = makeMockReport([
        makeMockScenario({ scenarioId: 'sc_A', label: 'Scenario A', restOrRecoveryDayPct: 21.4 }),
        makeMockScenario({ scenarioId: 'sc_B', label: 'Scenario B', restOrRecoveryDayPct: 15.0 }),
      ]);

      const prDiff = diffSimulationReports(baseReport, prMergeReport);
      const baselineDrift = diffSimulationReports(baselineReport, baseReport);

      // PR-specific diff: ONLY Scenario B modified, Scenario A absent!
      expect(prDiff.changesFound).toBe(true);
      expect(prDiff.modifiedScenarios).toHaveLength(1);
      expect(prDiff.modifiedScenarios[0].scenarioId).toBe('sc_B');
      expect(prDiff.modifiedScenarios[0].diffs).toContain('  Rest/Recovery %: 10% -> 15%');

      // Baseline drift: ONLY Scenario A modified, Scenario B absent!
      expect(baselineDrift.changesFound).toBe(true);
      expect(baselineDrift.modifiedScenarios).toHaveLength(1);
      expect(baselineDrift.modifiedScenarios[0].scenarioId).toBe('sc_A');
      expect(baselineDrift.modifiedScenarios[0].diffs).toContain('  Rest/Recovery %: 28.6% -> 21.4%');

      const formatted = formatSimulationDiffReport({
        prDiff,
        baselineDrift,
        provenance: {
          baseSha: 'base-sha-111',
          prHeadSha: 'pr-head-222',
          mergeSha: 'pr-merge-333',
          baselineIdentity: 'base-hash-999',
          policyVersion: '2026-09-test-v1',
          scenarioCount: 2,
          corpusHash: 'corp-hash-888',
        },
      });

      // PR section contains ONLY Scenario B
      expect(formatted).toMatch(/=== PR-specific Simulation Semantic Diff ===[\s\S]*?\[MODIFIED\] Scenario B \(sc_B\):[\s\S]*?Rest\/Recovery %: 10% -> 15%/);
      expect(formatted.split('=== Existing Main-vs-Reviewed-Baseline Drift ===')[0]).not.toContain('Scenario A');

      // Baseline section contains ONLY Scenario A
      expect(formatted).toMatch(/=== Existing Main-vs-Reviewed-Baseline Drift ===[\s\S]*?\[MODIFIED\] Scenario A \(sc_A\):[\s\S]*?Rest\/Recovery %: 28.6% -> 21.4%/);
      expect(formatted.split('=== Existing Main-vs-Reviewed-Baseline Drift ===')[1]).not.toContain('Scenario B');
    });
  });

  describe('fixture 3: #925 class regression', () => {
    it('reproduces base containing gran fondo and 35-min cap drift with clean PR diff', () => {
      // Historical baseline: gran fondo with 28.6% rest and 35-min cap with 5 Easy, 2 Moderate
      const baselineReport = makeMockReport([
        makeMockScenario({
          scenarioId: 'cycling_gran_fondo_A',
          label: 'Cycling A-event (gran fondo, 40 days out)',
          restOrRecoveryDayPct: 28.6,
          modalityDistribution: { Cycling: 15, Strength: 5, None: 6 },
          categoryDistribution: { 'Easy Endurance': 8, Rest: 6, 'Moderate Endurance': 1 },
        }),
        makeMockScenario({
          scenarioId: 'aerobic_floor_established_35min_cap',
          label: 'Established cyclist under a 35-minute cap (#757)',
          categoryDistribution: { 'Easy Endurance': 5, 'Moderate Endurance': 2 },
        }),
      ]);

      // Base: gran fondo shifted to 21.4% rest, 35-min cap shifted to 6 Easy, 1 Moderate, plus two new #805 scenarios
      const baseGranFondo = makeMockScenario({
        scenarioId: 'cycling_gran_fondo_A',
        label: 'Cycling A-event (gran fondo, 40 days out)',
        restOrRecoveryDayPct: 21.4,
        modalityDistribution: { Cycling: 16, Strength: 6, None: 4 },
        categoryDistribution: { 'Easy Endurance': 10, Rest: 4, 'Moderate Endurance': 0 },
      });
      const base35MinCap = makeMockScenario({
        scenarioId: 'aerobic_floor_established_35min_cap',
        label: 'Established cyclist under a 35-minute cap (#757)',
        categoryDistribution: { 'Easy Endurance': 6, 'Moderate Endurance': 1 },
      });
      const baseOptedIn8wk = makeMockScenario({
        scenarioId: 'capability_maintenance_opted_in_8wk',
        label: 'Cycling-primary hybrid with broad-athleticism opt-in, 8 weeks (#805)',
      });
      const baseOptedOut8wk = makeMockScenario({
        scenarioId: 'capability_maintenance_opted_out_8wk',
        label: 'Cycling-primary hybrid without broad-athleticism opt-in, 8 weeks (#805)',
      });

      const baseReport = makeMockReport([baseGranFondo, base35MinCap, baseOptedIn8wk, baseOptedOut8wk]);

      // PR #925 touched date-local authority without changing gran fondo, 35min cap, or #805
      const prMergeReport = makeMockReport([baseGranFondo, base35MinCap, baseOptedIn8wk, baseOptedOut8wk]);

      const prDiff = diffSimulationReports(baseReport, prMergeReport);
      const baselineDrift = diffSimulationReports(baselineReport, baseReport);

      // PR diff MUST be completely clean!
      expect(prDiff.changesFound).toBe(false);
      expect(prDiff.modifiedScenarios).toHaveLength(0);
      expect(prDiff.addedScenarios).toHaveLength(0);

      // Baseline drift MUST capture gran fondo, 35-min cap, and both #805 additions!
      expect(baselineDrift.changesFound).toBe(true);
      expect(baselineDrift.modifiedScenarios).toHaveLength(2);
      expect(baselineDrift.addedScenarios).toHaveLength(2);

      const modifiedIds = baselineDrift.modifiedScenarios.map((s) => s.scenarioId);
      expect(modifiedIds).toContain('cycling_gran_fondo_A');
      expect(modifiedIds).toContain('aerobic_floor_established_35min_cap');

      const addedIds = baselineDrift.addedScenarios.map((s) => s.scenarioId);
      expect(addedIds).toContain('capability_maintenance_opted_in_8wk');
      expect(addedIds).toContain('capability_maintenance_opted_out_8wk');

      const formatted = formatSimulationDiffReport({
        prDiff,
        baselineDrift,
        provenance: {
          baseSha: 'ee18a319',
          prHeadSha: '925head',
          mergeSha: '925merge',
          baselineIdentity: 'baseline-sha',
          policyVersion: '2026-09-date-scoped-event-plan-authority-v1',
          scenarioCount: 4,
          corpusHash: 'corpus925',
        },
      });

      expect(formatted).toContain('=== PR-specific Simulation Semantic Diff ===');
      expect(formatted).toContain('Base: ee18a319');
      expect(formatted).toContain('PR head: 925head');
      expect(formatted).toContain('Merge result: 925merge');
      expect(formatted).toContain('No PR-specific semantic changes detected.');

      expect(formatted).toContain('=== Existing Main-vs-Reviewed-Baseline Drift ===');
      expect(formatted).toContain('[MODIFIED] Cycling A-event (gran fondo, 40 days out) (cycling_gran_fondo_A):');
      expect(formatted).toContain('Rest/Recovery %: 28.6% -> 21.4%');
      expect(formatted).toContain('[MODIFIED] Established cyclist under a 35-minute cap (#757) (aerobic_floor_established_35min_cap):');
      expect(formatted).toContain('Category dist: Easy Endurance: 5 -> 6, Moderate Endurance: 2 -> 1');
      expect(formatted).toContain('[NEW SCENARIO] capability_maintenance_opted_in_8wk: Cycling-primary hybrid with broad-athleticism opt-in, 8 weeks (#805)');
      expect(formatted).toContain('[NEW SCENARIO] capability_maintenance_opted_out_8wk: Cycling-primary hybrid without broad-athleticism opt-in, 8 weeks (#805)');
    });
  });

  describe('provenance and standalone baseline check', () => {
    it('formats standalone baseline report when PR diff is omitted (e.g. main branch CI)', () => {
      const baselineReport = makeMockReport([makeMockScenario({ scenarioId: 's1', label: 'S1' })]);
      const currentReport = makeMockReport([makeMockScenario({ scenarioId: 's1', label: 'S1' })]);

      const baselineDrift = diffSimulationReports(baselineReport, currentReport);

      const formatted = formatSimulationDiffReport({
        prDiff: null,
        baselineDrift,
        provenance: {
          mergeSha: 'main-head-sha',
          baselineIdentity: 'baseline-rev',
          policyVersion: '2026-09-test-v1',
          scenarioCount: 1,
          corpusHash: 'corpus123',
        },
      });

      expect(formatted).not.toContain('PR-specific');
      expect(formatted).toContain('=== Existing Main-vs-Reviewed-Baseline Drift ===');
      expect(formatted).toContain('Target: main-head-sha');
      expect(formatted).toContain('Reviewed baseline: baseline-rev');
      expect(formatted).toContain('No baseline drift detected. Simulation matches committed reviewed baseline.');
    });
  });
});
