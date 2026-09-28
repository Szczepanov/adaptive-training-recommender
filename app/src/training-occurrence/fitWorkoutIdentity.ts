import type { FitWorkoutFingerprintKind } from '../engine/models';
import type { CanonicalWorkoutExport, CanonicalExportBlock, CanonicalExportStep } from '../utils/workoutJsonExport';

export const FIT_WORKOUT_FINGERPRINT_VERSION = 'fit-workout-v2';

export type { FitWorkoutFingerprintKind };

export interface FitWorkoutIdentity {
    fingerprint: string;
    kind: FitWorkoutFingerprintKind;
}

export interface FitWorkoutStepEvidence {
    messageIndex?: number | null;
    name?: string | null;
    durationType?: string | number | null;
    durationValue?: number | null;
    targetType?: string | number | null;
    targetValue?: number | null;
    customTargetValueLow?: number | null;
    customTargetValueHigh?: number | null;
    intensity?: string | number | null;
    equipment?: string | number | null;
}

export function normalizeText(value?: string | null): string {
    return value ? value.trim().split(/\s+/).filter(Boolean).join(' ').toLowerCase() : '';
}

export function normalizeIdentifier(value?: string | number | null): string | number | null {
    if (typeof value === 'string') {
        const normalized = normalizeText(value);
        return normalized || null;
    }
    return value ?? null;
}

export function normalizeNumber(value?: number | null): number | null {
    if (value === null || value === undefined || !Number.isFinite(value)) {
        return null;
    }
    return Number.isInteger(value) ? Math.trunc(value) : value;
}

export function normalizeStep(step: FitWorkoutStepEvidence): Record<string, unknown> {
    return {
        messageIndex: step.messageIndex ?? null,
        name: normalizeText(step.name) || null,
        durationType: normalizeIdentifier(step.durationType),
        durationValue: normalizeNumber(step.durationValue),
        targetType: normalizeIdentifier(step.targetType),
        targetValue: normalizeNumber(step.targetValue),
        customTargetValueLow: normalizeNumber(step.customTargetValueLow),
        customTargetValueHigh: normalizeNumber(step.customTargetValueHigh),
        intensity: normalizeIdentifier(step.intensity),
        equipment: normalizeIdentifier(step.equipment),
    };
}

export function canonicalSerializeFitWorkoutPayload(value: unknown): string {
    if (value === null || typeof value !== 'object') {
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
        return '[' + value.map(canonicalSerializeFitWorkoutPayload).join(',') + ']';
    }
    const obj = value as Record<string, unknown>;
    const sortedKeys = Object.keys(obj).sort();
    const parts = sortedKeys.map(k => JSON.stringify(k) + ':' + canonicalSerializeFitWorkoutPayload(obj[k]));
    return '{' + parts.join(',') + '}';
}

async function sha256HexFirst32(input: string): Promise<string> {
    const buffer = new TextEncoder().encode(input);
    const digest = await crypto.subtle.digest('SHA-256', buffer);
    return Array.from(new Uint8Array(digest))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('')
        .slice(0, 32);
}

export async function computeFitWorkoutIdentity(
    workoutName?: string | null,
    workoutStepIndices?: readonly number[],
    workoutSteps: readonly FitWorkoutStepEvidence[] = [],
): Promise<FitWorkoutIdentity | null> {
    const normalizedName = normalizeText(workoutName);

    let payload: Record<string, unknown>;
    let kind: FitWorkoutFingerprintKind;

    if (workoutSteps && workoutSteps.length > 0) {
        const indexedSteps = workoutSteps.map((step, idx) => ({ step, originalIndex: idx }));
        indexedSteps.sort((a, b) => {
            const aMsgIdx = a.step.messageIndex;
            const bMsgIdx = b.step.messageIndex;
            const aHasNull = aMsgIdx === null || aMsgIdx === undefined;
            const bHasNull = bMsgIdx === null || bMsgIdx === undefined;
            if (aHasNull !== bHasNull) return aHasNull ? 1 : -1;
            const aVal = aMsgIdx ?? a.originalIndex;
            const bVal = bMsgIdx ?? b.originalIndex;
            if (aVal !== bVal) return aVal - bVal;
            return a.originalIndex - b.originalIndex;
        });

        const normalizedSteps = indexedSteps.map(({ step }) => normalizeStep(step));
        payload = {
            name: normalizedName || null,
            steps: normalizedSteps,
        };
        kind = 'semantic_definition';
    } else {
        const observed = Array.from(new Set(workoutStepIndices ?? [])).sort((a, b) => a - b);
        if (!normalizedName && observed.length === 0) {
            return null;
        }
        payload = {
            name: normalizedName || null,
            observedStepIndices: observed,
        };
        kind = 'index_fallback';
    }

    const serialized = canonicalSerializeFitWorkoutPayload(payload);
    const digest = await sha256HexFirst32(serialized);
    return {
        fingerprint: `${FIT_WORKOUT_FINGERPRINT_VERSION}:${digest}`,
        kind,
    };
}

