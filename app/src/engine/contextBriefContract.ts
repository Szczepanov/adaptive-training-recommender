import { addDaysToLocalDateString } from '../utils/localDate';
import { POLICY_VERSION } from './policy';
import type { BriefPurpose } from './contextBriefPurpose';

/**
 * Issue #894: versioned Context Brief contract identity.
 *
 * The rendered artifact may stay human/LLM-readable Markdown, but the semantics
 * behind it must be explicit and machine-testable. Every service-level export
 * carries this block so an external coach can identify its purpose, windows,
 * generation time, and the engine-policy build that produced the export.
 *
 * Changing the semantic meaning of a contract field requires an explicit
 * contract-version decision (bump the constant below, never silently).
 *
 * Pure: no I/O, no clock. The caller supplies `generatedAt`; pure builders may
 * omit it for deterministic unit tests. `ContextBriefService.build` is the
 * complete export boundary and always supplies it.
 */
export const CONTEXT_BRIEF_CONTRACT_VERSION = '2026-09-context-brief-contract-v3';

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

const NOT_USED = 'not used by this export';

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
    } else {
        lines.push(`Subjective baseline window: ${NOT_USED}`);
    }

    lines.push(
        `Recovery timeline: ${meta.recoveryTimelineDays === undefined ? NOT_USED : `${meta.recoveryTimelineDays} days`}`,
        `Sensor evidence horizon: ${meta.sensorHorizonDays === undefined ? NOT_USED : `${meta.sensorHorizonDays} days`}`,
        `Engine policy version: ${enginePolicyVersion}`,
    );
    if (meta.generatedAt) lines.push(`Generated at: ${meta.generatedAt}`);
    return lines;
}

/** Reads one `Label: value` contract line from rendered text, or null. */
export function parseBriefContractField(text: string, label: string): string | null {
    for (const line of text.split('\n')) {
        const trimmed = line.trim().replace(/^-\s*/, '');
        if (trimmed.startsWith(`${label}:`)) return trimmed.slice(label.length + 1).trim() || null;
    }
    return null;
}

/** Strips ephemeral lines (generation timestamp) so determinism tests compare semantics only. */
export function stripBriefContractEphemeral(text: string): string {
    return text
        .split('\n')
        .filter(line => !line.trim().replace(/^-\s*/, '').startsWith('Generated at:'))
        .join('\n');
}

export interface ExpectedRenderedBriefContract {
    purpose: BriefPurpose;
    asOfDate: string;
    generatedAt: string;
    contractVersion?: string;
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
}
