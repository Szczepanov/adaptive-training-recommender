import { appendFileSync } from 'node:fs';

function sumRejectionCounts(planDays) {
  const totals = {};
  for (const day of planDays ?? []) {
    const counts = day?.rejectionCounts;
    if (!counts) continue;
    for (const [reason, count] of Object.entries(counts)) {
      totals[reason] = (totals[reason] ?? 0) + count;
    }
  }
  return Object.keys(totals).length > 0 ? totals : null;
}

export function evaluateDiagnosticFidelity({ casePlan, engineSummary, judgedCase }) {
  const warnings = engineSummary?.qualityWarnings ?? [];
  const violations = engineSummary?.constraintViolations ?? [];
  const flags = judgedCase?.flags ?? [];

  let diagnosticFidelity = 'accurate';
  const notes = [];

  if (violations.length > 0) {
    diagnosticFidelity = 'accurate';
    notes.push(`Engine recorded ${violations.length} hard constraint violation(s).`);
  } else if (!judgedCase) {
    diagnosticFidelity = 'missing_judge_result';
    notes.push('No matching judged case was found for this caseId; diagnostic fidelity could not be evaluated against judge output.');
  } else if (warnings.length > 0 && flags.length === 0 && (judgedCase.scores?.overall ?? 10) >= 8) {
    diagnosticFidelity = 'potential_false_alarm';
    notes.push('Engine emitted quality warnings but plan received high independent judge score without negative flags.');
  } else if (warnings.length === 0 && (judgedCase.scores?.overall ?? 10) < 6) {
    diagnosticFidelity = 'potential_masked_defect';
    notes.push('Plan received low score from independent judge but engine emitted zero quality warnings.');
  } else {
    diagnosticFidelity = 'consistent';
    notes.push('Diagnostic warnings and independent plan scores are consistent.');
  }

  return {
    diagnosticFidelity,
    engineWarnings: warnings,
    engineViolations: violations,
    rejectionCounts: sumRejectionCounts(casePlan),
    judgedOverallScore: judgedCase?.scores?.overall ?? null,
    judgedFlags: flags,
    notes: notes.join(' '),
  };
}

export function auditFamilyDiagnostics(rawFamily, judgedFamilyResult) {
  const familyId = rawFamily.familyId;
  const judgedCaseMap = new Map((judgedFamilyResult?.caseScores ?? []).map((c) => [c.caseId, c]));

  const records = [];
  for (const item of rawFamily.cases ?? []) {
    const caseId = item.input?.caseId;
    const judgedCase = judgedCaseMap.get(caseId);
    const fidelity = evaluateDiagnosticFidelity({
      casePlan: item.plan,
      engineSummary: item.engineSummary,
      judgedCase,
    });

    records.push({
      familyId,
      caseId,
      ...fidelity,
      timestamp: new Date().toISOString(),
    });
  }

  return records;
}

export function appendDiagnosticAuditRecords(auditPath, records) {
  for (const record of records) {
    appendFileSync(auditPath, `${JSON.stringify(record)}\n`, 'utf8');
  }
}
