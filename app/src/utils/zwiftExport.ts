import type { WorkoutPrescription } from '../workouts/models';
import type { ExternalPlanSession } from '../engine/models';
import type { ExternalPlanSessionV2 } from '../sessions/externalPlanV2';
import type { RangeOrNumber } from '../sessions/models';

import { extractRecoverySecondsFromText, extractSetRecoverySecondsFromText, resolveSetsAndRepetitions } from './workoutJsonExport';

export interface ZwiftExportOptions {
    ftpWatts?: number | null;
    author?: string;
}

function escapeXml(unsafe: string): string {
    return unsafe
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&apos;');
}

function parseFractionFtpFromTargetText(targetText: string | undefined, ftpWatts?: number | null): number | null {
    if (!targetText) return null;
    const ftpMatch = targetText.match(/(\d+)(?:\s*[-–]\s*(\d+))?\s*%\s*FTP/i);
    if (ftpMatch) {
        const min = parseInt(ftpMatch[1], 10);
        const max = ftpMatch[2] ? parseInt(ftpMatch[2], 10) : min;
        return ((min + max) / 2) / 100;
    }
    const wattsMatch = targetText.match(/(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)\s*W\b/i);
    if (wattsMatch && ftpWatts && ftpWatts > 0) {
        const minW = parseFloat(wattsMatch[1]);
        const maxW = parseFloat(wattsMatch[2]);
        const avgW = (minW + maxW) / 2;
        return parseFloat((avgW / ftpWatts).toFixed(2));
    }
    const singleWattsMatch = targetText.match(/(\d+(?:\.\d+)?)\s*W\b/i);
    if (singleWattsMatch && ftpWatts && ftpWatts > 0) {
        const w = parseFloat(singleWattsMatch[1]);
        return parseFloat((w / ftpWatts).toFixed(2));
    }
    if (/zone\s*1|recovery/i.test(targetText)) return 0.50;
    if (/zone\s*2|endurance|aerobic/i.test(targetText)) return 0.65;
    if (/zone\s*3|tempo|sweet\s*spot/i.test(targetText)) return 0.82;
    if (/zone\s*4|threshold/i.test(targetText)) return 0.96;
    if (/zone\s*5|vo2/i.test(targetText)) return 1.12;
    if (/zone\s*6|anaerobic/i.test(targetText)) return 1.30;
    return null;
}

function parseDurationSeconds(dose: string): number {
    const minMatch = dose.match(/(\d+(?:\.\d+)?)\s*(?:min|m\b)/i);
    if (minMatch) return Math.round(parseFloat(minMatch[1]) * 60);
    const secMatch = dose.match(/(\d+)\s*(?:sec|s\b)/i);
    if (secMatch) return parseInt(secMatch[1], 10);
    return 300;
}

export function generateZwiftFromPrescription(
    prescription: WorkoutPrescription,
    options: ZwiftExportOptions = {},
): string {
    const author = options.author ?? 'Adaptive Training Recommender';
    const lines: string[] = [
        '<workout_file>',
        `    <author>${escapeXml(author)}</author>`,
        `    <name>${escapeXml(prescription.workoutId.replaceAll('_', ' '))}</name>`,
        `    <description>${escapeXml(`Target duration: ${prescription.targetDurationMin} min`)}</description>`,
        '    <sportType>bike</sportType>',
        '    <workout>',
    ];

    for (const block of prescription.displayBlocks) {
        for (const step of block.steps) {
            const isWarmup = block.role === 'warmup' || /warm-?up/i.test(step.name);
            const isCooldown = block.role === 'cooldown' || /cool-?down/i.test(step.name);

            let powerFraction = 0.70;
            const targetText = step.structuredTargets?.map(t => t.valueText).join(' ') ?? step.targets.join(' ');
            const parsedPower = parseFractionFtpFromTargetText(targetText, options.ftpWatts);
            if (parsedPower !== null) {
                powerFraction = parsedPower;
            } else if (isWarmup) {
                powerFraction = 0.60;
            } else if (isCooldown) {
                powerFraction = 0.50;
            }

            const durationSec = parseDurationSeconds(step.dose);
            const repeatMatch = step.dose.match(/(\d+)\s*[x×]/i);
            const repeats = repeatMatch ? parseInt(repeatMatch[1], 10) : 1;

            if (repeats > 1) {
                const restSec = step.rest ? parseDurationSeconds(step.rest) : 120;
                lines.push(
                    `        <Intervals Repeat="${repeats}" OnDuration="${durationSec}" OffDuration="${restSec}" OnPower="${powerFraction.toFixed(2)}" OffPower="0.50"/>`,
                );
            } else if (isWarmup) {
                lines.push(
                    `        <Warmup Duration="${durationSec}" PowerLow="0.50" PowerHigh="${powerFraction.toFixed(2)}"/>`,
                );
            } else if (isCooldown) {
                lines.push(
                    `        <Cooldown Duration="${durationSec}" PowerLow="${powerFraction.toFixed(2)}" PowerHigh="0.45"/>`,
                );
            } else {
                lines.push(
                    `        <SteadyState Duration="${durationSec}" Power="${powerFraction.toFixed(2)}"/>`,
                );
            }
        }
    }

    lines.push('    </workout>', '</workout_file>');
    return lines.join('\n');
}

