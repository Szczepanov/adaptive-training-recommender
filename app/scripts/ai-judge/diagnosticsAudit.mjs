import { appendFileSync } from 'node:fs';

export function evaluateDiagnosticFidelity({ casePlan, engineSummary, judgedCase }) {
  const warnings = engineSummary?.warnings ?? [];
  const violations = engineSummary?.violations ?? [];
  const flags = judgedCase?.flags ?? [];

  let diagnosticFidelity = 'accurate';
  const notes = [];

  if (violations.length > 0) {
    diagnosticFidelity = 'accurate';
    notes.push(`Engine recorded ${violations.length} hard constraint violation(s).`);
  } else if (warnings.length > 0 && flags.length === 0 && (judgedCase?.scores?.overall ?? 10) >= 8) {
    diagnosticFidelity = 'potential_false_alarm';
    notes.push('Engine emitted quality warnings but plan received high independent judge score without negative flags.');
  } else if (warnings.length === 0 && (judgedCase?.scores?.overall ?? 10) < 6) {
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
    rejectionCounts: casePlan?.rejectionCounts ?? null,
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
