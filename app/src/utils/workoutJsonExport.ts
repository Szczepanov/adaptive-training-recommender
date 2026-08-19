import type { WorkoutPrescription, DisplayTarget, TechnicalRequirements } from '../workouts/models';
import type { ExternalPlanSession } from '../engine/models';
import type { ExternalPlanSessionV2 } from '../sessions/externalPlanV2';
import type { RangeOrNumber, SessionStep } from '../sessions/models';

export interface CanonicalExportStep {
    id?: string;
    name: string;
    exerciseId?: string;
    dose?: string;
    durationSeconds?: number;
    sets?: number;
    repetitions?: number;
    targetRpe?: number;
    weightKg?: number;
    weightPercent1Rm?: number;
    restAfterSec?: number;
    setRecoverySec?: number;
    recoveryTarget?: string;
    targets?: string[];
    structuredTargets?: DisplayTarget[];
    cues?: string[];
    stopConditions?: string[];
    optional?: boolean;
    notes?: string;
}

export interface CanonicalExportBlock {
    id?: string;
    name: string;
    role: string;
    steps: CanonicalExportStep[];
}

export interface CanonicalWorkoutExport {
    schemaVersion: 'canonical_workout_v1';
    title: string;
    workoutId: string;
    modality: string;
    targetDurationMin: number;
    category?: string;
    summary?: string;
    blocks: CanonicalExportBlock[];
    technicalRequirements?: TechnicalRequirements;
    exportedAt: string;
}

function parseDoseToMetrics(dose: string): { durationSeconds?: number; sets?: number; repetitions?: number; rpe?: number } {
    const res: { durationSeconds?: number; sets?: number; repetitions?: number; rpe?: number } = {};
    const minMatch = dose.match(/(\d+(?:\.\d+)?)\s*(?:min|m\b)/i);
    if (minMatch) res.durationSeconds = Math.round(parseFloat(minMatch[1]) * 60);

    const repsMatch = dose.match(/(\d+)\s*(?:reps|r\b)/i);
    if (repsMatch) res.repetitions = parseInt(repsMatch[1], 10);

    const setsRepsMatch = dose.match(/(\d+)\s*[x×]\s*(\d+)/i);
    if (setsRepsMatch) {
        res.sets = parseInt(setsRepsMatch[1], 10);
        res.repetitions = parseInt(setsRepsMatch[2], 10);
    }

    const rpeMatch = dose.match(/RPE\s*(\d+(?:\.\d+)?)/i);
    if (rpeMatch) res.rpe = parseFloat(rpeMatch[1]);

    return res;
}

function parseRestToSeconds(rest: string | undefined): number | undefined {
    if (!rest) return undefined;
    const minMatch = rest.match(/(\d+(?:\.\d+)?)\s*(?:min|m\b)/i);
    if (minMatch) return Math.round(parseFloat(minMatch[1]) * 60);
    const secMatch = rest.match(/(\d+)\s*(?:sec|s\b)/i);
    if (secMatch) return parseInt(secMatch[1], 10);
    return undefined;
}

export function extractRecoverySecondsFromText(text: string, durationSec?: number): number | undefined {
    if (!text) return undefined;
    // 1. "followed by 15 s" / "followed by 15 seconds" / "followed by 2 min"
    const followedMatch = text.match(/followed\s+by\s+(\d+(?:\.\d+)?)\s*(s(?:ec(?:onds?)?)?|m(?:in(?:utes?)?)?)\b/i);
    if (followedMatch) {
        const val = parseFloat(followedMatch[1]);
        const unit = followedMatch[2].toLowerCase();
        return unit.startsWith('m') ? Math.round(val * 60) : Math.round(val);
    }
    // 2. "15 s recovery" / "15s rest" / "15 sec easy" / "2 min recovery" / "3 min rest"
    const restMatch = text.match(/(\d+(?:\.\d+)?)\s*(s(?:ec(?:onds?)?)?|m(?:in(?:utes?)?)?)\s+(?:easy|rest|recovery|off)\b/i);
    if (restMatch) {
        const val = parseFloat(restMatch[1]);
        const unit = restMatch[2].toLowerCase();
        return unit.startsWith('m') ? Math.round(val * 60) : Math.round(val);
    }
    // 3. Ratio syntax like "30/15" or "40/20" or "30s/15s"
    const ratioMatch = text.match(/\b(\d+)\s*(?:s|sec)?\s*\/\s*(\d+)\s*(?:s|sec)?\b/i);
    if (ratioMatch) {
        const onVal = parseInt(ratioMatch[1], 10);
        const offVal = parseInt(ratioMatch[2], 10);
        if (!durationSec || durationSec === onVal) {
            return offVal;
        }
    }
    return undefined;
}