export function generateZwiftFromExternalSession(
    session: ExternalPlanSession,
    options: ZwiftExportOptions = {},
): string {
    const author = options.author ?? 'Adaptive Training Recommender';
    const lines: string[] = [
        '<workout_file>',
        `    <author>${escapeXml(author)}</author>`,
        `    <name>${escapeXml(session.title)}</name>`,
        `    <description>${escapeXml(session.prescription.summary)}</description>`,
        '    <sportType>bike</sportType>',
        '    <workout>',
    ];

    const steps = session.prescription.steps ?? [];
    if (steps.length === 0) {
        const durationSec = (session.gating.durationMin || 60) * 60;
        const power = session.gating.intensity === 'hard' ? 0.90 : session.gating.intensity === 'recovery' ? 0.55 : 0.70;
        lines.push(`        <SteadyState Duration="${durationSec}" Power="${power.toFixed(2)}"/>`);
    } else {
        for (const step of steps) {
            const stepDurationSec = (step.durationMin ? step.durationMin * 60 : 0) + (step.durationSec ?? 0) || 300;
            const isWarmup = /warm-?up/i.test(step.name);
            const isCooldown = /cool-?down/i.test(step.name);
            const power = parseFractionFtpFromTargetText(step.target, options.ftpWatts) ?? (isWarmup ? 0.60 : isCooldown ? 0.50 : 0.80);

            let restSec = (step.recoveryMin ? step.recoveryMin * 60 : 0) + (step.recoverySec ?? 0) || undefined;
            let setRecoverySec = (step.setRecoveryMin ? step.setRecoveryMin * 60 : 0) + (step.setRecoverySec ?? 0) || undefined;
            let sets = step.sets ?? 1;
            let reps = step.repeat ?? 1;

            const stepText = `${step.notes ?? ''} ${step.name}`;
            const sessionText = `${stepText} ${session.title} ${session.prescription.summary}`;

            if (!isWarmup && !isCooldown) {
                const resolvedStructure = resolveSetsAndRepetitions(step.sets, step.repeat, stepText);
                sets = resolvedStructure.sets ?? 1;
                reps = resolvedStructure.repetitions ?? 1;

                if (!restSec && (reps > 1 || sets > 1 || /interval|vo2|surge|repeat/i.test(step.name) || /30\/15|40\/20/i.test(sessionText))) {
                    restSec = extractRecoverySecondsFromText(sessionText, stepDurationSec);
                }
                if (!setRecoverySec && (sets > 1 || /between\s+sets/i.test(sessionText))) {
                    setRecoverySec = extractSetRecoverySecondsFromText(sessionText);
                }
            }

            if (sets > 1 && reps > 1) {
                const effectiveRestSec = restSec || 30;
                const effectiveSetRecoverySec = setRecoverySec || 180;
                for (let s = 1; s <= sets; s++) {
                    lines.push(
                        `        <Intervals Repeat="${reps}" OnDuration="${stepDurationSec}" OffDuration="${effectiveRestSec}" OnPower="${power.toFixed(2)}" OffPower="0.50"/>`,
                    );
                    if (s < sets) {
                        lines.push(
                            `        <SteadyState Duration="${effectiveSetRecoverySec}" Power="0.50"/>`,
                        );
                    }
                }
            } else if (reps > 1 || sets > 1) {
                const totalRepeats = reps > 1 ? reps : sets;
                const effectiveRestSec = restSec || setRecoverySec || 120;
                lines.push(
                    `        <Intervals Repeat="${totalRepeats}" OnDuration="${stepDurationSec}" OffDuration="${effectiveRestSec}" OnPower="${power.toFixed(2)}" OffPower="0.50"/>`,
                );
            } else if (isWarmup) {
                lines.push(
                    `        <Warmup Duration="${stepDurationSec}" PowerLow="0.50" PowerHigh="${power.toFixed(2)}"/>`,
                );
            } else if (isCooldown) {
                lines.push(
                    `        <Cooldown Duration="${stepDurationSec}" PowerLow="${power.toFixed(2)}" PowerHigh="0.45"/>`,
                );
            } else {
                lines.push(
                    `        <SteadyState Duration="${stepDurationSec}" Power="${power.toFixed(2)}"/>`,
                );
            }
        }
    }

    lines.push('    </workout>', '</workout_file>');
    return lines.join('\n');
}

