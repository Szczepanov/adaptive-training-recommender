import { execFileSync, spawnSync } from 'node:child_process';
import { linkSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildOpenBarAnalysis, openBarCsrtParameters, openBarProfileToWlCsv, openBarSingleRepProfile } from '../src/observations/fixtures/openBarAnalysisFixtures.ts';

const directories = [];
afterEach(() => { for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }); });
function fixture() {
    const path = mkdtempSync(join(tmpdir(), 'velocity-agreement-'));
    directories.push(path);
    const profile = openBarSingleRepProfile();
    writeFileSync(join(path, 'wl.csv'), openBarProfileToWlCsv(profile));
    writeFileSync(join(path, 'openbar.json'), JSON.stringify(buildOpenBarAnalysis(profile)));
    const config = { pairs: [{ label: 'synthetic-lift', wlCsv: 'wl.csv', openBarAnalysis: 'openbar.json', loadKg: 100 }] };
    writeFileSync(join(path, 'pairs.json'), JSON.stringify(config));
    return { path, config, pairs: join(path, 'pairs.json'), output: join(path, 'report') };
}
const script = resolve('scripts/velocity-agreement-report.mjs');
const run = (args, cwd) => spawnSync(process.execPath, ['--experimental-strip-types', script, ...args], { encoding: 'utf8', cwd });
describe('velocity agreement CLI', () => {
    it('writes byte-identical JSON and Markdown on repeated synthetic runs', () => {
        const { path, pairs, output } = fixture();
        for (const name of ['a', 'b']) {
            execFileSync(process.execPath, ['--experimental-strip-types', script, '--pairs', pairs, '--output', join(path, name)]);
        }
        for (const extension of ['json', 'md']) {
            const first = readFileSync(join(path, `a.${extension}`));
            expect(readFileSync(join(path, `b.${extension}`))).toEqual(first);
            expect(first.toString()).not.toContain(path);
            expect(first.toString()).not.toContain('\r');
            expect(first.toString().endsWith('\n')).toBe(true);
        }
        const report = JSON.parse(readFileSync(join(path, 'a.json'), 'utf8'));
        expect(JSON.stringify(report)).toContain('concentric-segmentation-v2');
        expect(JSON.stringify(report)).toContain('backward-difference');
        expect(existsSync(`${output}.json`)).toBe(false);
    });
    it('refuses either existing output and permits explicit --force', () => {
        const { pairs, output } = fixture();
        writeFileSync(`${output}.md`, 'keep this');
        const refused = run(['--pairs', pairs, '--output', output]);
        expect(refused.status).toBe(1);
        expect(refused.stderr).toContain('already exists');
        expect(readFileSync(`${output}.md`, 'utf8')).toBe('keep this');
        expect(existsSync(`${output}.json`)).toBe(false);
        expect(run(['--pairs', pairs, '--output', output, '--force']).status).toBe(0);
    });
    it('supports both explicit v1 segmentation and a non-default temporal overlap', () => {
        const { pairs, output } = fixture();
        const result = run(['--pairs', pairs, '--output', output, '--segmentation', 'concentric-segmentation-v1', '--min-overlap', '0.75']);
        expect(result.status, result.stderr).toBe(0);
        expect(readFileSync(`${output}.json`, 'utf8')).toContain('concentric-segmentation-v1');
    });
    it.each([
        [], ['--unknown'], ['--pairs'], ['--pairs', 'x', '--output', 'y', '--min-overlap', '0'],
        ['--pairs', 'x', '--output', 'y', '--min-overlap', 'NaN'],
        ['--pairs', 'x', '--output', 'y', '--min-overlap', '1.1'],
        ['--pairs', 'x', '--output', 'y', '--segmentation', 'unknown'],
        ['--pairs', 'x', '--pairs', 'y', '--output', 'z'],
    ].map(args => ({ args })))('rejects invalid arguments $args', ({ args }) => { expect(run(args).status).toBe(1); });
    it.each([
        { pairs: [] }, { pairs: [{ label: 'bad', loadKg: 0, wlCsv: 'wl.csv', openBarAnalysis: 'openbar.json' }] },
        { pairs: [{ label: 'bad', loadKg: 100, offsetS: 'invalid', wlCsv: 'wl.csv', openBarAnalysis: 'openbar.json' }] },
        { pairs: [{ label: 'line\nbreak', loadKg: 100, wlCsv: 'wl.csv', openBarAnalysis: 'openbar.json' }] },
    ])('rejects malformed pair configuration %j', config => {
        const { pairs, output } = fixture();
        writeFileSync(pairs, JSON.stringify(config));
        expect(run(['--pairs', pairs, '--output', output]).status).toBe(1);
        expect(existsSync(`${output}.json`)).toBe(false);
    });
    it('warns when output is inside the git worktree without blocking the report', () => {
        const { pairs } = fixture();
        mkdirSync(resolve('artifacts'), { recursive: true });
        const path = mkdtempSync(join(resolve('artifacts'), 'velocity-agreement-cli-'));
        directories.push(path);
        const output = join(path, 'report');
        const result = run(['--pairs', pairs, '--output', output], tmpdir());
        expect(result.status, result.stderr).toBe(0);
        expect(result.stderr).toContain('inside the git worktree');
        expect(existsSync(`${output}.json`)).toBe(true);
    });
    it('rejects mixed OpenBar method configurations so pooled statistics remain method-homogeneous', () => {
        const { path, pairs, output, config } = fixture();
        const second = JSON.parse(readFileSync(join(path, 'openbar.json'), 'utf8'));
        second.identity.source_sha256 = 'd'.repeat(64);
        second.derived.filtered.filter.parameters.window = 11;
        writeFileSync(join(path, 'openbar-second.json'), JSON.stringify(second));
        config.pairs.push({ ...config.pairs[0], label: 'different-filter', openBarAnalysis: 'openbar-second.json' });
        writeFileSync(pairs, JSON.stringify(config));
        const result = run(['--pairs', pairs, '--output', output]);
        expect(result.status).toBe(1);
        expect(result.stderr).toContain('same OpenBar method configuration');
        expect(existsSync(`${output}.json`)).toBe(false);
    });
    it.each([false, true])('separates clip-specific hashes and timing from CSRT method homogeneity (changed=%s)', changed => {
        const { path, pairs, output, config } = fixture();
        const first = buildOpenBarAnalysis(undefined, { videoHash: 'a'.repeat(64) });
        first.provenance.tracker.implementation.parameters = openBarCsrtParameters();
        const firstBytes = JSON.stringify(first);
        writeFileSync(join(path, 'openbar.json'), firstBytes);
        const second = structuredClone(first);
        second.identity.source_sha256 = 'd'.repeat(64);
        second.provenance.tracker.implementation.parameters = Object.fromEntries(Object.entries({
            ...openBarCsrtParameters(), prediction_sha256: 'e'.repeat(64), seed_timestamp_s: 0.5, end_s: 3,
            ...(changed ? { threads: 2 } : {}),
        }).reverse());
        writeFileSync(join(path, 'openbar-second.json'), JSON.stringify(second));
        config.pairs.push({ ...config.pairs[0], label: 'second-clip', openBarAnalysis: 'openbar-second.json' });
        writeFileSync(pairs, JSON.stringify(config));
        const result = run(['--pairs', pairs, '--output', output]);
        expect(result.status, result.stderr).toBe(changed ? 1 : 0);
        expect(readFileSync(join(path, 'openbar.json'), 'utf8')).toBe(firstBytes);
        if (changed) {
            expect(result.stderr).toContain('same OpenBar method configuration');
            expect(existsSync(`${output}.json`)).toBe(false);
        } else {
            const report = JSON.parse(readFileSync(`${output}.json`, 'utf8'));
            const a = report.videos.find(video => video.label === 'synthetic-lift').openBar;
            const b = report.videos.find(video => video.label === 'second-clip').openBar;
            expect(a.methodConfigSha256).toBe(b.methodConfigSha256);
            expect(a.fileSha256).not.toBe(b.fileSha256);
            expect(a.provenance.trackerParameters).not.toBe(b.provenance.trackerParameters);
            expect(a.provenance.trackerParameters).toContain('c'.repeat(64));
            expect(b.provenance.trackerParameters).toContain('e'.repeat(64));
        }
    });
    it('rejects a cohort mixing legacy and parameterized parser identities', () => {
        const { path, pairs, output, config } = fixture();
        const second = buildOpenBarAnalysis();
        second.provenance.tracker.implementation.parameters = openBarCsrtParameters();
        writeFileSync(join(path, 'openbar-second.json'), JSON.stringify(second));
        config.pairs.push({ ...config.pairs[0], label: 'parameterized', openBarAnalysis: 'openbar-second.json' });
        writeFileSync(pairs, JSON.stringify(config));
        expect(run(['--pairs', pairs, '--output', output]).stderr).toContain('same OpenBar parser version');
        expect(existsSync(`${output}.json`)).toBe(false);
    });
    it('does not split a cohort on an unused filter when kinematics consumes calibrated input', () => {
        const { path, pairs, output, config } = fixture();
        const first = JSON.parse(readFileSync(join(path, 'openbar.json'), 'utf8'));
        first.derived.kinematics.input = 'calibrated';
        writeFileSync(join(path, 'openbar.json'), JSON.stringify(first));
        const second = structuredClone(first);
        second.identity.source_sha256 = 'd'.repeat(64);
        second.derived.filtered.filter.parameters.window = 11;
        writeFileSync(join(path, 'openbar-second.json'), JSON.stringify(second));
        config.pairs.push({ ...config.pairs[0], label: 'same-active-method', openBarAnalysis: 'openbar-second.json' });
        writeFileSync(pairs, JSON.stringify(config));
        const result = run(['--pairs', pairs, '--output', output]);
        expect(result.status, result.stderr).toBe(0);
        expect(existsSync(`${output}.json`)).toBe(true);
    });
    it('protects inputs even with --force', () => {
        const { path, pairs } = fixture();
        const original = readFileSync(join(path, 'openbar.json'));
        const result = run(['--pairs', pairs, '--output', join(path, 'openbar'), '--force']);
        expect(result.status).toBe(1);
        expect(result.stderr).toContain('overwrite an input');
        expect(readFileSync(join(path, 'openbar.json'))).toEqual(original);
    });
    it('protects hard-linked input aliases even with --force', () => {
        const { path, pairs, output } = fixture();
        const input = join(path, 'openbar.json');
        const original = readFileSync(input);
        linkSync(input, `${output}.json`);
        const result = run(['--pairs', pairs, '--output', output, '--force']);
        expect(result.status).toBe(1);
        expect(result.stderr).toContain('overwrite an input');
        expect(readFileSync(input)).toEqual(original);
        expect(existsSync(`${output}.md`)).toBe(false);
    });
    it('rejects invalid JSON and duplicate labels before writing', () => {
        const { pairs, output, config } = fixture();
        writeFileSync(pairs, '{');
        expect(run(['--pairs', pairs, '--output', output]).stderr).toContain('invalid JSON');
        config.pairs.push({ ...config.pairs[0] });
        writeFileSync(pairs, JSON.stringify(config));
        expect(run(['--pairs', pairs, '--output', output]).stderr).toContain('unique');
        expect(existsSync(`${output}.json`)).toBe(false);
    });
});
