import type { SessionDefinition, ExecutionPrescription } from '../sessions/models';
import type { PreparedSessionLaunch } from '../sessions/sessionLaunch';
import { validateSessionDefinition } from '../sessions/validation';
import { executionPrescriptionService } from './executionPrescriptionService';
import { sessionOccurrenceService } from './sessionOccurrenceService';
import { hashExecutionPrescription, hashSessionDefinition } from '../sessions/sessionDefinitionHash';
import { getLocalDateString } from '../utils/localDate';

/**
 * Creates the evidence records required before a manually-owned definition may execute.
 * It deliberately grants only `unplanned_log` authority; schedule/replacement/addition
 * require the M3 recommendation/replay work and cannot be approximated here.
 */
export async function prepareUnplannedSessionLaunch(
    userId: string,
    definition: SessionDefinition,
    now = new Date().toISOString(),
): Promise<PreparedSessionLaunch> {
    const validation = validateSessionDefinition(definition);
    if (!validation.ok) {
        throw new Error(validation.issues.map(issue => `${issue.path}: ${issue.message}`).join('\n'));
    }

    const contentHash = await hashSessionDefinition(definition);
    const unsignedPrescription: ExecutionPrescription = {
        schemaVersion: 1,
        prescriptionHash: '',
        definitionHash: contentHash,
        blocks: definition.blocks,
        createdAt: now,
    };
    const prescriptionHash = await hashExecutionPrescription(unsignedPrescription);
    await executionPrescriptionService.savePrescription(userId, {
        ...unsignedPrescription,
        prescriptionHash,
    });

    const occurrenceId = `occ-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await sessionOccurrenceService.saveOccurrence({
        userId,
        occurrenceId,
        date: getLocalDateString(),
        authority: 'unplanned_log',
        state: 'active',
        definitionRef: {
            definitionId: definition.id,
            revision: definition.revision,
            contentHash,
        },
        createdAt: now,
        updatedAt: now,
    });

    return {
        definition,
        binding: {
            sessionSource: {
                kind: 'manual',
                definitionId: definition.id,
                revision: definition.revision,
                contentHash,
            },
            occurrenceId,
            prescriptionHash,
        },
    };
}
