import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { evaluateAudit, formatResult, parseAllowlist, warsawToday } from './audit-gate.mjs';

const PICO = 'GHSA-fc5q-39xc-vjpf';
const OTHER_HIGH = 'GHSA-aaaa-bbbb-cccc';
const MODERATE = 'GHSA-3g3m-2fjr-6pw4';
const advisory = (id, severity) => ({ source: 1, title: id, url: `https://github.com/advisories/${id}`, severity });

/** Shaped like `npm audit --json`: a root package with advisories and dependants that point at it by name. */
function report(extra = {}) {
  return {
    auditReportVersion: 2,
    vulnerabilities: {
      picomatch: { name: 'picomatch', severity: 'high', via: [advisory(PICO, 'high')] },
      tinyglobby: { name: 'tinyglobby', severity: 'high', via: ['picomatch'] },
      vite: { name: 'vite', severity: 'high', via: ['picomatch', 'tinyglobby'] },
      glob: { name: 'glob', severity: 'moderate', via: [advisory(MODERATE, 'moderate')] },
      ...extra,
    },
  };
}

const allowlist = [{ id: PICO, reason: 'no published fix; build tooling only', expires: '2026-12-18' }];

describe('evaluateAudit', () => {
  it('waives findings whose only high advisory is an active exception, transitively', () => {
    const outcome = evaluateAudit(report(), allowlist, '2026-11-18');
    expect(outcome.blocking).toEqual([]);
    expect(outcome.waived.map(item => item.name).sort()).toEqual(['picomatch', 'tinyglobby', 'vite']);
    expect(outcome.unused).toEqual([]);
  });

  it('still blocks a package that also carries a different high advisory', () => {
    const outcome = evaluateAudit(report({
      'vite-plugin-pwa': { name: 'vite-plugin-pwa', severity: 'high', via: ['tinyglobby', advisory(OTHER_HIGH, 'high')] },
    }), allowlist, '2026-11-18');
    expect(outcome.blocking).toEqual([{ name: 'vite-plugin-pwa', severity: 'high', advisories: [OTHER_HIGH] }]);
  });

  it('blocks a critical finding and ignores moderates', () => {
    const outcome = evaluateAudit(report({
      lodash: { name: 'lodash', severity: 'critical', via: [advisory(OTHER_HIGH, 'critical')] },
    }), allowlist, '2026-11-18');
    expect(outcome.blocking.map(item => item.name)).toEqual(['lodash']);
    expect(outcome.waived.some(item => item.name === 'glob')).toBe(false);
  });

  it('blocks again once the exception has expired, and reports the expiry', () => {
    const outcome = evaluateAudit(report(), allowlist, '2026-12-19');
    expect(outcome.blocking.map(item => item.name).sort()).toEqual(['picomatch', 'tinyglobby', 'vite']);
    expect(outcome.expired.map(entry => entry.id)).toEqual([PICO]);
    expect(evaluateAudit(report(), allowlist, '2026-12-18').blocking).toEqual([]);
  });

  it('reports an exception that no longer matches anything', () => {
    const clean = { auditReportVersion: 2, vulnerabilities: {} };
    expect(evaluateAudit(clean, allowlist, '2026-11-18').unused.map(entry => entry.id)).toEqual([PICO]);
  });

  it('fails closed on a registry error or unreadable report', () => {
    expect(evaluateAudit({ error: { code: 'ENOAUDIT', summary: 'registry timeout' } }, allowlist, '2026-11-18').blocking)
      .toEqual([{ name: 'npm audit', reason: 'unreadable audit report: registry timeout' }]);
    expect(evaluateAudit(null, allowlist, '2026-11-18').blocking).toHaveLength(1);
  });

  it('does not loop on cyclic dependency references', () => {
    const cyclic = report({
      a: { name: 'a', severity: 'high', via: ['b'] },
      b: { name: 'b', severity: 'high', via: ['a', 'picomatch'] },
    });
    expect(evaluateAudit(cyclic, allowlist, '2026-11-18').blocking).toEqual([]);
  });
});

describe('formatResult', () => {
  it('prints each waived advisory with its packages, expiry and reason', () => {
    const text = formatResult(evaluateAudit(report(), allowlist, '2026-11-18'), allowlist);
    expect(text).toContain(`[audit] WAIVED ${PICO} until 2026-12-18: picomatch, tinyglobby, vite`);
    expect(text).toContain('reason: no published fix; build tooling only');
    expect(text).toMatch(/PASS/);
  });

  it('prints blocking findings and the expired exception', () => {
    const text = formatResult(evaluateAudit(report(), allowlist, '2027-01-01'), allowlist);
    expect(text).toContain(`EXPIRED exception ${PICO}`);
    expect(text).toContain(`BLOCKING high vite (${PICO})`);
    expect(text).toMatch(/FAIL: 3 high\/critical/);
  });
});

describe('parseAllowlist', () => {
  it('accepts the committed allowlist', () => {
    const raw = JSON.parse(readFileSync(resolve(import.meta.dirname, '..', 'audit-allowlist.json'), 'utf8'));
    expect(parseAllowlist(raw).map(entry => entry.id)).toEqual([PICO]);
  });

  it.each([
    [{}, /expected/],
    [{ exceptions: [{ id: 'CVE-2026-1', reason: 'long enough reason text here', expires: '2026-12-18' }] }, /GHSA/],
    [{ exceptions: [{ id: PICO, reason: 'short', expires: '2026-12-18' }] }, /reason/],
    [{ exceptions: [{ id: PICO, reason: 'long enough reason text here', expires: 'next month' }] }, /YYYY-MM-DD/],
  ])('rejects malformed allowlist %#', (raw, message) => {
    expect(() => parseAllowlist(raw)).toThrow(message);
  });
});

describe('warsawToday', () => {
  it('uses the Warsaw calendar day, not UTC', () => {
    expect(warsawToday(new Date('2026-11-18T23:30:00Z'))).toBe('2026-11-19');
    expect(warsawToday(new Date('2026-11-18T12:00:00Z'))).toBe('2026-11-18');
  });
});
