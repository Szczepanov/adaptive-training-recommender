import type { CanonicalWorkoutExport, CanonicalExportBlock, CanonicalExportStep } from '../utils/workoutJsonExport';
import type {
    SessionDefinition,
    SessionBlock,
    SessionStep,
    BlockRole,
    SessionIntent,
    SessionDose,
    SessionLoad,
    SessionEffort,
} from './models';
import { parsePrescriptionDose } from './catalogSessionAdapter';

const VALID_BLOCK_ROLES = new Set<BlockRole>([
    'warmup',
    'main',
    'cooldown',
    'accessory',
    'test',
    'recovery',
]);

export function isCanonicalWorkoutExport(raw: unknown): raw is CanonicalWorkoutExport {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        return false;
    }
    const obj = raw as Record<string, unknown>;
    return obj.schemaVersion === 'canonical_workout_v1'
        && typeof obj.title === 'string'
        && Array.isArray(obj.blocks);
}

function mapBlockRole(role?: string): BlockRole {
    if (!role) return 'main';
    const lower = role.toLowerCase().trim();
    if (VALID_BLOCK_ROLES.has(lower as BlockRole)) {
        return lower as BlockRole;
    }
    if (lower.includes('warm')) return 'warmup';
    if (lower.includes('cool')) return 'cooldown';
    if (lower.includes('recov')) return 'recovery';
    if (lower.includes('access')) return 'accessory';
    if (lower.includes('test')) return 'test';
    return 'main';
}

function mapSessionIntent(category?: string, modality?: string): SessionIntent {
    const cat = category?.toLowerCase().trim();
    const mod = modality?.toLowerCase().trim();

    if (cat === 'recovery' || mod === 'recovery' || mod === 'mobility') {
        return 'recovery';
    }
    if (cat === 'test' || cat === 'testing') {
        return 'testing';
    }
    if (cat === 'competition' || cat === 'event') {
        return 'competition';
    }
    if (cat === 'rehab' || cat === 'rehab_return') {
        return 'rehab_return';
    }
    if (cat === 'skill' || cat === 'skill_technical') {
        return 'skill_technical';
    }
    return 'training';
}

function parseEffortFromText(text: string): SessionEffort | undefined {
    const rpeMatch = text.match(/RPE\s*(\d+(?:\.\d+)?)(?:\s*[-–]\s*(\d+(?:\.\d+)?))?/i);
    if (rpeMatch) {
        const minRpe = parseFloat(rpeMatch[1]);
        const maxRpe = rpeMatch[2] ? parseFloat(rpeMatch[2]) : minRpe;
        return {
            rpe: minRpe === maxRpe ? minRpe : { min: minRpe, max: maxRpe },
        };
    }

    const rirMatch = text.match(/(\d+(?:\.\d+)?)(?:\s*[-–]\s*(\d+(?:\.\d+)?))?\s*(?:RIR|repetitions?\s+in\s+reserve)/i);
    if (rirMatch) {
        const minRir = parseFloat(rirMatch[1]);
        const maxRir = rirMatch[2] ? parseFloat(rirMatch[2]) : minRir;
        return {
            rir: minRir === maxRir ? minRir : { min: minRir, max: maxRir },
        };
    }

    return undefined;
}

function adaptStepDose(step: CanonicalExportStep): SessionDose | undefined {
    // 1. Try explicit dose string or targets for repetition/sets
    if (step.dose) {
        const parsed = parsePrescriptionDose(step.dose);
        if (parsed) return parsed;
    }
    if (step.targets && step.targets.length > 0) {
        for (const target of step.targets) {
            const parsed = parsePrescriptionDose(target);
            if (parsed) return parsed;
        }
    }

    // 2. If explicit sets & repetitions are provided
    if (step.sets !== undefined && step.repetitions !== undefined && step.sets > 0 && step.repetitions > 0) {
        return {
            kind: 'repetition',
            sets: step.sets,
            reps: step.repetitions,
        };
    }
    if (step.repetitions !== undefined && step.repetitions > 0) {
        return {
            kind: 'repetition',
            sets: step.sets && step.sets > 0 ? step.sets : 1,
            reps: step.repetitions,
        };
    }

    // 3. Fallback to duration if specified
    if (step.durationSeconds !== undefined && step.durationSeconds > 0) {
        return {
            kind: 'duration',
            ...(step.sets && step.sets > 0 ? { sets: step.sets } : {}),
            seconds: step.durationSeconds,
        };
    }

    return undefined;
}

function adaptStepLoad(step: CanonicalExportStep): SessionLoad | undefined {
    if (step.weightKg !== undefined && step.weightKg >= 0) {
        return {
            kind: 'mass',
            kg: step.weightKg,
        };
    }
    if (step.weightPercent1Rm !== undefined && step.weightPercent1Rm > 0) {
        return {
            kind: 'percent_one_rm',
            percent: step.weightPercent1Rm,
        };
    }
    return undefined;
}

function adaptStepEffort(step: CanonicalExportStep): SessionEffort | undefined {
    const combinedText = `${step.targets?.join(' ') ?? ''} ${step.dose ?? ''} ${step.notes ?? ''}`;
    const fromText = parseEffortFromText(combinedText);
    if (fromText) return fromText;

    if (step.targetRpe !== undefined && step.targetRpe > 0) {
        return {
            rpe: step.targetRpe,
        };
    }
    return undefined;
}