export async function computeFitWorkoutFingerprint(
    workoutName?: string | null,
    workoutStepIndices?: readonly number[],
    workoutSteps: readonly FitWorkoutStepEvidence[] = [],
): Promise<string | null> {
    const identity = await computeFitWorkoutIdentity(workoutName, workoutStepIndices, workoutSteps);
    return identity ? identity.fingerprint : null;
}

// ---------------------------------------------------------------------------
// CanonicalWorkoutExport -> Garmin payload -> FitWorkoutStepEvidence
// ---------------------------------------------------------------------------

const SPORT_TYPE_MAP: Record<string, { sportTypeId: number; sportTypeKey: string }> = {
    cycling: { sportTypeId: 2, sportTypeKey: 'cycling' },
    bike: { sportTypeId: 2, sportTypeKey: 'cycling' },
    running: { sportTypeId: 1, sportTypeKey: 'running' },
    run: { sportTypeId: 1, sportTypeKey: 'running' },
    strength: { sportTypeId: 5, sportTypeKey: 'strength_training' },
    mobility: { sportTypeId: 11, sportTypeKey: 'mobility' },
    cross_training: { sportTypeId: 3, sportTypeKey: 'other' },
};

const STEP_TYPE_MAP: Record<string, { stepTypeId: number; stepTypeKey: string }> = {
    warmup: { stepTypeId: 1, stepTypeKey: 'warmup' },
    cooldown: { stepTypeId: 2, stepTypeKey: 'cooldown' },
    interval: { stepTypeId: 3, stepTypeKey: 'interval' },
    recovery: { stepTypeId: 4, stepTypeKey: 'recovery' },
    rest: { stepTypeId: 5, stepTypeKey: 'rest' },
};

const END_CONDITION_MAP: Record<string, { conditionTypeId: number; conditionTypeKey: string }> = {
    time: { conditionTypeId: 2, conditionTypeKey: 'time' },
    distance: { conditionTypeId: 3, conditionTypeKey: 'distance' },
    reps: { conditionTypeId: 10, conditionTypeKey: 'reps' },
    lap_button: { conditionTypeId: 1, conditionTypeKey: 'lap.button' },
};

function extractPowerTarget(
    targets?: string[] | null,
    ftpWatts?: number | null,
): [number, number] | null {
    if (!targets || targets.length === 0) return null;
    for (const t of targets) {
        if (typeof t !== 'string') continue;
        // 1. Exact Watts range (e.g., '230-240 W', '140–175 W')
        const rangeMatch = t.match(/(\d+(?:\.\d+)?)\s*[-–—]\s*(\d+(?:\.\d+)?)\s*W\b/i);
        if (rangeMatch) {
            return [parseFloat(rangeMatch[1]), parseFloat(rangeMatch[2])];
        }
        const singleMatch = t.match(/(\d+(?:\.\d+)?)\s*W\b/i);
        if (singleMatch) {
            const w = parseFloat(singleMatch[1]);
            return [w, w];
        }

        // 2. % FTP range derived with known athlete FTP
        if (ftpWatts && ftpWatts > 0) {
            const ftpRange = t.match(/(\d+(?:\.\d+)?)\s*[-–—]\s*(\d+(?:\.\d+)?)\s*%\s*(?:FTP)?/i);
            if (ftpRange) {
                const p1 = parseFloat(ftpRange[1]) / 100.0;
                const p2 = parseFloat(ftpRange[2]) / 100.0;
                return [Math.round(ftpWatts * p1 * 10) / 10, Math.round(ftpWatts * p2 * 10) / 10];
            }
            const singleFtp = t.match(/(\d+(?:\.\d+)?)\s*%\s*FTP\b/i);
            if (singleFtp) {
                const p = parseFloat(singleFtp[1]) / 100.0;
                const val = Math.round(ftpWatts * p * 10) / 10;
                return [val, val];
            }
        }
    }
    return null;
}

