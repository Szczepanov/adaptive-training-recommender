import type { WorkoutPrescription, DisplayTarget, TechnicalRequirements } from '../workouts/models';
import type { ExternalPlanSession } from '../engine/models';

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
    const steps: CanonicalExportStep[] = (session.prescription.steps ?? []).map(step => ({
        name: step.name,
        durationSeconds: (step.durationMin ? step.durationMin * 60 : 0) + (step.durationSec ?? 0) || undefined,
        sets: step.sets,
        repetitions: step.repeat,
        targets: step.target ? [step.target] : undefined,
        restAfterSec: (step.recoveryMin ? step.recoveryMin * 60 : 0) + (step.recoverySec ?? 0)
            || (step.setRecoveryMin ? step.setRecoveryMin * 60 : 0) + (step.setRecoverySec ?? 0)
            || undefined,
        notes: step.notes,
    }));

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
