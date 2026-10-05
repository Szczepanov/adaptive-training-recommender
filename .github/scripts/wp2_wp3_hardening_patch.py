from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one match, found {count}: {old[:120]!r}")
    p.write_text(text.replace(old, new, 1))


# The accepted executable definition, not the immutable source revision, is what snapshot/hash replay verifies.
replace_once(
    "app/src/services/sessionAuthoringService.ts",
    "    const unsignedPrescription: ExecutionPrescription = {\n        schemaVersion: 1,\n        prescriptionHash: '',\n        sessionSource: source,\n        definitionHash: source.contentHash,\n        blocks: acceptedDefinition.blocks,",
    "    const acceptedDefinitionHash = await hashSessionDefinition(acceptedDefinition);\n    const unsignedPrescription: ExecutionPrescription = {\n        schemaVersion: 1,\n        prescriptionHash: '',\n        sessionSource: source,\n        definitionHash: acceptedDefinitionHash,\n        blocks: acceptedDefinition.blocks,",
)

# Legacy fixture prescriptions do not contain enough immutable bytes for exact replay.
replace_once(
    "app/src/sessions/sessionDefinitionResolver.ts",
    "        if (pinned.data.definitionSnapshot) {\n            const reconstructed = definitionFromSnapshot(pinned.data.definitionSnapshot, source);",
    "        if (pinned.data.definitionSnapshot) {\n            const reconstructed = definitionFromSnapshot(pinned.data.definitionSnapshot, source);",
)
needle = """            return { status: 'AVAILABLE', data: validation.value, revision: prescriptionHash };
        }
    }

    if (source.kind === 'unplanned_fixture') {"""
replacement = """            return { status: 'AVAILABLE', data: validation.value, revision: prescriptionHash };
        }
        if (source.kind === 'unplanned_fixture') {
            return {
                status: 'INVALID',
                issues: [{
                    code: 'fixture-prescription-not-self-contained',
                    documentPath: `users/${userId}/execution_prescriptions/${prescriptionHash}`,
                }],
            };
        }
    }

    if (source.kind === 'unplanned_fixture') {"""
replace_once("app/src/sessions/sessionDefinitionResolver.ts", needle, replacement)

# Client validation mirrors the durable completion-evidence contract.
needle = """    if (raw.state !== 'completed' && raw.completedAt !== undefined) {
        issues.push({ path: 'completedAt', message: 'Only completed executions may have completedAt' });
    }

    if (raw.fitWorkoutFingerprint !== undefined) {"""
replacement = """    if (raw.state !== 'completed' && raw.completedAt !== undefined) {
        issues.push({ path: 'completedAt', message: 'Only completed executions may have completedAt' });
    }
    if (raw.completionEvidence !== undefined) {
        if (raw.state !== 'completed') {
            issues.push({ path: 'completionEvidence', message: 'Only completed executions may have completion evidence' });
        } else if (!isObject(raw.completionEvidence)) {
            issues.push({ path: 'completionEvidence', message: 'completionEvidence must be an object' });
        } else {
            const evidence = raw.completionEvidence;
            if (typeof evidence.submittedAt !== 'string' || evidence.submittedAt.length === 0) {
                issues.push({ path: 'completionEvidence.submittedAt', message: 'Missing submittedAt' });
            }
            if (evidence.sessionRpe !== undefined
                && (typeof evidence.sessionRpe !== 'number' || !Number.isFinite(evidence.sessionRpe)
                    || evidence.sessionRpe < 0 || evidence.sessionRpe > 10)) {
                issues.push({ path: 'completionEvidence.sessionRpe', message: 'sessionRpe must be between 0 and 10' });
            }
            if (evidence.completedFraction !== undefined
                && (typeof evidence.completedFraction !== 'number' || !Number.isFinite(evidence.completedFraction)
                    || evidence.completedFraction < 0 || evidence.completedFraction > 1)) {
                issues.push({ path: 'completionEvidence.completedFraction', message: 'completedFraction must be between 0 and 1' });
            }
            if (evidence.unexpectedFatigue !== undefined && typeof evidence.unexpectedFatigue !== 'boolean') {
                issues.push({ path: 'completionEvidence.unexpectedFatigue', message: 'unexpectedFatigue must be boolean' });
            }
            if (evidence.note !== undefined && (typeof evidence.note !== 'string' || evidence.note.length > 2000)) {
                issues.push({ path: 'completionEvidence.note', message: 'note must be a string of at most 2000 characters' });
            }
        }
    }

    if (raw.fitWorkoutFingerprint !== undefined) {"""
replace_once("app/src/sessions/validation.ts", needle, replacement)

# A degraded prescription must remain unavailable even if the diary itself is synchronized.
replace_once(
    "app/src/hooks/useSessionRunner.ts",
    "        const stopSync = sessionExecutionService.watchDiarySync(userId, execution.executionId, pending => {\n            if (!diaryFailedRef.current) setSyncStatus(pending ? 'queued' : 'synced');\n        }, diaryWriteOptions.onFailed);",
    "        const stopSync = sessionExecutionService.watchDiarySync(userId, execution.executionId, pending => {\n            if (!diaryFailedRef.current && resumeStatus !== 'degraded') setSyncStatus(pending ? 'queued' : 'synced');\n        }, diaryWriteOptions.onFailed);",
)

# Validate movementComposition when present instead of merely permitting the key.
replace_once(
    "app/firestore.rules",
    "        && (!('dominantModality' in meta) || meta.dominantModality is string)\n        && (!('duration' in meta) || (meta.duration is map && meta.duration.min is number && meta.duration.max is number));",
    "        && (!('dominantModality' in meta) || meta.dominantModality is string)\n        && (!('duration' in meta) || (meta.duration is map && meta.duration.min is number && meta.duration.max is number))\n        && (!('movementComposition' in meta) || meta.movementComposition is list);",
)