function extractZoneTarget(targets?: string[] | null): number | null {
    if (!targets || targets.length === 0) return null;
    for (const t of targets) {
        if (typeof t !== 'string') continue;
        // 1. Explicit Zone syntax
        const zoneMatch = t.match(/\b(?:zone|z)\s*[-–—]?\s*([1-7])\b/i);
        if (zoneMatch) {
            return parseInt(zoneMatch[1], 10);
        }

        // 2. Named Coggan power training levels
        const tl = t.toLowerCase();
        if (/\bactive recovery\b/.test(tl)) return 1;
        if (/\bendurance\b/.test(tl)) return 2;
        if (/\btempo\b/.test(tl)) return 3;
        if (/\bthreshold\b|\bsweet\s*spot\b/.test(tl)) return 4;
        if (/\bvo2\s*(?:max)?\b/.test(tl)) return 5;
        if (/\banaerobic(?:\s*capacity)?\b/.test(tl)) return 6;
        if (/\bneuromuscular\b|\bsprint\b/.test(tl)) return 7;

        // 3. % FTP mapped to Coggan 7-zone system if no FTP was supplied
        const pctMatch = t.match(/(\d+(?:\.\d+)?)\s*(?:[-–—]\s*(\d+(?:\.\d+)?))?\s*%\s*(?:FTP)?/i);
        if (pctMatch) {
            const v1 = parseFloat(pctMatch[1]);
            const v2 = pctMatch[2] ? parseFloat(pctMatch[2]) : v1;
            const avgPct = (v1 + v2) / 2.0;
            if (avgPct <= 55.0) return 1;
            if (avgPct <= 75.0) return 2;
            if (avgPct <= 90.0) return 3;
            if (avgPct <= 105.0) return 4;
            if (avgPct <= 120.0) return 5;
            if (avgPct <= 150.0) return 6;
            return 7;
        }
    }
    return null;
}

function extractRecoverySeconds(step: CanonicalExportStep): number | null {
    const text = `${step.notes ?? ''} ${step.name ?? ''}`;
    if (!text.trim()) return null;
    const m = text.match(/followed\s+by\s+(\d+(?:\.\d+)?)\s*(s(?:ec(?:onds?)?)?|m(?:in(?:utes?)?)?)\b/i);
    if (m) {
        const val = parseFloat(m[1]);
        const unit = m[2].toLowerCase();
        return unit.startsWith('m') ? Math.round(val * 60) : Math.round(val);
    }
    const m2 = text.match(/(\d+(?:\.\d+)?)\s*(s(?:ec(?:onds?)?)?|m(?:in(?:utes?)?)?)\s+(?:easy|rest|recovery|off)\b/i);
    if (m2) {
        const val = parseFloat(m2[1]);
        const unit = m2[2].toLowerCase();
        return unit.startsWith('m') ? Math.round(val * 60) : Math.round(val);
    }
    const m3 = text.match(/\b(\d+)\s*(?:s|sec)?\s*\/\s*(\d+)\s*(?:s|sec)?\b/i);
    if (m3) {
        const onVal = parseInt(m3[1], 10);
        const offVal = parseInt(m3[2], 10);
        const dur = step.durationSeconds;
        if (!dur || dur === onVal) {
            return offVal;
        }
    }
    return null;
}

function extractSetRecoverySeconds(step: CanonicalExportStep): number | null {
    const text = `${step.notes ?? ''}`;
    if (!text.trim()) return null;
    const m = text.match(/(\d+(?:\.\d+)?)\s*(s(?:ec(?:onds?)?)?|m(?:in(?:utes?)?)?)(?:\s+(?:easy|rest|recovery|riding))?\s+between\s+sets\b/i);
    if (m) {
        const val = parseFloat(m[1]);
        const unit = m[2].toLowerCase();
        return unit.startsWith('m') ? Math.round(val * 60) : Math.round(val);
    }
    return null;
}

function resolveStrengthRestSeconds(step: CanonicalExportStep): number | null {
    if (step.setRecoverySec && step.setRecoverySec > 0) return step.setRecoverySec;
    if (step.restAfterSec && step.restAfterSec > 0) return step.restAfterSec;
    return null;
}

function getStrengthStepDesc(step: CanonicalExportStep, stepName: string): string | null {
    const descParts = stepName ? [stepName] : [];
    if (step.targets && step.targets.length > 0) {
        descParts.push(`(${step.targets.join('; ')})`);
    }
    return descParts.length > 0 ? descParts.join(' ') : null;
}

function getStrengthStepType(stepNameLower: string, defaultStepType: { stepTypeId: number; stepTypeKey: string }): { stepTypeId: number; stepTypeKey: string } {
    if (stepNameLower.includes('warm')) return STEP_TYPE_MAP.warmup;
    if (stepNameLower.includes('cool')) return STEP_TYPE_MAP.cooldown;
    return defaultStepType;
}

function getStrengthEndCondition(reps?: number, durationSec?: number): [{ conditionTypeId: number; conditionTypeKey: string }, number | null] {
    if (reps && reps > 0) {
        return [END_CONDITION_MAP.reps, reps];
    }
    if (durationSec && durationSec > 0) {
        return [END_CONDITION_MAP.time, durationSec];
    }
    return [END_CONDITION_MAP.lap_button, null];
}