export function extractSetRecoverySecondsFromText(text: string): number | undefined {
    if (!text) return undefined;
    const match = text.match(/(\d+(?:\.\d+)?)\s*(s(?:ec(?:onds?)?)?|m(?:in(?:utes?)?)?)(?:\s+[a-z\s]+)?\s+between\s+sets\b/i);
    if (match) {
        const val = parseFloat(match[1]);
        const unit = match[2].toLowerCase();
        return unit.startsWith('m') ? Math.round(val * 60) : Math.round(val);
    }
    return undefined;
}

export function extractSetsAndRepsFromText(text: string): { sets?: number; repetitions?: number } {
    if (!text) return {};
    const match = text.match(/(\d+)\s+sets\s+of\s+(\d+)/i);
    if (match) {
        return {
            sets: parseInt(match[1], 10),
            repetitions: parseInt(match[2], 10),
        };
    }
    return {};
}

export function resolveSetsAndRepetitions(
    explicitSets: number | undefined,
    explicitRepetitions: number | undefined,
    text: string,
): { sets?: number; repetitions?: number } {
    const inferred = extractSetsAndRepsFromText(text);
    if (!inferred.sets || !inferred.repetitions) {
        return { sets: explicitSets, repetitions: explicitRepetitions };
    }

    if (explicitSets !== undefined && explicitRepetitions !== undefined) {
        return { sets: explicitSets, repetitions: explicitRepetitions };
    }

    if (explicitSets === undefined && explicitRepetitions !== undefined) {
        if (explicitRepetitions === inferred.sets * inferred.repetitions) {
            return { sets: inferred.sets, repetitions: inferred.repetitions };
        }
        if (explicitRepetitions === inferred.repetitions) {
            return { sets: inferred.sets, repetitions: explicitRepetitions };
        }
        return { repetitions: explicitRepetitions };
    }

    if (explicitSets !== undefined && explicitRepetitions === undefined) {
        return explicitSets === inferred.sets
            ? { sets: explicitSets, repetitions: inferred.repetitions }
            : { sets: explicitSets };
    }

    return inferred;
}

export function extractRecoveryTargetFromText(text: string): string | undefined {
    if (!text) return undefined;
    const match = text.match(/followed\s+by\s+\d+\s*(?:s|sec|min|m)?\s+(?:at|below|around|approximately|about)\s+([^.,;]+)/i);
    if (match) {
        return match[1].replace(/^(?:at|below|around|approximately|about)\s+/i, '').trim();
    }
    return undefined;
}

export function exportWorkoutPrescriptionToJson(
    prescription: WorkoutPrescription,
    modality: string = 'cycling',
    category?: string,
): CanonicalWorkoutExport {
    const blocks: CanonicalExportBlock[] = prescription.displayBlocks.map(block => ({
        id: block.id,
        name: block.name,
        role: block.role,
        steps: block.steps.map(step => {
            const parsed = parseDoseToMetrics(step.dose);
            return {
                id: step.id,
                name: step.name,
                dose: step.dose,
                durationSeconds: parsed.durationSeconds,
                sets: parsed.sets,
                repetitions: parsed.repetitions,
                targetRpe: parsed.rpe,
                restAfterSec: parseRestToSeconds(step.rest),
                targets: step.targets,
                structuredTargets: step.structuredTargets,
                cues: step.cues,
                stopConditions: step.stopConditions,
                optional: step.optional,
            };
        }),
    }));

    return {
        schemaVersion: 'canonical_workout_v1',
        title: prescription.workoutId.replaceAll('_', ' '),
        workoutId: prescription.workoutId,
        modality,
        targetDurationMin: prescription.targetDurationMin,
        category,
        blocks,
        exportedAt: new Date().toISOString(),
    };
}

