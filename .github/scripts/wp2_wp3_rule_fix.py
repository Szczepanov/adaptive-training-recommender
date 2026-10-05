from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one match, found {count}: {old[:120]!r}")
    p.write_text(text.replace(old, new, 1))


replace_once(
    "app/firestore.rules",
    "        && (!('sessionRpe' in evidence) || (evidence.sessionRpe is number && evidence.sessionRpe >= 0 && evidence.sessionRpe <= 10))",
    "        && (!('sessionRpe' in evidence) || (evidence.sessionRpe is number && evidence.sessionRpe >= 1 && evidence.sessionRpe <= 10))",
)

old = """      allow update: if hasValidSessionExecution(userId, executionId)
        && keepsOwnership(userId)
        && resource.data.state == 'in_progress'
        && request.resource.data.state in ['completed', 'abandoned']
        && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['state', 'updatedAt', 'completedAt', 'sessionRpe', 'notes', 'completionEvidence'])
        && request.resource.data.date == resource.data.date
        && request.resource.data.startedAt == resource.data.startedAt
        && request.resource.data.sessionSource == resource.data.sessionSource
        && (!('occurrenceId' in resource.data) ? !('occurrenceId' in request.resource.data) : request.resource.data.occurrenceId == resource.data.occurrenceId)
        && (!('prescriptionHash' in resource.data) ? !('prescriptionHash' in request.resource.data) : request.resource.data.prescriptionHash == resource.data.prescriptionHash)
        && (!('fitWorkoutFingerprint' in resource.data) ? !('fitWorkoutFingerprint' in request.resource.data) : request.resource.data.fitWorkoutFingerprint == resource.data.fitWorkoutFingerprint)
        && (!('fitWorkoutFingerprintKind' in resource.data) ? !('fitWorkoutFingerprintKind' in request.resource.data) : request.resource.data.fitWorkoutFingerprintKind == resource.data.fitWorkoutFingerprintKind)
        && ((request.resource.data.state == 'completed'
              && request.resource.data.completedAt == request.resource.data.updatedAt)
            || (request.resource.data.state == 'abandoned'
              && !('completedAt' in request.resource.data)
              && !('completionEvidence' in request.resource.data)));"""
new = """      allow update: if hasValidSessionExecution(userId, executionId)
        && keepsOwnership(userId)
        && resource.data.state == 'in_progress'
        && request.resource.data.date == resource.data.date
        && request.resource.data.startedAt == resource.data.startedAt
        && request.resource.data.sessionSource == resource.data.sessionSource
        && (!('occurrenceId' in resource.data) ? !('occurrenceId' in request.resource.data) : request.resource.data.occurrenceId == resource.data.occurrenceId)
        && (!('prescriptionHash' in resource.data) ? !('prescriptionHash' in request.resource.data) : request.resource.data.prescriptionHash == resource.data.prescriptionHash)
        && (!('fitWorkoutFingerprint' in resource.data) ? !('fitWorkoutFingerprint' in request.resource.data) : request.resource.data.fitWorkoutFingerprint == resource.data.fitWorkoutFingerprint)
        && (!('fitWorkoutFingerprintKind' in resource.data) ? !('fitWorkoutFingerprintKind' in request.resource.data) : request.resource.data.fitWorkoutFingerprintKind == resource.data.fitWorkoutFingerprintKind)
        && (
          // Diary batches retain the existing parent updatedAt touch while the session is live.
          (request.resource.data.state == 'in_progress'
            && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['updatedAt']))
          ||
          // Terminal state is one-way/final: the previous state must be in_progress and only
          // canonical completion/abandon fields may change in the winning request.
          (request.resource.data.state in ['completed', 'abandoned']
            && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['state', 'updatedAt', 'completedAt', 'sessionRpe', 'notes', 'completionEvidence'])
            && ((request.resource.data.state == 'completed'
                  && request.resource.data.completedAt == request.resource.data.updatedAt)
                || (request.resource.data.state == 'abandoned'
                  && !('completedAt' in request.resource.data)
                  && !('completionEvidence' in request.resource.data))))
        );"""
replace_once("app/firestore.rules", old, new)

replace_once(
    "app/src/sessions/validation.ts",
    "                    || evidence.sessionRpe < 0 || evidence.sessionRpe > 10)) {\n                issues.push({ path: 'completionEvidence.sessionRpe', message: 'sessionRpe must be between 0 and 10' });",
    "                    || evidence.sessionRpe < 1 || evidence.sessionRpe > 10)) {\n                issues.push({ path: 'completionEvidence.sessionRpe', message: 'sessionRpe must be between 1 and 10' });",
)