interface GarminStepDTO {
    type: 'ExecutableStepDTO' | 'RepeatGroupDTO';
    stepId: null;
    stepOrder: number;
    stepType: { stepTypeId: number; stepTypeKey: string };
    childStepId?: number | null;
    description?: string | null;
    endCondition?: { conditionTypeId: number; conditionTypeKey: string };
    endConditionValue?: number | null;
    targetType?: { workoutTargetTypeId: number; workoutTargetTypeKey: string };
    targetValueOne?: number | null;
    targetValueTwo?: number | null;
    zoneNumber?: number | null;
    numberOfIterations?: number;
    smartRepeat?: boolean;
    workoutSteps?: GarminStepDTO[];
}

function buildStrengthStepOrGroup(
    step: CanonicalExportStep,
    stepOrder: number,
    defaultStepType: { stepTypeId: number; stepTypeKey: string },
): [GarminStepDTO, number] {
    const sets = step.sets;
    const reps = step.repetitions;
    const durationSec = step.durationSeconds;
    const stepName = String(step.name || '').trim();
    const stepNameLower = stepName.toLowerCase();

    const stepDesc = getStrengthStepDesc(step, stepName);
    const stepType = getStrengthStepType(stepNameLower, defaultStepType);
    const [endCondition, endConditionValue] = getStrengthEndCondition(reps, durationSec);

    const exerciseDto: GarminStepDTO = {
        type: 'ExecutableStepDTO',
        stepId: null,
        stepOrder: 1,
        stepType,
        childStepId: null,
        description: stepDesc,
        endCondition,
        endConditionValue,
        targetType: { workoutTargetTypeId: 1, workoutTargetTypeKey: 'no.target' },
        targetValueOne: null,
        targetValueTwo: null,
        zoneNumber: null,
    };

    if (sets && sets > 1 && reps && reps > 0) {
        const restSec = resolveStrengthRestSeconds(step);
        const childSteps: GarminStepDTO[] = [exerciseDto];
        if (restSec) {
            childSteps.push({
                type: 'ExecutableStepDTO',
                stepId: null,
                stepOrder: 2,
                stepType: STEP_TYPE_MAP.recovery,
                childStepId: null,
                description: 'Set recovery',
                endCondition: END_CONDITION_MAP.time,
                endConditionValue: restSec,
                targetType: { workoutTargetTypeId: 1, workoutTargetTypeKey: 'no.target' },
                targetValueOne: null,
                targetValueTwo: null,
                zoneNumber: null,
            });
        }
        const garminStep: GarminStepDTO = {
            type: 'RepeatGroupDTO',
            stepId: null,
            stepOrder,
            stepType: { stepTypeId: 6, stepTypeKey: 'repeat' },
            childStepId: 1,
            numberOfIterations: sets,
            smartRepeat: false,
            workoutSteps: childSteps,
        };
        return [garminStep, stepOrder + 1];
    } else {
        exerciseDto.stepOrder = stepOrder;
        return [exerciseDto, stepOrder + 1];
    }
}

function determineStepType(stepName: string, defaultStepType: { stepTypeId: number; stepTypeKey: string }): { stepTypeId: number; stepTypeKey: string } {
    const lower = stepName.toLowerCase();
    if (lower.includes('warm')) return STEP_TYPE_MAP.warmup;
    if (lower.includes('cool')) return STEP_TYPE_MAP.cooldown;
    if (lower.includes('rest') || lower.includes('recovery')) return STEP_TYPE_MAP.recovery;
    return defaultStepType;
}

function compileTargetSources(step: CanonicalExportStep): string[] {
    const targetSources: string[] = [];
    if (step.targets && Array.isArray(step.targets)) {
        for (const t of step.targets) {
            if (typeof t === 'string' && t.trim()) targetSources.push(t);
        }
    }
    for (const key of ['notes', 'name'] as const) {
        const val = step[key];
        if (typeof val === 'string' && val.trim() && !targetSources.includes(val)) {
            targetSources.push(val);
        }
    }
    return targetSources;
}

function buildStepDescription(stepName: string, targets?: string[] | null): string | null {
    const descParts = stepName ? [stepName] : [];
    if (targets && Array.isArray(targets) && targets.length > 0) {
        descParts.push(`(${targets.join('; ')})`);
    }
    return descParts.length > 0 ? descParts.join(' ') : null;
}

function resolveTargetValues(
    modality: string,
    powerTarget: [number, number] | null,
    zoneTarget: number | null,
): [{ workoutTargetTypeId: number; workoutTargetTypeKey: string }, number | null, number | null, number | null] {
    if (modality === 'cycling' || modality === 'bike') {
        if (powerTarget) {
            return [{ workoutTargetTypeId: 2, workoutTargetTypeKey: 'power.zone' }, powerTarget[0], powerTarget[1], null];
        } else if (zoneTarget) {
            return [{ workoutTargetTypeId: 2, workoutTargetTypeKey: 'power.zone' }, null, null, zoneTarget];
        }
    }
    return [{ workoutTargetTypeId: 1, workoutTargetTypeKey: 'no.target' }, null, null, null];
}

