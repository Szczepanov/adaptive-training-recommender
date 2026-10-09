/** Local evidence report. Inputs and outputs may contain private lift data. */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { access, mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { CONCENTRIC_SEGMENTATION_V1, CONCENTRIC_SEGMENTATION_V2 } from '../src/observations/concentricSegmentation.ts';
import { parseWlAnalysisCsv, WL_ANALYSIS_CSV_PARSER_V1, WL_ANALYSIS_CSV_PARSER_V2, WL_PARSER_SEGMENTATION_RULE } from '../src/observations/wlAnalysisCsv.ts';
import { parseOpenBarAnalysis, openBarTrackerMethodParameters } from '../src/observations/openBarAnalysis.ts';
import { buildAgreementReport } from '../src/observations/velocityAgreement.ts';

const usage = 'Usage: --pairs <pairs.json> --output <basename> [--segmentation concentric-segmentation-v2] [--min-overlap 0.5] [--force]';
function argumentsFor(argv) {
    const options = { segmentation: CONCENTRIC_SEGMENTATION_V2, minOverlap: 0.5, force: false };
    const seen = new Set();
    for (let i = 0; i < argv.length; i += 1) {
        const key = argv[i];
        if (seen.has(key)) throw new Error(`Repeated option ${key}. ${usage}`);
        seen.add(key);
        if (key === '--force') { options.force = true; continue; }
        if (!['--pairs', '--output', '--segmentation', '--min-overlap'].includes(key)) throw new Error(`Unknown option ${key}. ${usage}`);
        const value = argv[++i];
        if (!value || value.startsWith('--')) throw new Error(`Missing value for ${key}. ${usage}`);
        if (key === '--min-overlap') options.minOverlap = Number(value);
        else options[key.slice(2)] = value;
    }
    if (!options.pairs || !options.output) throw new Error(usage);
    if (![CONCENTRIC_SEGMENTATION_V1, CONCENTRIC_SEGMENTATION_V2].includes(options.segmentation)) throw new Error('Unsupported segmentation rule.');
    if (!Number.isFinite(options.minOverlap) || options.minOverlap <= 0 || options.minOverlap > 1) throw new Error('Minimum overlap must be greater than 0 and at most 1.');
    return options;
}
function sourcePath(value, base) {
    if (typeof value !== 'string' || !value.trim()) throw new Error('Each pair needs wlCsv and openBarAnalysis file paths.');
    return resolve(base, value);
}
function canonicalJson(value) {
    if (Array.isArray(value)) return value.map(canonicalJson);
    if (value !== null && typeof value === 'object') {
        return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalJson(value[key])]));
    }
    return value;
}
function openBarMethodConfigSha256(rawText) {
    const root = JSON.parse(rawText);
    const provenance = root?.provenance ?? {};
    const derived = root?.derived ?? {};
    const kinematics = derived?.kinematics ?? {};
    const calibration = root?.calibration ?? {};
    const pipeline = provenance?.pipeline ?? {};
    const configuration = {
        schemaVersion: root?.schema_version ?? null,
        tracker: provenance?.tracker ? {
            ...provenance.tracker,
            implementation: {
                ...provenance.tracker.implementation,
                parameters: openBarTrackerMethodParameters(provenance.tracker.implementation.parameters ?? {}),
            },
        } : null,
        model: provenance?.model ?? null,
        filter: kinematics?.input === 'filtered' ? derived?.filtered?.filter ?? null : null,
        kinematics: { input: kinematics?.input ?? null, method: kinematics?.method ?? null },
        calibration: {
            method: calibration?.method ?? null,
            methodVersion: calibration?.method_version ?? null,
            coordinateConvention: calibration?.coordinate_convention ?? null,
            plateDiameterM: calibration?.scale?.diameter_m ?? null,
        },
        pipeline: { openbarVersion: pipeline?.openbar_version ?? null, gitCommit: pipeline?.git_commit ?? null },
    };
    return createHash('sha256').update(JSON.stringify(canonicalJson(configuration))).digest('hex');
}
async function exists(path) {
    try { await access(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
async function warnInsideWorktree(output) {
    // The output, rather than the caller's cwd, determines the privacy warning.
    let directory = dirname(output);
    while (!await exists(directory)) {
        const parent = dirname(directory);
        if (parent === directory) return;
        directory = parent;
    }
    try {
        const root = execFileSync('git', ['-C', await realpath(directory), 'rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
        const path = relative(root, await realpath(directory));
        if (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`)) {
            process.stderr.write('Warning: report output is inside the git worktree. Keep real lift inputs and reports private; do not commit them.\n');
        }
    } catch { /* Output outside a Git checkout is supported. */ }
}
async function protectInputs(outputs, inputs) {
    const normalize = path => process.platform === 'win32' ? path.toLowerCase() : path;
    const identities = new Set();
    const paths = new Set();
    for (const input of inputs) {
        paths.add(normalize(await realpath(input)));
        const info = await stat(input, { bigint: true });
        identities.add(`${info.dev}:${info.ino}`);
    }
    for (const output of outputs) {
        if (!await exists(output)) continue;
        const info = await stat(output, { bigint: true });
        if (paths.has(normalize(await realpath(output))) || identities.has(`${info.dev}:${info.ino}`)) {
            throw new Error('Report output would overwrite an input file. Choose a different basename.');
        }
        if (!info.isFile()) throw new Error('Report output must be a regular file.');
    }
}
async function main() {
    const options = argumentsFor(process.argv.slice(2));
    const pairsPath = resolve(options.pairs);
    let config;
    try { config = JSON.parse(await readFile(pairsPath, 'utf8')); } catch (error) {
        throw new Error(`Cannot read pairs JSON: ${error instanceof SyntaxError ? 'invalid JSON' : error.code ?? 'read failed'}.`);
    }
    if (!config || !Array.isArray(config.pairs) || config.pairs.length === 0) throw new Error('Pairs JSON needs a non-empty pairs array.');
    const labels = new Set();
    const inputs = [];
    for (const pair of config.pairs) {
        if (!pair || typeof pair.label !== 'string' || !pair.label.trim() || pair.label !== pair.label.trim() || /[\r\n]/.test(pair.label)) throw new Error('Each pair needs a non-empty, single-line label.');
        if (labels.has(pair.label)) throw new Error('Pair labels must be unique.');
        labels.add(pair.label);
        if (typeof pair.loadKg !== 'number' || !Number.isFinite(pair.loadKg) || pair.loadKg <= 0) throw new Error('Each pair needs a positive finite loadKg.');
        if (pair.offsetS !== undefined && (typeof pair.offsetS !== 'number' || !Number.isFinite(pair.offsetS))) throw new Error('offsetS must be finite.');
        const base = dirname(pairsPath);
        const [wlBytes, openBarBytes] = await Promise.all([
            readFile(sourcePath(pair.wlCsv, base)), readFile(sourcePath(pair.openBarAnalysis, base)),
        ]);
        const decode = bytes => new TextDecoder('utf8', { fatal: true }).decode(bytes);
        const wlText = decode(wlBytes);
        const openBarText = decode(openBarBytes);
        const wl = parseWlAnalysisCsv(wlText, options.segmentation === CONCENTRIC_SEGMENTATION_V1 ? WL_ANALYSIS_CSV_PARSER_V1 : WL_ANALYSIS_CSV_PARSER_V2);
        const openBar = parseOpenBarAnalysis(openBarText, options.segmentation);
        const hash = bytes => createHash('sha256').update(bytes).digest('hex');
        const rule = WL_PARSER_SEGMENTATION_RULE[wl.parserVersion];
        if (rule !== openBar.segmentationRule) throw new Error('Sources used different segmentation rules.');
        inputs.push({
            label: pair.label, loadKg: pair.loadKg, offsetS: pair.offsetS ?? 0,
            wl: { fileSha256: hash(wlBytes), parserVersion: wl.parserVersion, segmentationRule: rule, videoId: wl.videoId, reps: wl.reps },
            openBar: { fileSha256: hash(openBarBytes), parserVersion: openBar.parserVersion, segmentationRule: openBar.segmentationRule, sourceVideoSha256: openBar.sourceVideoSha256, methodConfigSha256: openBarMethodConfigSha256(openBarText), provenance: openBar.provenance, breakCount: openBar.breaks.length, reps: openBar.reps },
        });
    }
    const report = buildAgreementReport(inputs, { minOverlap: options.minOverlap });
    const output = resolve(options.output);
    const files = [`${output}.json`, `${output}.md`];
    if (!options.force && (await Promise.all(files.map(exists))).some(Boolean)) throw new Error('Report output already exists. Choose a new basename or use --force.');
    const inputFiles = [pairsPath, ...config.pairs.flatMap(pair => [sourcePath(pair.wlCsv, dirname(pairsPath)), sourcePath(pair.openBarAnalysis, dirname(pairsPath))])];
    await protectInputs(files, inputFiles);
    await warnInsideWorktree(output);
    await mkdir(dirname(output), { recursive: true });
    // Exclusive creation also guards a concurrent writer when --force is absent.
    await writeFile(files[0], report.json, { encoding: 'utf8', flag: options.force ? 'w' : 'wx' });
    await writeFile(files[1], report.markdown, { encoding: 'utf8', flag: options.force ? 'w' : 'wx' });
    process.stdout.write(`Wrote JSON and Markdown for ${inputs.length} video pair(s).\n`);
}
main().catch(error => { process.stderr.write(`${error instanceof Error ? error.message : 'Report failed.'}\n`); process.exitCode = 1; });
