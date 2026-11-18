#!/usr/bin/env node
/**
 * Dependency audit gate: `npm audit --audit-level=high` with explicit, expiring exceptions.
 *
 * Fails on every high or critical finding unless *each* high/critical advisory behind that
 * finding is listed, unexpired, in `audit-allowlist.json`. Exceptions exist only for advisories
 * that have no published fix; every entry carries a reason and an expiry date, after which the
 * gate fails again so the exception is re-reviewed rather than forgotten. Registry errors and
 * unreadable output fail the gate (CI retries once).
 *
 * Usage: node scripts/audit-gate.mjs   (run from app/, via `npm run audit`)
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const GATED_SEVERITIES = new Set(['high', 'critical']);
const ADVISORY_ID = /GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Today's calendar date in Warsaw (the repository's calendar, ADR-0003), as YYYY-MM-DD. */
export function warsawToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw' }).format(now);
}

/** Validates the allowlist file contents; throws with a precise message on any malformed entry. */
export function parseAllowlist(raw) {
  if (!raw || !Array.isArray(raw.exceptions)) throw new Error('audit allowlist: expected { "exceptions": [...] }');
  return raw.exceptions.map((entry, index) => {
    const where = `audit allowlist exceptions[${index}]`;
    if (typeof entry?.id !== 'string' || !ADVISORY_ID.test(entry.id)) throw new Error(`${where}: id must be a GHSA advisory id`);
    if (typeof entry.reason !== 'string' || entry.reason.trim().length < 20) throw new Error(`${where}: reason must explain the exception`);
    if (typeof entry.expires !== 'string' || !ISO_DATE.test(entry.expires)) throw new Error(`${where}: expires must be YYYY-MM-DD`);
    return { id: entry.id, reason: entry.reason.trim(), expires: entry.expires };
  });
}

/** Root advisories (with severity) behind one `npm audit --json` vulnerability entry. */
function rootAdvisories(vulnerabilities, name, seen = new Set()) {
  if (seen.has(name) || !vulnerabilities[name]) return [];
  const nextSeen = new Set(seen).add(name);
  return vulnerabilities[name].via.flatMap(via => (typeof via === 'string'
    ? rootAdvisories(vulnerabilities, via, nextSeen)
    : [{ id: String(via.url ?? '').match(ADVISORY_ID)?.[0] ?? `source-${via.source}`, severity: via.severity }]));
}

function unreadable(report) {
  const detail = report?.error ? `: ${report.error.summary ?? report.error.code}` : '';
  return { blocking: [{ name: 'npm audit', reason: `unreadable audit report${detail}` }], waived: [], expired: [], unused: [] };
}

/**
 * Classifies an `npm audit --json` report. A gated finding is waived only when every gated
 * advisory behind it is on the allowlist and unexpired; anything else blocks.
 */
export function evaluateAudit(report, allowlist, today) {
  if (!report || typeof report !== 'object' || report.error || typeof report.vulnerabilities !== 'object') {
    return unreadable(report);
  }
  const active = new Map(allowlist.filter(entry => entry.expires >= today).map(entry => [entry.id, entry]));
  const blocking = [];
  const waived = [];
  const used = new Set();
  for (const [name, finding] of Object.entries(report.vulnerabilities)) {
    if (!GATED_SEVERITIES.has(finding.severity)) continue;
    const gatedRoots = rootAdvisories(report.vulnerabilities, name).filter(root => GATED_SEVERITIES.has(root.severity));
    const unwaived = gatedRoots.filter(root => !active.has(root.id));
    if (gatedRoots.length === 0 || unwaived.length > 0) {
      const shown = unwaived.length > 0 ? unwaived : gatedRoots;
      blocking.push({ name, severity: finding.severity, advisories: [...new Set(shown.map(root => root.id))] });
    } else {
      gatedRoots.forEach(root => used.add(root.id));
      waived.push({ name, severity: finding.severity, advisories: [...new Set(gatedRoots.map(root => root.id))] });
    }
  }
  return {
    blocking,
    waived,
    expired: allowlist.filter(entry => entry.expires < today),
    unused: [...active.values()].filter(entry => !used.has(entry.id)),
  };
}

export function formatResult({ blocking, waived, expired, unused }, allowlist) {
  const lines = [];
  const byId = new Map(allowlist.map(entry => [entry.id, entry]));
  for (const entry of expired) lines.push(`[audit] EXPIRED exception ${entry.id} (expired ${entry.expires}): re-review or remove it.`);
  for (const id of new Set(waived.flatMap(item => item.advisories))) {
    const entry = byId.get(id);
    const packages = waived.filter(item => item.advisories.includes(id)).map(item => item.name).join(', ');
    lines.push(`[audit] WAIVED ${id} until ${entry.expires}: ${packages}`);
    lines.push(`[audit]   reason: ${entry.reason}`);
  }
  for (const entry of unused) lines.push(`[audit] note: exception ${entry.id} matched nothing; remove it from audit-allowlist.json.`);
  for (const item of blocking) {
    const advisories = item.advisories?.length ? ` (${item.advisories.join(', ')})` : '';
    lines.push(`[audit] BLOCKING ${item.severity ? `${item.severity} ` : ''}${item.name}${advisories}${item.reason ? `: ${item.reason}` : ''}`);
  }
  lines.push(blocking.length === 0
    ? `[audit] PASS: no unwaived high/critical advisories${waived.length ? ` (${waived.length} waived finding(s) listed above)` : ''}.`
    : `[audit] FAIL: ${blocking.length} high/critical finding(s) need a fix or a reviewed exception.`);
  return lines.join('\n');
}

function runNpmAudit(cwd) {
  const result = spawnSync('npm', ['audit', '--json'], {
    cwd, encoding: 'utf8', shell: process.platform === 'win32', maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  try {
    return JSON.parse(result.stdout);
  } catch {
    return { error: { summary: (result.stderr || result.stdout || 'no output').trim().slice(0, 300) } };
  }
}

function main() {
  const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const allowlist = parseAllowlist(JSON.parse(readFileSync(resolve(appDir, 'audit-allowlist.json'), 'utf8')));
  const outcome = evaluateAudit(runNpmAudit(appDir), allowlist, warsawToday());
  const output = formatResult(outcome, allowlist);
  if (outcome.blocking.length > 0) {
    console.error(output);
    process.exitCode = 1;
  } else {
    console.log(output);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`[audit] FAIL: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