function resolveEndCondition(
    modality: string,
    reps: number | undefined,
    durationSec: number,
): [{ conditionTypeId: number; conditionTypeKey: string }, number] {
    if (reps && modality === 'strength') {
        return [END_CONDITION_MAP.reps, reps];
    }
    return [END_CONDITION_MAP.time, durationSec];
}

function buildRestDto(
    step: CanonicalExportStep,
    stepOrder: number,
    modality: string,
    ftp?: number | null,
): GarminStepDTO | null {
    let restSec = step.restAfterSec;
    if (!restSec) {
        restSec = extractRecoverySeconds(step) ?? undefined;
    }
    if (!restSec || restSec <= 0) return null;

    const recTargetStr = step.recoveryTarget;
    const recSources: string[] = [];
    if (recTargetStr) recSources.push(recTargetStr);

    const stepNotes = String(step.notes ?? '');
    const recMatch = stepNotes.match(/(?:followed\s+by|with)\s+[^.,;]*\s+(?:at|around|approximately|about)\s+([^.,;]+)/i);
    if (recMatch) {
        recSources.push(recMatch[1].trim());
    } else if (stepNotes) {
        recSources.push(stepNotes);
    }

    const recPower = recSources.length > 0 ? extractPowerTarget(recSources, ftp) : null;
    const recZone = recSources.length > 0 && !recPower ? extractZoneTarget(recSources) : null;
    const [recTargetType, recValOne, recValTwo, recZoneNum] = resolveTargetValues(modality, recPower, recZone);

    return {
        type: 'ExecutableStepDTO',
        stepId: null,
        stepOrder,
        stepType: STEP_TYPE_MAP.recovery,
        childStepId: null,
        description: recTargetStr ? `Rest interval (${recTargetStr})` : 'Rest interval',
        endCondition: END_CONDITION_MAP.time,
        endConditionValue: restSec,
        targetType: recTargetType,
        targetValueOne: recValOne,
        targetValueTwo: recValTwo,
        zoneNumber: recZoneNum,
    };
}

function buildStepDto(
    step: CanonicalExportStep,
    stepOrder: number,
    defaultStepType: { stepTypeId: number; stepTypeKey: string },
    modality: string,
    ftp?: number | null,
): [GarminStepDTO, GarminStepDTO | null] {
    const durationSec = step.durationSeconds || 300;
    const reps = step.repetitions;
    const stepName = String(step.name ?? '').trim();
    const stepType = determineStepType(stepName, defaultStepType);
    const targetSources = compileTargetSources(step);
    const stepDesc = buildStepDescription(stepName, step.targets);

    const powerTarget = extractPowerTarget(targetSources, ftp);
    const zoneTarget = !powerTarget ? extractZoneTarget(targetSources) : null;
    const [targetType, targetValOne, targetValTwo, zoneNum] = resolveTargetValues(modality, powerTarget, zoneTarget);
    const [endCondition, endConditionValue] = resolveEndCondition(modality, reps, durationSec);

    const mainDto: GarminStepDTO = {
        type: 'ExecutableStepDTO',
        stepId: null,
        stepOrder,
        stepType,
        childStepId: null,
        description: stepDesc,
        endCondition,
        endConditionValue,
        targetType,
        targetValueOne: targetValOne,
        targetValueTwo: targetValTwo,
        zoneNumber: zoneNum,
    };

    const restDto = buildRestDto(step, stepOrder + 1, modality, ftp);
    return [mainDto, restDto];
}