function rangeMidpointSec(value: RangeOrNumber | undefined): number | undefined {
    if (value === undefined) return undefined;
    return typeof value === 'number' ? value : Math.round((value.min + value.max) / 2);
}

/**
 * v2 counterpart of `generateZwiftFromExternalSession`. Sequential blocks/steps only --
 * circuit/superset execution modes aren't realistic for an imported cycling plan and Zwift
 * has no equivalent primitive. Power comes from `gating.intensity` (unchanged on v2
 * sessions, so this reuses the exact same heuristic v1 does) with `block.role` deciding
 * warmup/cooldown, rather than v1's name-text regex -- a normalized `SessionDefinition`
 * already carries that as a real field (M3.6).
 */
export function generateZwiftFromExternalSessionV2(
    session: ExternalPlanSessionV2,
    options: ZwiftExportOptions = {},
): string {
    const author = options.author ?? 'Adaptive Training Recommender';
    const lines: string[] = [
        '<workout_file>',
        `    <author>${escapeXml(author)}</author>`,
        `    <name>${escapeXml(session.title)}</name>`,
        `    <description>${escapeXml(session.definition.summary ?? session.definition.title)}</description>`,
        '    <sportType>bike</sportType>',
        '    <workout>',
    ];

    const basePower = session.gating.intensity === 'hard' || session.gating.intensity === 'max' ? 0.90
        : session.gating.intensity === 'recovery' ? 0.55
            : 0.70;

    const steps = session.definition.blocks.flatMap(block => block.steps.map(step => ({ block, step })));
    if (steps.length === 0) {
        const durationSec = (session.gating.durationMin || 60) * 60;
        lines.push(`        <SteadyState Duration="${durationSec}" Power="${basePower.toFixed(2)}"/>`);
    } else {
        for (const { block, step } of steps) {
            const isWarmup = block.role === 'warmup';
            const isCooldown = block.role === 'cooldown';
            const power = isWarmup ? 0.60 : isCooldown ? 0.50 : basePower;
            const durationSec = (step.dose?.kind === 'duration' ? rangeMidpointSec(step.dose.seconds) : undefined) ?? 300;
            const repeats = step.dose?.kind === 'duration' ? (step.dose.sets ?? 1) : 1;
            const restSec = rangeMidpointSec(step.rest);

            if (repeats > 1) {
                lines.push(
                    `        <Intervals Repeat="${repeats}" OnDuration="${durationSec}" OffDuration="${restSec ?? 120}" OnPower="${power.toFixed(2)}" OffPower="0.50"/>`,
                );
            } else if (isWarmup) {
                lines.push(`        <Warmup Duration="${durationSec}" PowerLow="0.50" PowerHigh="${power.toFixed(2)}"/>`);
            } else if (isCooldown) {
                lines.push(`        <Cooldown Duration="${durationSec}" PowerLow="${power.toFixed(2)}" PowerHigh="0.45"/>`);
            } else {
                lines.push(`        <SteadyState Duration="${durationSec}" Power="${power.toFixed(2)}"/>`);
            }
        }
    }

    lines.push('    </workout>', '</workout_file>');
    return lines.join('\n');
}

export function downloadZwiftFile(filename: string, content: string): void {
    const blob = new Blob([content], { type: 'application/xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename.endsWith('.zwo') ? filename : `${filename}.zwo`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}
