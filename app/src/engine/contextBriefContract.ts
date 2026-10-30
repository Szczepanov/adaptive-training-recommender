import { addDaysToLocalDateString } from '../utils/localDate';
import { POLICY_VERSION } from './policy';
import type { BriefPurpose } from './contextBriefPurpose';

/**
 * Issue #894: versioned Context Brief contract identity.
 *
 * The rendered artifact may stay human/LLM-readable Markdown, but the semantics
 * behind it must be explicit and machine-testable. Every service-level export
 * carries this identity block (in the morning footer) so a coach can identify its purpose, windows,
 * generation time, and the engine-policy build that produced the export.
 *
 * Changing the semantic meaning of a contract field requires an explicit
 * contract-version decision (bump the constant below, never silently).
 *
 * Pure: no I/O, no clock. The caller supplies `generatedAt`; pure builders may
 * omit it for deterministic unit tests. `ContextBriefService.build` is the
 * complete export boundary and always supplies it.
 */
export const CONTEXT_BRIEF_CONTRACT_VERSION = '2026-10-context-brief-contract-v12';

export interface BriefContractMetadata {
    purpose: BriefPurpose;
    contractVersion?: string;
    asOfDate: string;
    /** Retrospective detail window actually rendered (completed training, flags). */
    windowDays: number;
    /** Trailing subjective-baseline horizon used by this export, when applicable. */
    subjectiveBaselineDays?: number;
    /** Recovery-timeline horizon used by this export, when applicable. */
    recoveryTimelineDays?: number;
    /** Sensor-evidence observation horizon used by this export, when applicable. */
    sensorHorizonDays?: number;
    /** Current engine policy bundled with the build, not historical decision provenance. */
    enginePolicyVersion?: string;
    /** ISO timestamp; ephemeral — excluded from semantic determinism checks. */
    generatedAt?: string;
}

export function briefContractHeaderLines(meta: BriefContractMetadata): string[] {
    const contractVersion = meta.contractVersion ?? CONTEXT_BRIEF_CONTRACT_VERSION;
    const enginePolicyVersion = meta.enginePolicyVersion ?? POLICY_VERSION;
    const startDate = addDaysToLocalDateString(meta.asOfDate, -(meta.windowDays - 1));
    const lines = [
        `Contract version: ${contractVersion}`,
        `Purpose: ${meta.purpose}`,
        `As-of date: ${meta.asOfDate} (Europe/Warsaw calendar date)`,
        `Retrospective detail window: ${startDate} → ${meta.asOfDate} (${meta.windowDays} days)`,
    ];

    if (meta.subjectiveBaselineDays !== undefined) {
        const baselineStart = addDaysToLocalDateString(meta.asOfDate, -(meta.subjectiveBaselineDays - 1));
        lines.push(
            `Subjective baseline window: ${baselineStart} → ${meta.asOfDate} (${meta.subjectiveBaselineDays} days)`,
        );
    }

    if (meta.recoveryTimelineDays !== undefined) lines.push(`Recovery timeline: ${meta.recoveryTimelineDays} days`);
    if (meta.sensorHorizonDays !== undefined) lines.push(`Sensor evidence horizon: ${meta.sensorHorizonDays} days`);
    if (meta.purpose !== 'morning') lines.push(`Engine policy version: ${enginePolicyVersion}`);
    if (meta.generatedAt) lines.push(`Generated at: ${meta.generatedAt}`);
    return lines;
}

/** Locate the explicit metadata section, excluding subsequent peer sections. */
export function findBriefContractMetadata(text: string): { start: number; end: number } | null {
    const headings = [...text.matchAll(/^## Export metadata[ \t]*\r?$/gm)];
    // Planning/diagnostic own the header; morning owns the footer after athlete notes.
    const heading = /^# Training context brief\r?\n/.test(text) ? headings[0] : headings.at(-1);
    if (!heading) return null;
    const start = heading.index + heading[0].length;
    const nextHeading = text.slice(start).search(/^#{1,2}[ \t]+/m);
    return { start, end: nextHeading === -1 ? text.length : start + nextHeading };
}

/** Reads one `Label: value` line only from export metadata, or null. */
export function parseBriefContractField(text: string, label: string): string | null {
    const section = findBriefContractMetadata(text);
    if (!section) return null;
    for (const line of text.slice(section.start, section.end).split('\n')) {
        const trimmed = line.trim().replace(/^-\s*/, '');
        if (trimmed.startsWith(`${label}:`)) return trimmed.slice(label.length + 1).trim() || null;
    }
    return null;
}

/** Strips ephemeral lines (generation timestamp) so determinism tests compare semantics only. */
export function stripBriefContractEphemeral(text: string): string {
    const section = findBriefContractMetadata(text);
    if (!section) return text;
    const metadata = text.slice(section.start, section.end)
        .split('\n')
        .filter(line => !line.trim().replace(/^-\s*/, '').startsWith('Generated at:'))
        .join('\n');
    return text.slice(0, section.start) + metadata + text.slice(section.end);
}

export interface ExpectedRenderedBriefContract {
    purpose: BriefPurpose;
    asOfDate: string;
    generatedAt: string;
    contractVersion?: string;
    requireSourceState?: boolean;
}

/**
 * Service-boundary guard: an exported brief without identity metadata is unsafe to hand
 * to an external coach because the consumer cannot tell what contract/date it describes.
 */
export function assertRenderedBriefContract(
    text: string,
    expected: ExpectedRenderedBriefContract,
): void {
    const expectedVersion = expected.contractVersion ?? CONTEXT_BRIEF_CONTRACT_VERSION;
    const actualVersion = parseBriefContractField(text, 'Contract version');
    const actualPurpose = parseBriefContractField(text, 'Purpose');
    const actualAsOf = parseBriefContractField(text, 'As-of date');
    const actualGeneratedAt = parseBriefContractField(text, 'Generated at');
    const section = findBriefContractMetadata(text);
    const metadata = section ? text.slice(section.start, section.end) : '';

    if (actualVersion !== expectedVersion) {
        throw new Error(`Context Brief contract version mismatch: expected ${expectedVersion}, got ${actualVersion ?? 'missing'}`);
    }
    if (actualPurpose !== expected.purpose) {
        throw new Error(`Context Brief purpose mismatch: expected ${expected.purpose}, got ${actualPurpose ?? 'missing'}`);
    }
    if (!actualAsOf?.startsWith(expected.asOfDate)) {
        throw new Error(`Context Brief as-of date mismatch: expected ${expected.asOfDate}, got ${actualAsOf ?? 'missing'}`);
    }
    if (actualGeneratedAt !== expected.generatedAt) {
        throw new Error(
            `Context Brief generation timestamp mismatch: expected ${expected.generatedAt}, got ${actualGeneratedAt ?? 'missing'}`,
        );
    }
    if (expected.requireSourceState && (!metadata.includes('Source state and currency (dates never shift the as-of date):')
        || !metadata.includes('- Recovery snapshot for ')
        || !metadata.includes('- Canonical performed training:')
        || !metadata.includes('- Current-day plan authority inputs:'))) {
        throw new Error('Context Brief source state and currency missing');
    }
    if (expected.requireSourceState && expected.purpose === 'planning'
        && (!text.includes('## Measured performance evidence') || !metadata.includes('- Assessment benchmarks:'))) {
        throw new Error('Context Brief planning assessment evidence/source state missing');
    }
}
