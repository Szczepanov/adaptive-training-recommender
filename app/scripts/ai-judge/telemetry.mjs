import { appendFileSync, renameSync, writeFileSync } from 'node:fs';

export function computeContextUtilization(promptTokens, contextLength) {
  if (!Number.isFinite(promptTokens) || !Number.isFinite(contextLength) || contextLength <= 0) {
    return null;
  }
  return Math.round((promptTokens / contextLength) * 1000) / 1000;
}

export function atomicWriteFile(targetPath, content) {
  const tempPath = `${targetPath}.tmp.${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  writeFileSync(tempPath, content, 'utf8');
  renameSync(tempPath, targetPath);
}

export function atomicWriteJson(targetPath, data, space = 2) {
  const content = `${JSON.stringify(data, null, space)}\n`;
  atomicWriteFile(targetPath, content);
}

export function appendAttemptRecord(attemptsPath, record) {
  const cleanRecord = {
    familyId: record.familyId,
    sampleIndex: record.sampleIndex ?? 0,
    ...(record.batchIndex != null ? { batchIndex: record.batchIndex } : {}),
    ...(record.seed != null ? { seed: record.seed } : {}),
    attempt: record.attempt ?? 1,
    status: record.status, // 'accepted' | 'rejected'
    errorCategory: record.errorCategory ?? null,
    errorMessage: record.errorMessage ? String(record.errorMessage).slice(0, 300) : null,
    promptTokens: record.promptTokens ?? null,
    completionTokens: record.completionTokens ?? null,
    totalTokens: record.totalTokens ?? null,
    contextLength: record.contextLength ?? null,
    promptContextUtilization: computeContextUtilization(record.promptTokens, record.contextLength),
    doneReason: record.doneReason ?? null,
    schemaEnforced: record.schemaEnforced ?? null,
    elapsedMs: record.elapsedMs ?? 0,
    timestamp: record.timestamp ?? new Date().toISOString(),
  };

  appendFileSync(attemptsPath, `${JSON.stringify(cleanRecord)}\n`, 'utf8');
  return cleanRecord;
}