export function exportExternalSessionToJson(
    session: ExternalPlanSession,
): CanonicalWorkoutExport {
    const steps: CanonicalExportStep[] = (session.prescription.steps ?? []).map(step => {
        const durationSec = (step.durationMin ? step.durationMin * 60 : 0) + (step.durationSec ?? 0) || undefined;
        let restSec = (step.recoveryMin ? step.recoveryMin * 60 : 0) + (step.recoverySec ?? 0) || undefined;
        let setRecoverySec = (step.setRecoveryMin ? step.setRecoveryMin * 60 : 0) + (step.setRecoverySec ?? 0) || undefined;
        let sets = step.sets;
        let repetitions = step.repeat;

        const isWarmup = /warm-?up/i.test(step.name);
        const isCooldown = /cool-?down/i.test(step.name);

        const stepText = `${step.notes ?? ''} ${step.name}`;
        const sessionText = `${stepText} ${session.title} ${session.prescription.summary}`;

        if (!isWarmup && !isCooldown) {
            // Infer sets & repetitions if missing or if repeat was flattened
            ({ sets, repetitions } = resolveSetsAndRepetitions(sets, repetitions, stepText));

            // Infer recovery seconds if missing
            if (!restSec && (repetitions || sets || /interval|vo2|surge|repeat/i.test(step.name) || /30\/15|40\/20/i.test(sessionText))) {
                restSec = extractRecoverySecondsFromText(sessionText, durationSec);
            }

            // Infer set recovery seconds if missing
            if (!setRecoverySec && (sets || /between\s+sets/i.test(sessionText))) {
                setRecoverySec = extractSetRecoverySecondsFromText(sessionText);
            }
        }

        const recoveryTarget = extractRecoveryTargetFromText(step.notes ?? '');

        return {
            name: step.name,
            durationSeconds: durationSec,
            sets,
            repetitions,
            targets: step.target ? [step.target] : undefined,
            restAfterSec: restSec,
            setRecoverySec,
            recoveryTarget,
            notes: step.notes,
        };
    });

    const blocks: CanonicalExportBlock[] = [
        {
            id: 'main-block',
            name: 'Workout Steps',
            role: 'main',
            steps: steps.length > 0 ? steps : [{
                name: session.title,
                durationSeconds: (session.gating.durationMin || 60) * 60,
                notes: session.prescription.summary,
            }],
        },
    ];

    return {
        schemaVersion: 'canonical_workout_v1',
        title: session.title,
        workoutId: session.id,
        modality: session.gating.modality,
        targetDurationMin: session.gating.durationMin,
        summary: session.prescription.summary,
        blocks,
        exportedAt: new Date().toISOString(),
    };
}

function rangeMidpoint(value: RangeOrNumber | undefined): number | undefined {
    if (value === undefined) return undefined;
    return typeof value === 'number' ? value : Math.round((value.min + value.max) / 2);
}

function stepDisplayName(step: SessionStep): string {
    if (step.title) return step.title;
    if (step.exerciseRef?.kind === 'unresolved_free_text') return step.exerciseRef.name;
    if (step.exerciseRef?.kind === 'catalog') return step.exerciseRef.exerciseId;
    return 'Step';
}

/**
 * v2 counterpart of `exportExternalSessionToJson`. Genuinely simpler: a v2 session's
 * content is already structured (`dose`/`effort`/`rest`), so this needs none of v1's
 * free-text parsing (`parseDoseToMetrics`, `extractRecoverySecondsFromText`, ...) -- it's a
 * direct field mapping, the same way `exportWorkoutPrescriptionToJson` maps a catalog
 * prescription's already-structured `displayBlocks` (M3.6).
 */
export function exportExternalSessionV2ToJson(session: ExternalPlanSessionV2): CanonicalWorkoutExport {
    const blocks: CanonicalExportBlock[] = session.definition.blocks.map(block => ({
        id: block.id,
        name: block.title ?? block.role,
        role: block.role,
        steps: block.steps.map((step): CanonicalExportStep => {
            const durationSeconds = step.dose?.kind === 'duration' ? rangeMidpoint(step.dose.seconds) : undefined;
            return {
                id: step.id,
                name: stepDisplayName(step),
                exerciseId: step.exerciseRef?.kind === 'catalog' ? step.exerciseRef.exerciseId : undefined,
                durationSeconds,
                sets: step.dose && 'sets' in step.dose ? step.dose.sets : undefined,
                repetitions: step.dose?.kind === 'repetition' ? rangeMidpoint(step.dose.reps) : undefined,
                targetRpe: step.effort?.rpe !== undefined ? rangeMidpoint(step.effort.rpe) : undefined,
                restAfterSec: rangeMidpoint(step.rest),
                stopConditions: step.stopConditions,
                optional: step.optional,
                notes: step.notes,
            };
        }),
    }));

    return {
        schemaVersion: 'canonical_workout_v1',
        title: session.title,
        workoutId: session.id,
        modality: session.gating.modality,
        targetDurationMin: session.gating.durationMin,
        summary: session.definition.summary ?? session.definition.title,
        blocks,
        exportedAt: new Date().toISOString(),
    };
}

export function downloadJsonFile(filename: string, data: unknown): void {
    const jsonStr = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename.endsWith('.json') ? filename : `${filename}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

export async function copyJsonToClipboard(data: unknown): Promise<void> {
    const jsonStr = JSON.stringify(data, null, 2);
    await navigator.clipboard.writeText(jsonStr);
}