function buildBlockRepeatGroup(
    block: CanonicalExportBlock,
    defaultStepType: { stepTypeId: number; stepTypeKey: string },
    modality: string,
    ftp: number | null | undefined,
    stepOrder: number,
): GarminStepDTO {
    const blockSteps = block.steps || [];
    const blockReps = (block as unknown as { repetitions?: number; sets?: number }).repetitions ?? (block as unknown as { sets?: number }).sets ?? 1;
    const childSteps: GarminStepDTO[] = [];
    let childOrder = 1;

    for (const step of blockSteps) {
        const [mainDto, restDto] = buildStepDto(step, childOrder, defaultStepType, modality, ftp);
        mainDto.stepOrder = childOrder;
        childSteps.push(mainDto);
        childOrder += 1;
        if (restDto) {
            restDto.stepOrder = childOrder;
            childSteps.push(restDto);
            childOrder += 1;
        }
    }

    const blockRestSec = (block as unknown as { restAfterSec?: number }).restAfterSec;
    if (blockRestSec && blockRestSec > 0) {
        childSteps.push({
            type: 'ExecutableStepDTO',
            stepId: null,
            stepOrder: childOrder,
            stepType: STEP_TYPE_MAP.recovery,
            childStepId: null,
            description: 'Block recovery',
            endCondition: END_CONDITION_MAP.time,
            endConditionValue: blockRestSec,
            targetType: { workoutTargetTypeId: 1, workoutTargetTypeKey: 'no.target' },
            targetValueOne: null,
            targetValueTwo: null,
            zoneNumber: null,
        });
    }

    return {
        type: 'RepeatGroupDTO',
        stepId: null,
        stepOrder,
        stepType: { stepTypeId: 6, stepTypeKey: 'repeat' },
        childStepId: 1,
        numberOfIterations: blockReps,
        smartRepeat: false,
        workoutSteps: childSteps,
    };
}

function processBlockStep(
    step: CanonicalExportStep,
    stepOrder: number,
    defaultStepType: { stepTypeId: number; stepTypeKey: string },
    modality: string,
    ftp: number | null | undefined,
    workoutSteps: GarminStepDTO[],
): number {
    if (modality === 'strength') {
        const [garminStep, nextOrder] = buildStrengthStepOrGroup(step, stepOrder, defaultStepType);
        workoutSteps.push(garminStep);
        return nextOrder;
    }

    const sets = step.sets;
    const reps = step.repetitions;
    let setRecoverySec = step.setRecoverySec;
    if (!setRecoverySec && (sets || /between\s+sets/i.test(String(step.notes ?? '')))) {
        setRecoverySec = extractSetRecoverySeconds(step) ?? undefined;
    }

    // Case A: Multi-set intervals
    if (sets && sets > 1 && reps && reps > 1) {
        let currentOrder = stepOrder;
        for (let s = 1; s <= sets; s++) {
            const [mainDto, restDto] = buildStepDto(step, 1, defaultStepType, modality, ftp);
            const repeatChildSteps: GarminStepDTO[] = [mainDto];
            if (restDto) {
                restDto.stepOrder = 2;
                repeatChildSteps.push(restDto);
            }
            workoutSteps.push({
                type: 'RepeatGroupDTO',
                stepId: null,
                stepOrder: currentOrder,
                stepType: { stepTypeId: 6, stepTypeKey: 'repeat' },
                childStepId: 1,
                numberOfIterations: reps,
                smartRepeat: false,
                workoutSteps: repeatChildSteps,
            });
            currentOrder += 1;

            if (s < sets && setRecoverySec && setRecoverySec > 0) {
                workoutSteps.push({
                    type: 'ExecutableStepDTO',
                    stepId: null,
                    stepOrder: currentOrder,
                    stepType: STEP_TYPE_MAP.recovery,
                    childStepId: null,
                    description: 'Set recovery',
                    endCondition: END_CONDITION_MAP.time,
                    endConditionValue: setRecoverySec,
                    targetType: { workoutTargetTypeId: 1, workoutTargetTypeKey: 'no.target' },
                    targetValueOne: null,
                    targetValueTwo: null,
                    zoneNumber: null,
                });
                currentOrder += 1;
            }
        }
        return currentOrder;
    }

    // Case B: Single-set repeat (repetitions > 1 or sets > 1)
    if ((reps && reps > 1) || (sets && sets > 1)) {
        const iterationCount = reps && reps > 1 ? reps : sets!;
        const [mainDto, restDto] = buildStepDto(step, 1, defaultStepType, modality, ftp);
        const repeatChildSteps: GarminStepDTO[] = [mainDto];
        if (restDto) {
            restDto.stepOrder = 2;
            repeatChildSteps.push(restDto);
        }
        workoutSteps.push({
            type: 'RepeatGroupDTO',
            stepId: null,
            stepOrder,
            stepType: { stepTypeId: 6, stepTypeKey: 'repeat' },
            childStepId: 1,
            numberOfIterations: iterationCount,
            smartRepeat: false,
            workoutSteps: repeatChildSteps,
        });
        return stepOrder + 1;
    }

    // Case C: Sequential execution
    const [mainDto, restDto] = buildStepDto(step, stepOrder, defaultStepType, modality, ftp);
    workoutSteps.push(mainDto);
    let nextOrder = stepOrder + 1;
    if (restDto) {
        restDto.stepOrder = nextOrder;
        workoutSteps.push(restDto);
        nextOrder += 1;
    }
    return nextOrder;
}

