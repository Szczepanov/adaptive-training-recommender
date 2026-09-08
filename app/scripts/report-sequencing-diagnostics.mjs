// Issue #458: a report, not a gate. Ranks the current scenario/judge corpus by the
// deterministic sequencing diagnostics from app/src/engine/simulation/sequencingMetrics.ts
// and cross-references cases against the committed judge baselines, to answer the analysis
// doc's explicit question (docs/analysis/2026-09-07-recommender-optimization-opportunities.md
// §4, acceptance criteria): "which cases have the worst sequence collision, and do they
// overlap with the cases the judge scores poorly on sequencing?" It also prints the top 20
// largest ordinal-vs-utility ranking disagreements (§6's acceptance criterion).
//
// This script only reads already-generated artifacts -- it does not run the engine itself,
// so it is cheap and safe to run repeatedly. Run `npm run build:plan-judge-corpus` first
// (or `npm run simulate:plan-judge`) to (re)generate the corpus it reads.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const corpusPath = resolve('artifacts/ai-plan-judge/latest/corpus.json');
if (!existsSync(corpusPath)) {
  console.error(`Corpus not found at ${corpusPath}. Run "npm run build:plan-judge-corpus" first.`);
  process.exit(1);
}

const corpus = JSON.parse(readFileSync(corpusPath, 'utf8'));

/** Judge baselines are optional context: this report is fully useful from deterministic
 * diagnostics alone, and a missing/renamed baseline file should not block it. */
function loadBaselineSequencingScores(path) {
  if (!existsSync(path)) return new Map();
  try {
    const baseline = JSON.parse(readFileSync(path, 'utf8'));
    const scores = new Map();
    for (const bucket of [...(baseline.weakestCases ?? []), ...(baseline.strongestCases ?? [])]) {
      if (bucket.caseId && bucket.scores?.sequencing !== undefined) {
        scores.set(bucket.caseId, bucket.scores.sequencing);
      }
    }
    return scores;
  } catch {
    return new Map();
  }
}

const judgeSequencingScores = new Map([
  ...loadBaselineSequencingScores(resolve('../docs/analysis/plan-judge-baseline.json')),
  ...loadBaselineSequencingScores(resolve('../docs/analysis/persona-judge-baseline.json')),
]);

const cases = [];
for (const family of corpus.families ?? []) {
  for (const c of family.cases ?? []) {
    const diagnostics = c.engineSummary?.sequencingDiagnostics;
    if (!diagnostics) continue;
    cases.push({
      familyId: family.familyId,
      caseId: c.input.caseId,
      label: c.input.label,
      simulationMode: c.input.simulationMode,
      diagnostics,
      judgeSequencingScore: judgeSequencingScores.get(c.input.caseId) ?? null,
    });
  }
}

if (cases.length === 0) {
  console.error('No cases with sequencingDiagnostics found in the corpus. Regenerate it and retry.');
  process.exit(1);
}

function fmt(n, digits = 3) {
  return typeof n === 'number' ? n.toFixed(digits) : String(n);
}

function peakCollisionDay(diagnostics) {
  const days = diagnostics.residualFatigueCollision.perDay ?? [];
  if (days.length === 0) return null;
  return days.reduce((best, day) => day.collision > best.collision ? day : best, days[0]);
}

// -- Worst residual-fatigue collision ---------------------------------------------------
const byMaxCollision = [...cases].sort(
  (a, b) => b.diagnostics.residualFatigueCollision.maxCollision - a.diagnostics.residualFatigueCollision.maxCollision,
);
console.log('=== Top 20 cases by worst residual-fatigue collision (§4.1) ===');
for (const c of byMaxCollision.slice(0, 20)) {
  const judgeNote = c.judgeSequencingScore !== null ? `judge sequencing=${fmt(c.judgeSequencingScore, 1)}` : 'judge sequencing=(not in baseline weakest/strongest set)';
  const peak = peakCollisionDay(c.diagnostics);
  const peakNote = peak ? ` peak=${peak.date} costMagnitude=${fmt(peak.costMagnitude)}` : '';
  console.log(`${c.caseId} (${c.familyId}, ${c.simulationMode}): maxCollision=${fmt(c.diagnostics.residualFatigueCollision.maxCollision)} meanCollision=${fmt(c.diagnostics.residualFatigueCollision.meanCollision)}${peakNote} -- ${judgeNote}`);
}

const overlap = byMaxCollision
  .slice(0, 20)
  .filter(c => c.judgeSequencingScore !== null && c.judgeSequencingScore < 7);
console.log('');
console.log(`Cases both high-collision (top 20) and judge-scored poorly on sequencing (<7): ${overlap.length}`);
overlap.forEach(c => console.log(`  ${c.caseId}: maxCollision=${fmt(c.diagnostics.residualFatigueCollision.maxCollision)} judgeSequencing=${fmt(c.judgeSequencingScore, 1)}`));

// -- Top 20 largest ordinal-vs-utility ranking disagreements (§6) -----------------------
// Opportunity-cost diagnostics retain compact per-day disagreement detail so this report can
// name the exact selected/counterfactual templates and blocking tiers, not only case aggregates.
const dayLevelDisagreements = [];
let nonTierDifferenceCount = 0;
for (const c of cases) {
  const oc = c.diagnostics.opportunityCost;
  nonTierDifferenceCount += oc.utilityWinnerDifferentWithoutTierBlockCount ?? 0;
  for (const day of oc.perDay ?? []) {
    if (!day.tierBlocked) continue;
    dayLevelDisagreements.push({
      caseId: c.caseId,
      familyId: c.familyId,
      date: day.date,
      selectedTemplateId: day.selectedTemplateId,
      bestUtilityTemplateId: day.bestUtilityTemplateId,
      selectedVsBestUtilityGap: day.selectedVsBestUtilityGap,
      blockedByTier: day.blockedByTier,
      selectedAdvancesRequiredRole: day.selectedAdvancesRequiredRole,
    });
  }
}
dayLevelDisagreements.sort((a, b) => b.selectedVsBestUtilityGap - a.selectedVsBestUtilityGap);

console.log('');
console.log('=== Top 20 days by largest ordinal-vs-utility ranking disagreement (§6) ===');
for (const d of dayLevelDisagreements.slice(0, 20)) {
  const blockers = Object.entries(d.blockedByTier).filter(([, blocked]) => blocked).map(([tier]) => tier).join(',');
  console.log(`${d.caseId} (${d.familyId}) ${d.date}: selected=${d.selectedTemplateId} utilityWinner=${d.bestUtilityTemplateId} gap=${fmt(d.selectedVsBestUtilityGap)} blockedBy=${blockers || '(none)'} selectedAdvancesRequiredRole=${d.selectedAdvancesRequiredRole}`);
}

console.log('');
console.log(`Tier-blocked disagreement days: ${dayLevelDisagreements.length}. Same-tier utility-winner differences kept separate: ${nonTierDifferenceCount}.`);
console.log(`Cases analyzed: ${cases.length}. Corpus captured at: ${corpus.capturedAt ?? 'unknown'}, commit: ${corpus.commit ?? 'unknown'}.`);
console.log('Note: judge sequencing scores are only available for cases present in the committed');
console.log('weakest/strongest-case baseline subsets, not the full corpus -- absence does not mean');
console.log('the judge scored the case well, only that it is outside those saved subsets.');