function isDoseOrEffortOnlyTarget(target: string): boolean {
    const trimmed = target.trim();
    // e.g. "4 x 2 fast repetitions, RPE 5-6" or "RPE 8" or "2 x 3-5 reps"
    return /^(?:(?:\d+\s*(?:sets\s*)?[x×]\s*\d+(?:\s*[-–]\s*\d+)?\s*(?:fast\s*)?(?:reps?|repetitions?)?)|(?:RPE\s*\d+(?:\.\d+)?(?:\s*[-–]\s*(\d+(?:\.\d+)?))?)|(?:(?:\d+)(?:\s*[-–]\s*\d+)?\s*(?:RIR|repetitions?\s+in\s+reserve)))(?:[,\s]+(?:RPE\s*\d+(?:\.\d+)?(?:\s*[-–]\s*(\d+(?:\.\d+)?))?))?$/i.test(trimmed);
}

function adaptStepNotes(step: CanonicalExportStep, parsedDose?: SessionDose, parsedEffort?: SessionEffort): string | undefined {
    const parts: string[] = [];
    if (step.notes?.trim()) {
        parts.push(step.notes.trim());
    }
    if (step.cues && step.cues.length > 0) {
        parts.push(`Cues: ${step.cues.join('; ')}`);
    }
    if (step.targets && step.targets.length > 0) {
        const nonDoseTargets = step.targets.filter(t => {
            if ((parsedDose || parsedEffort) && isDoseOrEffortOnlyTarget(t)) {
                return false;
            }
            return true;
        });
        if (nonDoseTargets.length > 0) {
            parts.push(`Targets: ${nonDoseTargets.join(', ')}`);
        }
    }
    if (step.recoveryTarget?.trim()) {
        parts.push(`Recovery target: ${step.recoveryTarget.trim()}`);
    }
    return parts.length > 0 ? parts.join(' | ') : undefined;
}

function adaptCanonicalStep(step: CanonicalExportStep, sIdx: number, blockId: string, usedStepIds: Set<string>): SessionStep {
    const candidateId = step.id?.trim() || `${blockId}-step-${sIdx + 1}`;
    let stepId = candidateId;
    let counter = 1;
    while (usedStepIds.has(stepId)) {
        stepId = `${candidateId}-${counter++}`;
    }
    usedStepIds.add(stepId);

    const title = step.name?.trim() || `Step ${sIdx + 1}`;
    const exerciseRef = step.exerciseId?.trim()
        ? { kind: 'catalog' as const, exerciseId: step.exerciseId.trim() }
        : { kind: 'unresolved_free_text' as const, name: title };

    const dose = adaptStepDose(step);
    const load = adaptStepLoad(step);
    const effort = adaptStepEffort(step);
    const notes = adaptStepNotes(step, dose, effort);
    const stopConditions = step.stopConditions?.filter(s => typeof s === 'string' && s.trim().length > 0);

    return {
        id: stepId,
        kind: 'exercise',
        title,
        exerciseRef,
        ...(dose ? { dose } : {}),
        ...(load ? { load } : {}),
        ...(effort ? { effort } : {}),
        ...(step.restAfterSec !== undefined && step.restAfterSec >= 0 ? { rest: step.restAfterSec } : {}),
        ...(step.optional ? { optional: true } : {}),
        ...(stopConditions && stopConditions.length > 0 ? { stopConditions } : {}),
        ...(notes ? { notes } : {}),
    };
}

function adaptCanonicalBlock(block: CanonicalExportBlock, bIdx: number, usedBlockIds: Set<string>, usedStepIds: Set<string>): SessionBlock {
    const candidateId = block.id?.trim() || `block-${bIdx + 1}`;
    let blockId = candidateId;
    let counter = 1;
    while (usedBlockIds.has(blockId)) {
        blockId = `${candidateId}-${counter++}`;
    }
    usedBlockIds.add(blockId);

    const steps = (block.steps || []).map((step, sIdx) => adaptCanonicalStep(step, sIdx, blockId, usedStepIds));

    return {
        id: blockId,
        title: block.name?.trim() || `Block ${bIdx + 1}`,
        role: mapBlockRole(block.role),
        executionMode: 'sequential',
        steps,
    };
}

export function adaptCanonicalWorkoutToSessionDefinition(exportData: CanonicalWorkoutExport): SessionDefinition {
    const rawId = exportData.workoutId || exportData.title || 'imported_session';
    const id = rawId.toLowerCase().replace(/[^a-z0-9_-]/g, '_');

    const intent = mapSessionIntent(exportData.category, exportData.modality);
    const usedBlockIds = new Set<string>();
    const usedStepIds = new Set<string>();

    const blocks: SessionBlock[] = (exportData.blocks || []).map((block, bIdx) =>
        adaptCanonicalBlock(block, bIdx, usedBlockIds, usedStepIds),
    );

    // If exported blocks were empty, create a fallback main block
    if (blocks.length === 0) {
        const fallbackStepId = 'main-step-1';
        usedStepIds.add(fallbackStepId);
        blocks.push({
            id: 'block-main',
            title: 'Main',
            role: 'main',
            executionMode: 'sequential',
            steps: [
                {
                    id: fallbackStepId,
                    kind: 'exercise',
                    title: exportData.title || 'Workout',
                    exerciseRef: { kind: 'unresolved_free_text', name: exportData.title || 'Workout' },
                    ...(exportData.summary ? { notes: exportData.summary } : {}),
                },
            ],
        });
    }

    const durationMin = exportData.targetDurationMin;
    const duration = durationMin && durationMin > 0 ? { min: durationMin, max: durationMin } : undefined;

    return {
        schemaVersion: 1,
        id,
        revision: 1,
        title: exportData.title || 'Imported Workout',
        ...(exportData.summary ? { summary: exportData.summary } : {}),
        intent,
        ...(exportData.modality ? { dominantModality: exportData.modality, modalities: [exportData.modality] } : {}),
        ...(duration ? { duration } : {}),
        blocks,
    };
}
