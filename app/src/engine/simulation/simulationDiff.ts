import { createHash } from 'node:crypto';
import type {
  ObjectiveCredit,
  ObjectiveTally,
  PreferenceSensitivityResult,
  ReadinessSensitivityResult,
  SimulationReport,
  UtilityDiagnosticsSummary,
} from './analyze';

export interface DiffProvenance {
  baseSha?: string | null;
  prHeadSha?: string | null;
  mergeSha?: string | null;
  baselineIdentity?: string | null;
  policyVersion?: string | null;
  scenarioCount?: number | null;
  corpusHash?: string | null;
}

export interface ScenarioSemanticDiff {
  scenarioId: string;
  label: string;
  kind: 'modified' | 'added' | 'removed';
  diffs: string[];
}

export interface SimulationDiffResult {
  changesFound: boolean;
  modifiedScenarios: ScenarioSemanticDiff[];
  addedScenarios: ScenarioSemanticDiff[];
  removedScenarios: ScenarioSemanticDiff[];
  topLevelDiffs: string[];
  allDiffLines: string[];
}

export interface FormattedReportOptions {
  prDiff?: SimulationDiffResult | null;
  baselineDrift?: SimulationDiffResult | null;
  provenance: DiffProvenance;
}

/**
 * Computes a deterministic short hash representing the scenario corpus.
 * Uses scenario ID, weeks simulated, and total days.
 */
export function computeCorpusHash(scenarios: readonly { scenarioId: string; weeksSimulated?: number; totalDays?: number }[]): string {
  const descriptor = scenarios
    .map((s) => `${s.scenarioId}:${s.weeksSimulated ?? 0}:${s.totalDays ?? 0}`)
    .sort()
    .join('\n');
  return createHash('sha256').update(descriptor).digest('hex').slice(0, 12);
}

/**
 * Computes a deterministic short hash for the committed baseline content.
 */
export function computeBaselineHash(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 12);
}

/**
 * Normalizes a simulation report by stripping non-semantic runtime metadata
 * such as execution timestamps and host paths.
 */
export function normalizeSimulationReport(report: SimulationReport): SimulationReport {
  return {
    commit: 'normalized',
    capturedAt: 'normalized',
    engineVersion: report.engineVersion ?? 'v2',
    policyVersion: report.policyVersion ?? 'unknown',
    preferenceSensitivity: report.preferenceSensitivity ?? [],
    readinessSensitivity: report.readinessSensitivity ?? [],
    scenarios: (report.scenarios ?? []).map((scenario) => ({
      ...scenario,
      decisionTraces: [],
      tags: scenario.tags ? [...scenario.tags] : [],
      qualityWarnings: scenario.qualityWarnings ? [...scenario.qualityWarnings].sort() : [],
      constraintViolations: scenario.constraintViolations ? [...scenario.constraintViolations] : [],
    })),
  };
}

function diffObjectiveCredits(baseCredits: readonly ObjectiveCredit[] = [], curCredits: readonly ObjectiveCredit[] = []): string | null {
  const creditKey = (c: ObjectiveCredit) => `${c.weekIndex}|${c.date}|${c.objectiveKey}|${c.templateId}`;
  const baseKeys = new Set(baseCredits.map(creditKey));
  const curKeys = new Set(curCredits.map(creditKey));
  if (baseKeys.size !== curKeys.size || ![...baseKeys].every((k) => curKeys.has(k))) {
    return `  Objective credits: ${baseKeys.size} -> ${curKeys.size} entries (set changed)`;
  }
  return null;
}

function diffObjectiveResolutions(baseObjs: readonly ObjectiveTally[] = [], curObjs: readonly ObjectiveTally[] = []): string[] {
  const baseObjMap = new Map(baseObjs.map((o) => [o.key, o]));
  const curObjMap = new Map(curObjs.map((o) => [o.key, o]));
  const allObjKeys = new Set([...baseObjMap.keys(), ...curObjMap.keys()]);
  const objDiffs: string[] = [];
  for (const objKey of allObjKeys) {
    const bObj = baseObjMap.get(objKey);
    const cObj = curObjMap.get(objKey);
    const bStr = bObj ? `${bObj.timesResolved}/${bObj.timesGenerated}` : '0/0';
    const cStr = cObj ? `${cObj.timesResolved}/${cObj.timesGenerated}` : '0/0';
    if (bStr !== cStr) {
      objDiffs.push(`${objKey}: ${bStr} -> ${cStr}`);
    }
  }
  return objDiffs;
}