export function canonicalWorkoutToGarminPayload(
    workout: CanonicalWorkoutExport,
    athleteFtp?: number | null,
): { workoutName: string; sportType: { sportTypeId: number; sportTypeKey: string }; workoutSegments: [{ segmentOrder: number; sportType: { sportTypeId: number; sportTypeKey: string }; workoutSteps: GarminStepDTO[] }] } {
    const modality = String(workout.modality || 'cycling').toLowerCase();
    const sport = SPORT_TYPE_MAP[modality] || SPORT_TYPE_MAP.cycling;
    const title = String(workout.title || 'Adaptive Workout');
    const blocks = workout.blocks || [];
    const ftp = athleteFtp ?? (workout as unknown as { athleteFtpWatts?: number }).athleteFtpWatts;

    const workoutSteps: GarminStepDTO[] = [];
    let stepOrder = 1;

    for (const block of blocks) {
        const blockRole = String(block.role || 'main').toLowerCase();
        const blockReps = (block as unknown as { repetitions?: number; sets?: number }).repetitions ?? (block as unknown as { sets?: number }).sets;
        const blockSteps = block.steps || [];
        const defaultStepType = blockRole === 'warmup'
            ? STEP_TYPE_MAP.warmup
            : blockRole === 'cooldown'
            ? STEP_TYPE_MAP.cooldown
            : STEP_TYPE_MAP.interval;

        if (blockReps && blockReps > 1 && modality !== 'strength' && blockSteps.length > 1) {
            const repeatGroup = buildBlockRepeatGroup(block, defaultStepType, modality, ftp, stepOrder);
            workoutSteps.push(repeatGroup);
            stepOrder += 1;
        } else {
            for (const step of blockSteps) {
                stepOrder = processBlockStep(step, stepOrder, defaultStepType, modality, ftp, workoutSteps);
            }
        }
    }

    if (workoutSteps.length === 0) {
        workoutSteps.push({
            type: 'ExecutableStepDTO',
            stepId: null,
            stepOrder: 1,
            stepType: STEP_TYPE_MAP.interval,
            childStepId: null,
            description: title,
            endCondition: END_CONDITION_MAP.time,
            endConditionValue: (workout.targetDurationMin || 60) * 60,
            targetType: { workoutTargetTypeId: 1, workoutTargetTypeKey: 'no.target' },
        });
    }

    return {
        workoutName: title,
        sportType: sport,
        workoutSegments: [
            {
                segmentOrder: 1,
                sportType: sport,
                workoutSteps,
            },
        ],
    };
}

export function garminPayloadToFitSteps(
    payload: { sportType?: { sportTypeKey?: string }; workoutSegments?: Array<{ workoutSteps?: GarminStepDTO[] }> },
): FitWorkoutStepEvidence[] {
    const sportKey = payload.sportType?.sportTypeKey;
    const equipment = sportKey === 'cycling' || sportKey === 'bike' ? 'bike' : null;
    const steps: FitWorkoutStepEvidence[] = [];
    let idx = 0;
    const rawSteps = payload.workoutSegments?.[0]?.workoutSteps || [];

    for (const raw of rawSteps) {
        if (raw.type === 'RepeatGroupDTO') {
            const startIdx = idx;
            for (const child of raw.workoutSteps || []) {
                const st = child.stepType?.stepTypeKey;
                const intensity = st === 'warmup' ? 'warmup'
                    : st === 'cooldown' ? 'cooldown'
                    : st === 'recovery' ? 'recovery'
                    : st === 'rest' ? 'rest'
                    : 'active';
                const durKey = child.endCondition?.conditionTypeKey || 'time';
                const durType = durKey === 'reps' ? 'reps'
                    : durKey === 'lap.button' ? 'open'
                    : durKey === 'distance' ? 'distance'
                    : 'time';
                const durVal = child.endConditionValue;
                const tgtKey = child.targetType?.workoutTargetTypeKey;
                const tgtType = tgtKey === 'power.zone' ? 'power'
                    : tgtKey === 'heart.rate.zone' ? 'heart_rate'
                    : tgtKey === 'speed.zone' ? 'speed'
                    : tgtKey === 'cadence.zone' ? 'cadence'
                    : 'open';

                steps.push({
                    messageIndex: idx,
                    name: child.description ?? null,
                    durationType: durType,
                    durationValue: durVal !== undefined && durVal !== null ? Number(durVal) : null,
                    targetType: tgtType,
                    targetValue: child.zoneNumber !== undefined && child.zoneNumber !== null ? Number(child.zoneNumber) : null,
                    customTargetValueLow: child.targetValueOne !== undefined && child.targetValueOne !== null ? Number(child.targetValueOne) : null,
                    customTargetValueHigh: child.targetValueTwo !== undefined && child.targetValueTwo !== null ? Number(child.targetValueTwo) : null,
                    intensity,
                    equipment,
                });
                idx += 1;
            }
            const reps = raw.numberOfIterations || 1;
            steps.push({
                messageIndex: idx,
                name: null,
                durationType: 'repeat_until_steps_cmplt',
                durationValue: startIdx,
                targetType: 'open',
                targetValue: reps,
                customTargetValueLow: null,
                customTargetValueHigh: null,
                intensity: 'active',
                equipment,
            });
            idx += 1;
        } else {
            const st = raw.stepType?.stepTypeKey;
            const intensity = st === 'warmup' ? 'warmup'
                : st === 'cooldown' ? 'cooldown'
                : st === 'recovery' ? 'recovery'
                : st === 'rest' ? 'rest'
                : 'active';
            const durKey = raw.endCondition?.conditionTypeKey || 'time';
            const durType = durKey === 'reps' ? 'reps'
                : durKey === 'lap.button' ? 'open'
                : durKey === 'distance' ? 'distance'
                : 'time';
            const durVal = raw.endConditionValue;
            const tgtKey = raw.targetType?.workoutTargetTypeKey;
            const tgtType = tgtKey === 'power.zone' ? 'power'
                : tgtKey === 'heart.rate.zone' ? 'heart_rate'
                : tgtKey === 'speed.zone' ? 'speed'
                : tgtKey === 'cadence.zone' ? 'cadence'
                : 'open';

            steps.push({
                messageIndex: idx,
                name: raw.description ?? null,
                durationType: durType,
                durationValue: durVal !== undefined && durVal !== null ? Number(durVal) : null,
                targetType: tgtType,
                targetValue: raw.zoneNumber !== undefined && raw.zoneNumber !== null ? Number(raw.zoneNumber) : null,
                customTargetValueLow: raw.targetValueOne !== undefined && raw.targetValueOne !== null ? Number(raw.targetValueOne) : null,
                customTargetValueHigh: raw.targetValueTwo !== undefined && raw.targetValueTwo !== null ? Number(raw.targetValueTwo) : null,
                intensity,
                equipment,
            });
            idx += 1;
        }
    }

    return steps;
}

