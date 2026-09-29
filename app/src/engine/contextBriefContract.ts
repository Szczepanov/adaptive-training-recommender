import { addDaysToLocalDateString } from '../utils/localDate';
import { POLICY_VERSION } from './policy';
import type { BriefPurpose } from './contextBriefPurpose';

/**
 * Issue #894: versioned Context Brief contract identity.
 *
 * The rendered artifact may stay human/LLM-readable Markdown, but the semantics
 * behind it must be explicit and machine-testable. Every export carries this
 * block so an external coach can tell purpose, windows, currency and the
 * policy it was rendered under.
 *
 * Changing the semantic meaning of a field/section requires an explicit
 * contract-version decision (bump the constant below, never silently).
 *
 * Pure: no I/O, no clock. The caller supplies `generatedAt`; when omitted the
 * line is left out so the pure builder output stays fully deterministic.
 */
export const CONTEXT_BRIEF_CONTRACT_VERSION = '2026-09-context-brief-contract-v1';

export interface BriefContractMetadata {
    purpose: BriefPurpose;
    contractVersion?: string;
    asOfDate: string;
    /** Retrospective detail window actually rendered (completed training, flags). */
    windowDays: number;
    /** Trailing subjective-baseline horizon the export compares against. */
    subjectiveBaselineDays: number;
    /** Fixed recovery-timeline horizon rendered alongside the window. */
    recoveryTimelineDays: number;
    /** Sensor-evidence observation horizon. */
    sensorHorizonDays: number;
    policyVersion?: string;
    /** ISO timestamp; ephemeral — excluded from semantic determinism checks. */
    generatedAt?: string;
}

export function briefContractHeaderLines(meta: BriefContractMetadata): string[] {
    const contractVersion = meta.contractVersion ?? CONTEXT_BRIEF_CONTRACT_VERSION;
    const policyVersion = meta.policyVersion ?? POLICY_VERSION;
    const startDate = addDaysToLocalDateString(meta.asOfDate, -(meta.windowDays - 1));
    const baselineStart = addDaysToLocalDateString(meta.asOfDate, -(meta.subjectiveBaselineDays - 1));
    const lines = [
        `Contract version: ${contractVersion}`,
        `Purpose: ${meta.purpose}`,
        `As-of date: ${meta.asOfDate} (Europe/Warsaw calendar date)`,
        `Retrospective detail window: ${startDate} → ${meta.asOfDate} (${meta.windowDays} days)`,
        `Subjective baseline window: ${baselineStart} → ${meta.asOfDate} (${meta.subjectiveBaselineDays} days)`,
        `Recovery timeline: ${meta.recoveryTimelineDays} days · Sensor evidence horizon: ${meta.sensorHorizonDays} days`,
        `Policy version: ${policyVersion}`,
    ];
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