function diffUtilityDiagnostics(bUtil: UtilityDiagnosticsSummary | undefined, cUtil: UtilityDiagnosticsSummary | undefined): string[] {
  if (!bUtil && !cUtil) return [];
  const b = bUtil ?? { fragileSelectionCount: 0, lowerBenefitSelectionCount: 0, trainTierRestOrRecoveryCount: 0 };
  const c = cUtil ?? { fragileSelectionCount: 0, lowerBenefitSelectionCount: 0, trainTierRestOrRecoveryCount: 0 };
  const utilDiffs: string[] = [];
  for (const key of ['fragileSelectionCount', 'lowerBenefitSelectionCount', 'trainTierRestOrRecoveryCount'] as const) {
    if (b[key] !== c[key]) {
      utilDiffs.push(`${key}: ${b[key]} -> ${c[key]}`);
    }
  }
  return utilDiffs;
}

/**
 * Pure function comparing two simulation reports semantically.
 * Returns structured changes and preformatted lines.
 */
export function diffSimulationReports(
  baseReport: Pick<SimulationReport, 'scenarios' | 'preferenceSensitivity' | 'readinessSensitivity'>,
  currentReport: Pick<SimulationReport, 'scenarios' | 'preferenceSensitivity' | 'readinessSensitivity'>,
): SimulationDiffResult {
  const modifiedScenarios: ScenarioSemanticDiff[] = [];
  const addedScenarios: ScenarioSemanticDiff[] = [];
  const removedScenarios: ScenarioSemanticDiff[] = [];
  const topLevelDiffs: string[] = [];
  const allDiffLines: string[] = [];

  const baseScenarios = baseReport.scenarios ?? [];
  const currentScenarios = currentReport.scenarios ?? [];

  const currentByScenario = new Map(currentScenarios.map((s) => [s.scenarioId, s]));

  for (const baseScenario of baseScenarios) {
    const curScenario = currentByScenario.get(baseScenario.scenarioId);
    if (!curScenario) {
      const removedDiff: ScenarioSemanticDiff = {
        scenarioId: baseScenario.scenarioId,
        label: baseScenario.label,
        kind: 'removed',
        diffs: [`[REMOVED SCENARIO] ${baseScenario.scenarioId}: ${baseScenario.label}`],
      };
      removedScenarios.push(removedDiff);
      allDiffLines.push(removedDiff.diffs[0]);
      continue;
    }

    const diffs: string[] = [];

    // 1. Rest/Recovery Pct
    if (baseScenario.restOrRecoveryDayPct !== curScenario.restOrRecoveryDayPct) {
      diffs.push(`  Rest/Recovery %: ${baseScenario.restOrRecoveryDayPct}% -> ${curScenario.restOrRecoveryDayPct}%`);
    }

    // 2. Modality Distribution
    const allModalities = new Set([
      ...Object.keys(baseScenario.modalityDistribution ?? {}),
      ...Object.keys(curScenario.modalityDistribution ?? {}),
    ]);
    const modDiffs: string[] = [];
    for (const mod of allModalities) {
      const bVal = baseScenario.modalityDistribution?.[mod as keyof typeof baseScenario.modalityDistribution] ?? 0;
      const cVal = curScenario.modalityDistribution?.[mod as keyof typeof curScenario.modalityDistribution] ?? 0;
      if (bVal !== cVal) {
        modDiffs.push(`${mod}: ${bVal} -> ${cVal}`);
      }
    }
    if (modDiffs.length > 0) {
      diffs.push(`  Modality dist: ${modDiffs.join(', ')}`);
    }

    // 3. Category Distribution
    const allCategories = new Set([
      ...Object.keys(baseScenario.categoryDistribution ?? {}),
      ...Object.keys(curScenario.categoryDistribution ?? {}),
    ]);
    const catDiffs: string[] = [];
    for (const cat of allCategories) {
      const bVal = baseScenario.categoryDistribution?.[cat as keyof typeof baseScenario.categoryDistribution] ?? 0;
      const cVal = curScenario.categoryDistribution?.[cat as keyof typeof curScenario.categoryDistribution] ?? 0;
      if (bVal !== cVal) {
        catDiffs.push(`${cat}: ${bVal} -> ${cVal}`);
      }
    }
    if (catDiffs.length > 0) {
      diffs.push(`  Category dist: ${catDiffs.join(', ')}`);
    }

    // 4. Fatigue Tier Days
    const bFat = baseScenario.fatigueTierDayCounts ?? { train: 0, modify: 0, recover: 0 };
    const cFat = curScenario.fatigueTierDayCounts ?? { train: 0, modify: 0, recover: 0 };
    if (bFat.train !== cFat.train || bFat.modify !== cFat.modify || bFat.recover !== cFat.recover) {
      diffs.push(`  Fatigue tiers (train/modify/recover): ${bFat.train}/${bFat.modify}/${bFat.recover} -> ${cFat.train}/${cFat.modify}/${cFat.recover}`);
    }

    // 5. Objective Resolution
    const objDiffs = diffObjectiveResolutions(baseScenario.objectiveResolution, curScenario.objectiveResolution);
    if (objDiffs.length > 0) {
      diffs.push(`  Objective resolution: ${objDiffs.join(', ')}`);
    }

    // 6. Objective Credits
    const creditDiff = diffObjectiveCredits(baseScenario.objectiveCredits, curScenario.objectiveCredits);
    if (creditDiff) {
      diffs.push(creditDiff);
    }

    // 7. Utility diagnostics
    const utilDiffs = diffUtilityDiagnostics(baseScenario.utilityDiagnostics, curScenario.utilityDiagnostics);
    if (utilDiffs.length > 0) {
      diffs.push(`  Utility diagnostics: ${utilDiffs.join(', ')}`);
    }

    // 8. Quality warnings
    const baseWarnings = [...(baseScenario.qualityWarnings ?? [])].sort();
    const curWarnings = [...(curScenario.qualityWarnings ?? [])].sort();
    if (JSON.stringify(baseWarnings) !== JSON.stringify(curWarnings)) {
      diffs.push(`  Quality warnings: [${baseWarnings.join(' | ')}] -> [${curWarnings.join(' | ')}]`);
    }

    // 9. Anchor weeks
    const anchorKey = (w: (typeof baseScenario.anchorWeeks)[number]) =>
      `${w.weekIndex}|${w.eventSpecificAnchorDate}|${w.qualityAnchorDate}|${w.eventSpecificAnchorHit}|${w.eventSpecificAnchorFulfilled}|${w.qualityAnchorHit}`;
    const baseAnchorKeys = (baseScenario.anchorWeeks ?? []).map(anchorKey);
    const curAnchorKeys = (curScenario.anchorWeeks ?? []).map(anchorKey);
    if (JSON.stringify(baseAnchorKeys) !== JSON.stringify(curAnchorKeys)) {
      diffs.push(`  Anchor weeks changed (${baseAnchorKeys.length} -> ${curAnchorKeys.length} weeks, or hit/fulfilled state differs)`);
    }

    // 10. Same-template streak diagnostics
    if (baseScenario.maxConsecutiveSameTemplateStreakWithinCall !== curScenario.maxConsecutiveSameTemplateStreakWithinCall) {
      diffs.push(`  Max streak within call: ${baseScenario.maxConsecutiveSameTemplateStreakWithinCall} -> ${curScenario.maxConsecutiveSameTemplateStreakWithinCall}`);
    }
    if (baseScenario.maxConsecutiveSameTemplateStreakAcrossWeeks !== curScenario.maxConsecutiveSameTemplateStreakAcrossWeeks) {
      diffs.push(`  Max streak across weeks: ${baseScenario.maxConsecutiveSameTemplateStreakAcrossWeeks} -> ${curScenario.maxConsecutiveSameTemplateStreakAcrossWeeks}`);
    }

    if (diffs.length > 0) {
      modifiedScenarios.push({
        scenarioId: curScenario.scenarioId,
        label: curScenario.label,
        kind: 'modified',
        diffs,
      });
      allDiffLines.push(`[MODIFIED] ${curScenario.label} (${curScenario.scenarioId}):`);
      diffs.forEach((d) => allDiffLines.push(d));
      allDiffLines.push('');
    }
  }

  // Check for new scenarios
  const baseScenarioIds = new Set(baseScenarios.map((s) => s.scenarioId));
  for (const curScenario of currentScenarios) {
    if (!baseScenarioIds.has(curScenario.scenarioId)) {
      const addedDiff: ScenarioSemanticDiff = {
        scenarioId: curScenario.scenarioId,
        label: curScenario.label,
        kind: 'added',
        diffs: [`[NEW SCENARIO] ${curScenario.scenarioId}: ${curScenario.label}`],
      };
      addedScenarios.push(addedDiff);
      allDiffLines.push(addedDiff.diffs[0]);
    }
  }

  // 11. Readiness & Preference sensitivity (top-level fields)
  const sensitivityKey = (r: PreferenceSensitivityResult | ReadinessSensitivityResult) => JSON.stringify(r);
  const baseReadiness = (baseReport.readinessSensitivity ?? []).map(sensitivityKey);
  const curReadiness = (currentReport.readinessSensitivity ?? []).map(sensitivityKey);
  if (JSON.stringify(baseReadiness) !== JSON.stringify(curReadiness)) {
    const lines = [
      '[MODIFIED] readinessSensitivity:',
      `  ${JSON.stringify(baseReport.readinessSensitivity)} ->`,
      `  ${JSON.stringify(currentReport.readinessSensitivity)}`,
      '',
    ];
    topLevelDiffs.push(...lines);
    allDiffLines.push(...lines);
  }

  const basePreference = (baseReport.preferenceSensitivity ?? []).map(sensitivityKey);
  const curPreference = (currentReport.preferenceSensitivity ?? []).map(sensitivityKey);
  if (JSON.stringify(basePreference) !== JSON.stringify(curPreference)) {
    const lines = [
      '[MODIFIED] preferenceSensitivity:',
      `  ${JSON.stringify(baseReport.preferenceSensitivity)} ->`,
      `  ${JSON.stringify(currentReport.preferenceSensitivity)}`,
      '',
    ];
    topLevelDiffs.push(...lines);
    allDiffLines.push(...lines);
  }

  const changesFound =
    modifiedScenarios.length > 0 ||
    addedScenarios.length > 0 ||
    removedScenarios.length > 0 ||
    topLevelDiffs.length > 0;

  return {
    changesFound,
    modifiedScenarios,
    addedScenarios,
    removedScenarios,
    topLevelDiffs,
    allDiffLines,
  };
}