export function canonicalWorkoutToFitIdentitySteps(
    workout: CanonicalWorkoutExport,
    context?: { athleteFtpWatts?: number },
): FitWorkoutStepEvidence[] {
    const payload = canonicalWorkoutToGarminPayload(workout, context?.athleteFtpWatts);
    return garminPayloadToFitSteps(payload);
}

const FTP_RELATIVE_TARGET_PATTERN = /(?:\d+(?:\.\d+)?\s*[-–—]\s*\d+(?:\.\d+)?\s*%\s*(?:FTP)?|\d+(?:\.\d+)?\s*%\s*FTP\b)/i;
const EXACT_WATT_TARGET_PATTERN = /(?:\d+(?:\.\d+)?\s*[-–—]\s*\d+(?:\.\d+)?\s*W\b|\d+(?:\.\d+)?\s*W\b)/i;

/**
 * Garmin's upload path resolves cycling %FTP prescriptions with the athlete FTP when
 * available. Generating a semantic fingerprint without that same context would instead
 * encode a zone target and could turn the *same* workout into a hard reconciliation
 * mismatch. Fail closed so callers can fall back to the ordinary matcher until the exact
 * upload context is available.
 */
export function canonicalWorkoutRequiresAthleteFtp(workout: CanonicalWorkoutExport): boolean {
    const modality = String(workout.modality || '').toLowerCase();
    if (modality !== 'cycling' && modality !== 'bike') return false;

    return (workout.blocks || []).some(block =>
        (block.steps || []).some(step => {
            const texts = [
                ...(Array.isArray(step.targets) ? step.targets : []),
                step.recoveryTarget,
                step.notes,
                step.name,
            ];
            return texts.some(value =>
                typeof value === 'string'
                && FTP_RELATIVE_TARGET_PATTERN.test(value)
                && !EXACT_WATT_TARGET_PATTERN.test(value),
            );
        }),
    );
}

export async function computeWorkoutTemplateFingerprint(
    workout: CanonicalWorkoutExport,
    context?: { athleteFtpWatts?: number },
): Promise<FitWorkoutIdentity> {
    if (canonicalWorkoutRequiresAthleteFtp(workout)
        && !(typeof context?.athleteFtpWatts === 'number'
            && Number.isFinite(context.athleteFtpWatts)
            && context.athleteFtpWatts > 0)) {
        throw new Error('Cycling %FTP workout identity requires the athlete FTP used for Garmin export');
    }

    const steps = canonicalWorkoutToFitIdentitySteps(workout, context);
    const workoutName = workout.title;
    const identity = await computeFitWorkoutIdentity(workoutName, [], steps);
    if (!identity) {
        throw new Error('Failed to compute template workout identity for workout');
    }
    return identity;
}
