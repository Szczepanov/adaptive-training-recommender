import type { WorkoutPrescription } from '../workouts/models';
import type { ExternalPlanSession } from '../engine/models';

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

function parseFractionFtpFromTargetText(targetText: string | undefined): number | null {
    if (!targetText) return null;
    const ftpMatch = targetText.match(/(\d+)(?:\s*[-–]\s*(\d+))?\s*%\s*FTP/i);
    if (ftpMatch) {
        const min = parseInt(ftpMatch[1], 10);
        const max = ftpMatch[2] ? parseInt(ftpMatch[2], 10) : min;
        return ((min + max) / 2) / 100;
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
            const parsedPower = parseFractionFtpFromTargetText(targetText);
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
            const power = parseFractionFtpFromTargetText(step.target) ?? (isWarmup ? 0.60 : isCooldown ? 0.50 : 0.80);
            const repeats = (step.repeat ?? 1) * (step.sets ?? 1);

            if (repeats > 1) {
                const restSec = (step.recoveryMin ? step.recoveryMin * 60 : 0) + (step.recoverySec ?? 0)
                    || (step.setRecoveryMin ? step.setRecoveryMin * 60 : 0) + (step.setRecoverySec ?? 0)
                    || 120;
                lines.push(
                    `        <Intervals Repeat="${repeats}" OnDuration="${stepDurationSec}" OffDuration="${restSec}" OnPower="${power.toFixed(2)}" OffPower="0.50"/>`,
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