/**
 * Formats the final human-readable diff output with distinct sections:
 * 1. PR-specific semantic diff (if in PR mode)
 * 2. Reviewed-baseline drift (governance signal)
 */
export function formatSimulationDiffReport(options: FormattedReportOptions): string {
  const { prDiff, baselineDrift, provenance } = options;
  const sections: string[] = [];

  const corpusInfo = provenance.scenarioCount != null
    ? `${provenance.scenarioCount} scenarios${provenance.corpusHash ? ` (${provenance.corpusHash})` : ''}`
    : null;

  if (prDiff !== undefined && prDiff !== null) {
    const prLines: string[] = ['=== PR-specific Simulation Semantic Diff ==='];
    if (provenance.baseSha) prLines.push(`Base: ${provenance.baseSha}`);
    if (provenance.prHeadSha) prLines.push(`PR head: ${provenance.prHeadSha}`);
    if (provenance.mergeSha) prLines.push(`Merge result: ${provenance.mergeSha}`);
    if (provenance.policyVersion) prLines.push(`Policy version: ${provenance.policyVersion}`);
    if (corpusInfo) prLines.push(`Corpus: ${corpusInfo}`);
    prLines.push('');

    if (!prDiff.changesFound) {
      prLines.push('No PR-specific semantic changes detected.');
    } else {
      prLines.push(...prDiff.allDiffLines);
    }
    sections.push(prLines.join('\n').trimEnd());
  }

  if (baselineDrift !== undefined && baselineDrift !== null) {
    const baseLines: string[] = ['=== Existing Main-vs-Reviewed-Baseline Drift ==='];
    if (provenance.baselineIdentity) baseLines.push(`Reviewed baseline: ${provenance.baselineIdentity}`);
    if (provenance.baseSha) {
      baseLines.push(`Base: ${provenance.baseSha}`);
    } else if (provenance.mergeSha) {
      baseLines.push(`Target: ${provenance.mergeSha}`);
    }
    if (provenance.policyVersion) baseLines.push(`Policy version: ${provenance.policyVersion}`);
    if (corpusInfo) baseLines.push(`Corpus: ${corpusInfo}`);
    baseLines.push('');

    if (!baselineDrift.changesFound) {
      baseLines.push('No baseline drift detected. Simulation matches committed reviewed baseline.');
    } else {
      baseLines.push(...baselineDrift.allDiffLines);
    }
    sections.push(baseLines.join('\n').trimEnd());
  }

  return sections.join('\n\n') + '\n';
}
