import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';

import { aggregateFamilySamples } from './aggregate.mjs';
import { formatFamilyForPacketVersion } from './packets.mjs';
import { generateFamilyResponseSchema, RESPONSE_SCHEMA_V1 } from './schema.mjs';
import { validateAndNormalizeJudgeRow } from './validation.mjs';

export const EXTERNAL_RUN_MANIFEST_SCHEMA = 'adaptive-training-recommender/ai-external-judge-run-manifest@1';
export const EXTERNAL_PACKET_VERSION = 'v2';
export const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_ARTIFACT_BYTES = 64 * 1024 * 1024;

const SUITE_CONFIG = {
  plan: {
    sourceDir: 'artifacts/ai-plan-judge/latest',
    outputDir: 'artifacts/ai-plan-judge/latest',
    runManifestSchema: 'adaptive-training-recommender/ai-plan-judge-run-manifest@1',
    stabilitySchema: 'adaptive-training-recommender/ai-plan-judge-stability@1',
    summarySchema: 'adaptive-training-recommender/ai-plan-judge-summary@3',
  },
  persona: {
    sourceDir: 'artifacts/persona-plan-judge/latest',
    hybridSourceDir: 'artifacts/hybrid-persona-plan-judge/latest',
    outputDir: 'artifacts/persona-plan-judge/latest',
    hybridOutputDir: 'artifacts/hybrid-persona-plan-judge/latest',
    runManifestSchema: 'adaptive-training-recommender/persona-plan-judge-run-manifest@1',
    stabilitySchema: 'adaptive-training-recommender/persona-plan-judge-stability@1',
    summarySchema: 'adaptive-training-recommender/persona-plan-judge-summary@1',
  },
};

function assertSuite(suite) {
  if (!SUITE_CONFIG[suite]) throw new Error(`Unsupported judge suite '${suite}'. Use 'plan' or 'persona'.`);
  return SUITE_CONFIG[suite];
}

function isRegularObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function hashBytes(value) {
  return createHash('sha256').update(value).digest('hex');
}

function hashJson(value) {
  return hashBytes(JSON.stringify(value));
}

const FORBIDDEN_UPLOAD_FIELD_NAMES = new Set([
  'apikey',
  'accesstoken',
  'refreshtoken',
  'authorization',
  'password',
  'clientsecret',
  'privatekey',
  'serviceaccount',
  'providerpayload',
  'rawproviderpayload',
  'rawhealthpayload',
  'rawgarminpayload',
  'garminrawpayload',
]);

function normalizedFieldName(value) {
  return String(value).replace(/[^A-Za-z0-9]/g, '').toLowerCase();
}

function assertUploadSafe(value, path = 'upload') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertUploadSafe(item, `${path}[${index}]`));
    return;
  }
  if (isRegularObject(value)) {
    for (const [key, child] of Object.entries(value)) {
      if (FORBIDDEN_UPLOAD_FIELD_NAMES.has(normalizedFieldName(key))) {
        throw new Error(`External judge upload contains forbidden sensitive field: ${path}.${key}`);
      }
      assertUploadSafe(child, `${path}.${key}`);
    }
    return;
  }
  if (typeof value === 'string'
    && (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(value)
      || /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/i.test(value))) {
    throw new Error(`External judge upload contains credential-like material at ${path}.`);
  }
}

function readBoundedText(path, maxBytes = MAX_ARTIFACT_BYTES) {
  const size = statSync(path).size;
  if (size > maxBytes) throw new Error(`File exceeds size limit (${maxBytes} bytes): ${path}`);
  return readFileSync(path, 'utf8');
}

export function readJsonObject(path, maxBytes = MAX_RESPONSE_BYTES) {
  if (!existsSync(path)) throw new Error(`Missing JSON file: ${path}`);
  const raw = readBoundedText(path, maxBytes);
  let value;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new Error(`${path} was not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isRegularObject(value)) throw new Error(`${path} must contain a regular JSON object, not an array or primitive.`);
  return value;
}

function parseJsonLines(path) {
  return readBoundedText(path).split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line, index) => {
    try {
      const value = JSON.parse(line);
      if (!isRegularObject(value)) throw new Error('line is not a regular JSON object');
      return value;
    } catch (error) {
      throw new Error(`${path}:${index + 1} was not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function safeFileName(value) {
  return String(value).replace(/[^A-Za-z0-9._-]+/g, '_');
}

function securePathWithin(root, relativePath) {
  if (typeof relativePath !== 'string' || relativePath.includes('\0')) throw new Error('Manifest contains an invalid package path.');
  const resolvedRoot = resolve(root);
  const resolved = resolve(resolvedRoot, relativePath);
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${sep}`)) {
    throw new Error(`Manifest path escapes package directory: ${relativePath}`);
  }

  try {
    if (lstatSync(resolvedRoot).isSymbolicLink()) throw new Error('Package root must not be a symlink.');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  let current = resolvedRoot;
  const parts = relative(resolvedRoot, resolved).split(/[\\/]/).filter(Boolean);
  for (const part of parts) {
    current = join(current, part);
    try {
      if (lstatSync(current).isSymbolicLink()) throw new Error(`Manifest path contains a symlink: ${relativePath}`);
    } catch (error) {
      if (error?.code === 'ENOENT') return resolved;
      throw error;
    }
  }

  const realRoot = realpathSync(resolvedRoot);
  const realPath = realpathSync(resolved);
  if (realPath !== realRoot && !realPath.startsWith(`${realRoot}${sep}`)) {
    throw new Error(`Manifest path resolves outside package directory: ${relativePath}`);
  }
  return resolved;
}

function relativePortable(from, path) {
  return relative(from, path).replaceAll('\\', '/');
}

function uploadSafeSourceArtifactDir(path) {
  const relativePath = relativePortable(resolve('.'), resolve(path));
  if (!relativePath || relativePath === '.') return '.';
  if (relativePath === '..' || relativePath.startsWith('../') || relativePath.startsWith('/') || /^[A-Za-z]:\//.test(relativePath)) {
    return 'external-source';
  }
  return relativePath;
}

function familyCaseIds(family) {
  if (!family || typeof family.familyId !== 'string' || !Array.isArray(family.cases) || family.cases.length === 0) {
    throw new Error('Malformed judge family: familyId and non-empty cases are required.');
  }
  const ids = family.cases.map((item) => item?.caseId ?? item?.input?.caseId);
  if (ids.some((id) => typeof id !== 'string' || !id.trim())) {
    throw new Error(`Family ${family.familyId} contains a missing caseId.`);
  }
  if (new Set(ids).size !== ids.length) throw new Error(`Family ${family.familyId} contains duplicate caseIds.`);
  return ids;
}

function loadSource({ suite, sourceDir }) {
  const config = assertSuite(suite);
  const root = resolve(sourceDir ?? config.sourceDir);
  const familiesPath = join(root, 'families.jsonl');
  const promptPath = join(root, 'judge-prompt.md');
  const corpusPath = join(root, 'corpus.json');
  for (const path of [familiesPath, promptPath, corpusPath]) {
    if (!existsSync(path)) throw new Error(`Missing deterministic ${suite} judge artifact: ${path}`);
  }

  const rawFamilies = parseJsonLines(familiesPath);
  const seen = new Set();
  const families = rawFamilies.map((family) => {
    if (seen.has(family.familyId)) throw new Error(`Duplicate familyId in corpus: ${family.familyId}`);
    seen.add(family.familyId);
    const caseIds = familyCaseIds(family);
    const packet = suite === 'plan' ? formatFamilyForPacketVersion(family, EXTERNAL_PACKET_VERSION) : family;
    assertUploadSafe(packet, `${suite}.${family.familyId}`);
    return { family, packet, caseIds };
  });

  const promptContent = readBoundedText(promptPath);
  assertUploadSafe(promptContent, `${suite}.prompt`);
  const corpusContent = readBoundedText(corpusPath);
  const corpus = JSON.parse(corpusContent);
  if (!isRegularObject(corpus) || typeof corpus.schema !== 'string') throw new Error(`Malformed corpus metadata: ${corpusPath}`);
  const sourceSchemaPath = join(root, 'judge-response-schema.json');
  const sourceSchemaSha256 = existsSync(sourceSchemaPath) ? hashBytes(readFileSync(sourceSchemaPath)) : null;
  const schemaByFamily = Object.fromEntries(families.map(({ family, caseIds }) => [
    family.familyId,
    generateFamilyResponseSchema(family.familyId, caseIds),
  ]));
  const familySchemasSha256 = hashJson(schemaByFamily);

  return {
    suite,
    root,
    familiesPath,
    promptPath,
    corpusPath,
    sourceSchemaPath: existsSync(sourceSchemaPath) ? sourceSchemaPath : null,
    promptContent,
    corpus,
    families,
    schemaByFamily,
    hashes: {
      corpusSha256: hashBytes(corpusContent),
      familiesSha256: hashBytes(readFileSync(familiesPath)),
      promptSha256: hashBytes(promptContent),
      responseSchemaSha256: sourceSchemaSha256 ?? familySchemasSha256,
      familySchemasSha256,
      sourceResponseSchemaSha256: sourceSchemaSha256,
    },
  };
}

function packagePath(root, relativePath) {
  return securePathWithin(root, relativePath);
}

export function buildExternalPackage({ suite, sourceDir, outputDir, packetVersion = EXTERNAL_PACKET_VERSION, variant = 'standard' } = {}) {
  assertSuite(suite);
  if (!['standard', 'hybrid_expansion'].includes(variant) || (variant === 'hybrid_expansion' && suite !== 'persona')) {
    throw new Error(`Unsupported external judge variant '${variant}' for suite '${suite}'.`);
  }
  if (packetVersion !== EXTERNAL_PACKET_VERSION) throw new Error(`Unsupported external packet version '${packetVersion}'.`);
  const source = loadSource({ suite, sourceDir });
  const packageDir = resolve(outputDir ?? `artifacts/external-judge/${suite}/latest`);
  for (const managedDir of ['packets', 'schemas', 'local-provenance', 'upload']) {
    rmSync(join(packageDir, managedDir), { recursive: true, force: true });
  }
  const responsesDir = join(packageDir, 'responses');
  try {
    if (lstatSync(responsesDir).isSymbolicLink()) rmSync(responsesDir, { force: true });
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  mkdirSync(join(packageDir, 'packets'), { recursive: true });
  mkdirSync(join(packageDir, 'schemas'), { recursive: true });
  mkdirSync(responsesDir, { recursive: true });
  mkdirSync(join(packageDir, 'local-provenance'), { recursive: true });
  writeFileSync(join(packageDir, 'prompt.md'), source.promptContent, 'utf8');
  writeFileSync(join(packageDir, 'local-provenance', 'families.jsonl'), readFileSync(source.familiesPath));
  writeFileSync(join(packageDir, 'local-provenance', 'corpus.json'), readFileSync(source.corpusPath));
  if (source.sourceSchemaPath) writeFileSync(join(packageDir, 'local-provenance', 'judge-response-schema.json'), readFileSync(source.sourceSchemaPath));

  const usedNames = new Set();
  const familyEntries = source.families.map(({ family, packet, caseIds }) => {
    const fileName = `${safeFileName(family.familyId)}.json`;
    if (usedNames.has(fileName)) throw new Error(`Family ids collide after filename sanitization: ${family.familyId}`);
    usedNames.add(fileName);
    const packetPath = join(packageDir, 'packets', fileName);
    const schemaPath = join(packageDir, 'schemas', fileName);
    const schema = source.schemaByFamily[family.familyId];
    writeJson(packetPath, packet);
    writeJson(schemaPath, schema);
    const packetSha256 = hashBytes(readFileSync(packetPath));
    const schemaSha256 = hashBytes(readFileSync(schemaPath));
    const responseBindingSha256 = hashJson({
      packetSha256,
      schemaSha256,
      promptSha256: source.hashes.promptSha256,
      responseSchema: RESPONSE_SCHEMA_V1,
    });
    return {
      familyId: family.familyId,
      caseIds,
      packetPath: `packets/${fileName}`,
      schemaPath: `schemas/${fileName}`,
      packetSha256,
      schemaSha256,
      responseBindingSha256,
      responsePath: `responses/${safeFileName(family.familyId)}-${responseBindingSha256}.json`,
    };
  });

  const manifest = {
    schema: EXTERNAL_RUN_MANIFEST_SCHEMA,
    suite,
    variant,
    suiteId: suite === 'plan' ? 'ai-plan-judge' : 'persona-plan-judge',
    packageVersion: 1,
    packetVersion,
    responseSchema: RESPONSE_SCHEMA_V1,
    generatedAt: new Date().toISOString(),
    privacy: {
      classification: 'synthetic-evaluation-package',
      containsCredentials: false,
      containsRawHealthPayloads: false,
      judgeView: 'blinded-to-planner-diagnostics',
      note: 'Upload only the generated upload/ directory (manifest.json, prompt.md, packets/, schemas/). responses/ and local-provenance/ are local-only and must never be uploaded. Do not add account exports, tokens, raw provider payloads, or prior judge responses.',
    },
    provenance: {
      sourceArtifactDir: uploadSafeSourceArtifactDir(source.root),
      corpusSchema: source.corpus.schema,
      corpusCommit: source.corpus.commit ?? 'unknown',
      canonicalBuilder: source.corpus.canonicalBuilder ?? (suite === 'plan' ? 'build-plan-judge-corpus.mjs' : 'run-persona-ai-judge.mjs --build-only'),
    },
    hashes: source.hashes,
    contractArtifacts: [
      { packagePath: 'local-provenance/families.jsonl', outputPath: 'families.jsonl', sha256: hashBytes(readFileSync(join(packageDir, 'local-provenance', 'families.jsonl'))) },
      { packagePath: 'local-provenance/corpus.json', outputPath: 'corpus.json', sha256: hashBytes(readFileSync(join(packageDir, 'local-provenance', 'corpus.json'))) },
      { packagePath: 'prompt.md', outputPath: 'judge-prompt.md', sha256: hashBytes(readFileSync(join(packageDir, 'prompt.md'))) },
      ...(source.sourceSchemaPath ? [{ packagePath: 'local-provenance/judge-response-schema.json', outputPath: 'judge-response-schema.json', sha256: hashBytes(readFileSync(join(packageDir, 'local-provenance', 'judge-response-schema.json'))) }] : []),
    ],
    families: familyEntries,
    instructions: {
      responseDirectory: 'responses/',
      responseFilePattern: '<familyId>-<responseBindingSha256>.json',
      responseContract: 'Each file must be one object matching its family schema exactly.',
    },
  };

  const expectedResponseFiles = new Set(familyEntries.map((entry) => basename(entry.responsePath)));
  for (const fileName of readdirSync(responsesDir)) {
    if (extname(fileName).toLowerCase() === '.json' && !expectedResponseFiles.has(fileName)) {
      rmSync(join(responsesDir, fileName), { recursive: true, force: true });
    }
  }

  writeJson(join(packageDir, 'manifest.json'), manifest);

  const uploadDir = join(packageDir, 'upload');
  mkdirSync(join(uploadDir, 'packets'), { recursive: true });
  mkdirSync(join(uploadDir, 'schemas'), { recursive: true });
  copyFileSync(join(packageDir, 'manifest.json'), join(uploadDir, 'manifest.json'));
  copyFileSync(join(packageDir, 'prompt.md'), join(uploadDir, 'prompt.md'));
  for (const entry of familyEntries) {
    copyFileSync(join(packageDir, entry.packetPath), join(uploadDir, entry.packetPath));
    copyFileSync(join(packageDir, entry.schemaPath), join(uploadDir, entry.schemaPath));
  }

  return manifest;
}

function validateManifest(manifest, packageDir, expectedSuite) {
  if (manifest.schema !== EXTERNAL_RUN_MANIFEST_SCHEMA) throw new Error(`Unsupported external run manifest schema: ${JSON.stringify(manifest.schema)}`);
  if (manifest.packageVersion !== 1) throw new Error(`Unsupported external package version: ${JSON.stringify(manifest.packageVersion)}`);
  if (expectedSuite && manifest.suite !== expectedSuite) throw new Error(`Package suite mismatch: expected ${expectedSuite}, got ${manifest.suite}.`);
  assertSuite(manifest.suite);
  if (!['standard', 'hybrid_expansion'].includes(manifest.variant)
    || (manifest.variant === 'hybrid_expansion' && manifest.suite !== 'persona')) {
    throw new Error(`Unsupported external package variant: ${JSON.stringify(manifest.variant)}`);
  }
  if (manifest.packetVersion !== EXTERNAL_PACKET_VERSION || manifest.responseSchema !== RESPONSE_SCHEMA_V1) {
    throw new Error('External package contract mismatch: packet or response schema version differs.');
  }
  if (!isRegularObject(manifest.privacy)
    || manifest.privacy.containsCredentials !== false
    || manifest.privacy.containsRawHealthPayloads !== false) {
    throw new Error('External package privacy contract mismatch.');
  }
  const requiredHashKeys = ['promptSha256', 'corpusSha256', 'familiesSha256', 'familySchemasSha256', 'responseSchemaSha256'];
  if (!isRegularObject(manifest.hashes)
    || requiredHashKeys.some((key) => !/^[a-f0-9]{64}$/.test(manifest.hashes[key] ?? ''))
    || (manifest.hashes.sourceResponseSchemaSha256 != null && !/^[a-f0-9]{64}$/.test(manifest.hashes.sourceResponseSchemaSha256))) {
    throw new Error('External package manifest is missing or contains malformed provenance hashes.');
  }
  if (!Array.isArray(manifest.contractArtifacts)) throw new Error('External package is missing contract artifacts.');
  for (const requiredPath of ['local-provenance/families.jsonl', 'local-provenance/corpus.json', 'prompt.md']) {
    if (!manifest.contractArtifacts.some((artifact) => artifact?.packagePath === requiredPath)) {
      throw new Error(`External package is missing required contract artifact: ${requiredPath}`);
    }
  }
  if (!Array.isArray(manifest.families) || manifest.families.length === 0) throw new Error('External package contains no families.');
  const seen = new Set();
  for (const family of manifest.families) {
    if (!isRegularObject(family) || typeof family.familyId !== 'string' || !Array.isArray(family.caseIds)) throw new Error('Malformed family entry in external package manifest.');
    if (seen.has(family.familyId)) throw new Error(`Duplicate family in external package manifest: ${family.familyId}`);
    seen.add(family.familyId);
    if (new Set(family.caseIds).size !== family.caseIds.length || family.caseIds.some((id) => typeof id !== 'string' || !id.trim())) throw new Error(`Malformed case ids for family ${family.familyId}.`);
    for (const key of ['packetPath', 'schemaPath', 'packetSha256', 'schemaSha256', 'responseBindingSha256', 'responsePath']) {
      if (typeof family[key] !== 'string' || !family[key]) throw new Error(`Family ${family.familyId} is missing ${key}.`);
    }
    if (!/^[a-f0-9]{64}$/.test(family.packetSha256)
      || !/^[a-f0-9]{64}$/.test(family.schemaSha256)
      || !/^[a-f0-9]{64}$/.test(family.responseBindingSha256)) {
      throw new Error(`Family ${family.familyId} contains a malformed packet/schema/response-binding hash.`);
    }
    if (!/^packets\/[^/]+\.json$/.test(family.packetPath) || !/^schemas\/[^/]+\.json$/.test(family.schemaPath)) {
      throw new Error(`Family ${family.familyId} packet/schema paths must be direct JSON children of their package directories.`);
    }
    if (!/^responses\/[^/]+\.json$/.test(family.responsePath)) {
      throw new Error(`Family ${family.familyId} responsePath must be a direct JSON child of responses/.`);
    }
  }
  const promptPath = packagePath(packageDir, 'prompt.md');
  if (hashBytes(readFileSync(promptPath)) !== manifest.hashes.promptSha256) throw new Error('External package prompt hash mismatch.');
}

function readContractArtifacts(manifest, packageDir) {
  const artifacts = new Map();
  const packageContents = new Map();
  const expectedOutputs = new Map([
    ['local-provenance/families.jsonl', 'families.jsonl'],
    ['local-provenance/corpus.json', 'corpus.json'],
    ['local-provenance/judge-response-schema.json', 'judge-response-schema.json'],
    ['prompt.md', 'judge-prompt.md'],
  ]);
  const seenPackagePaths = new Set();
  const seenOutputPaths = new Set();
  for (const artifact of manifest.contractArtifacts) {
    if (!isRegularObject(artifact) || typeof artifact.packagePath !== 'string' || typeof artifact.outputPath !== 'string' || !/^[a-f0-9]{64}$/.test(artifact.sha256 ?? '')) {
      throw new Error('Malformed contract artifact entry in external package manifest.');
    }
    const expectedOutput = expectedOutputs.get(artifact.packagePath);
    if (!expectedOutput || artifact.outputPath !== expectedOutput) {
      throw new Error(`Unexpected contract artifact mapping: ${artifact.packagePath} -> ${artifact.outputPath}`);
    }
    if (seenPackagePaths.has(artifact.packagePath) || seenOutputPaths.has(artifact.outputPath)) {
      throw new Error(`Duplicate contract artifact mapping: ${artifact.packagePath} -> ${artifact.outputPath}`);
    }
    seenPackagePaths.add(artifact.packagePath);
    seenOutputPaths.add(artifact.outputPath);
    const path = packagePath(packageDir, artifact.packagePath);
    const content = readBoundedText(path);
    const contentHash = hashBytes(Buffer.from(content));
    if (contentHash !== artifact.sha256) throw new Error(`Contract artifact hash mismatch: ${artifact.packagePath}`);
    packageContents.set(artifact.packagePath, contentHash);
    artifacts.set(artifact.outputPath, content);
  }
  const expectedManifestHashes = new Map([
    ['local-provenance/families.jsonl', manifest.hashes.familiesSha256],
    ['local-provenance/corpus.json', manifest.hashes.corpusSha256],
    ['prompt.md', manifest.hashes.promptSha256],
    ['local-provenance/judge-response-schema.json', manifest.hashes.responseSchemaSha256],
  ]);
  if (manifest.hashes.sourceResponseSchemaSha256 && !packageContents.has('local-provenance/judge-response-schema.json')) {
    throw new Error('External package is missing the local source response schema artifact.');
  }
  for (const [packagePathName, expectedHash] of expectedManifestHashes) {
    if (expectedHash && packageContents.has(packagePathName) && packageContents.get(packagePathName) !== expectedHash) {
      throw new Error(`Manifest hash mismatch for local contract artifact: ${packagePathName}`);
    }
  }
  return artifacts;
}

function packageFamilyContracts(manifest, packageDir) {
  const contracts = manifest.families.map((entry) => {
    const packetPath = packagePath(packageDir, entry.packetPath);
    const schemaPath = packagePath(packageDir, entry.schemaPath);
    if (hashBytes(readFileSync(packetPath)) !== entry.packetSha256) throw new Error(`Family ${entry.familyId} packet hash mismatch.`);
    if (hashBytes(readFileSync(schemaPath)) !== entry.schemaSha256) throw new Error(`Family ${entry.familyId} schema hash mismatch.`);
    const packet = readJsonObject(packetPath, MAX_ARTIFACT_BYTES);
    const schema = readJsonObject(schemaPath, MAX_ARTIFACT_BYTES);
    const packetIds = familyCaseIds(packet);
    const expectedIds = entry.caseIds;
    if (packet.familyId !== entry.familyId || JSON.stringify(packetIds) !== JSON.stringify(expectedIds)) {
      throw new Error(`Family ${entry.familyId} packet contract mismatch.`);
    }
    if (schema.properties?.familyId?.const !== entry.familyId) throw new Error(`Family ${entry.familyId} response schema contract mismatch.`);
    const expectedResponseBindingSha256 = hashJson({
      packetSha256: entry.packetSha256,
      schemaSha256: entry.schemaSha256,
      promptSha256: manifest.hashes.promptSha256,
      responseSchema: manifest.responseSchema,
    });
    if (entry.responseBindingSha256 !== expectedResponseBindingSha256) {
      throw new Error(`Family ${entry.familyId} response binding does not match the packet/schema/prompt contract.`);
    }
    const expectedResponseName = `${safeFileName(entry.familyId)}-${entry.responseBindingSha256}.json`;
    if (basename(entry.responsePath) !== expectedResponseName) throw new Error(`Family ${entry.familyId} response filename is not bound to its full evaluation contract.`);
    return { entry, packet, schema };
  });
  const schemaContractHash = hashJson(Object.fromEntries(contracts.map(({ entry, schema }) => [entry.familyId, schema])));
  if (manifest.hashes.familySchemasSha256 !== schemaContractHash) throw new Error('External package family schema hash mismatch.');
  return contracts;
}

function summaryFor(suite, rows, stability, manifest, outputDir) {
  const cases = rows.flatMap((row) => row.caseScores.map((item) => ({ familyId: row.familyId, ...item })));
  const dimensions = ['safety_recovery_fit', 'goal_event_fit', 'sequencing', 'periodization_taper', 'preference_capacity_fit', 'robustness', 'overall'];
  const average = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  const summary = {
    schema: SUITE_CONFIG[suite].summarySchema,
    source: relativePortable(resolve('.'), join(outputDir, 'judge-scores.jsonl')),
    provenance: {
      corpusCommit: manifest.corpusCommit,
      corpusSchema: manifest.corpusSchema,
      corpusSha256: manifest.corpusSha256,
      familiesSha256: manifest.familiesSha256,
      promptSha256: manifest.promptSha256,
      responseSchemaSha256: manifest.responseSchemaSha256,
      judgeScoresSha256: hashBytes(readFileSync(join(outputDir, 'judge-scores.jsonl'))),
      judgeModel: manifest.judgeModel,
      judgeProvider: manifest.judgeProvider,
      analyzedAt: manifest.completedAt,
    },
    familyCount: rows.length,
    caseCount: cases.length,
    scoreAverages: Object.fromEntries(dimensions.map((key) => [key, average(cases.map((item) => item.scores[key]))])),
    meanSensitivityQuality: average(rows.map((row) => row.familyAssessment.sensitivity_quality)),
    familySensitivity: rows.map((row) => ({ familyId: row.familyId, sensitivityQuality: row.familyAssessment.sensitivity_quality })),
    judgeStability: stability,
  };
  writeJson(join(outputDir, 'judge-summary.json'), summary);
  writeFileSync(join(outputDir, 'judge-summary.md'), `# External ${suite} judge summary\n\n- Families scored: ${summary.familyCount}\n- Cases scored: ${summary.caseCount}\n- Provider/model: ${manifest.judgeProvider}/${manifest.judgeModel}\n`, 'utf8');
  writeJson(join(outputDir, 'judge-run-provenance.json'), summary.provenance);
}

export function importExternalRun({ packageDir, responsesDir, outputDir, model = 'external-manual-unknown', expectedSuite } = {}) {
  const packageRoot = resolve(packageDir ?? '.');
  const manifestPath = securePathWithin(packageRoot, 'manifest.json');
  const manifest = readJsonObject(manifestPath, MAX_RESPONSE_BYTES);
  validateManifest(manifest, packageRoot, expectedSuite);
  const contractArtifacts = readContractArtifacts(manifest, packageRoot);
  const contracts = packageFamilyContracts(manifest, packageRoot);
  const responseRoot = resolve(responsesDir ?? join(packageRoot, 'responses'));
  const responseFiles = existsSync(responseRoot)
    ? readdirSync(responseRoot).filter((name) => extname(name).toLowerCase() === '.json')
    : [];
  const expectedByFileName = new Map(contracts.map(({ entry }) => [basename(entry.responsePath), entry]));
  const responses = new Map();
  const responseProvenance = [];

  for (const fileName of responseFiles) {
    const entry = expectedByFileName.get(fileName);
    if (!entry) throw new Error(`Unknown or stale response filename: ${fileName}`);
    const path = securePathWithin(responseRoot, fileName);
    const response = readJsonObject(path, MAX_RESPONSE_BYTES);
    if (response.familyId !== entry.familyId) throw new Error(`Response familyId mismatch for ${fileName}: expected ${entry.familyId}, got ${response.familyId ?? 'missing'}.`);
    if (responses.has(response.familyId)) throw new Error(`Duplicate response for family ${response.familyId}.`);
    const normalized = validateAndNormalizeJudgeRow(response, response.familyId, entry.caseIds);
    responses.set(response.familyId, normalized);
    responseProvenance.push({
      familyId: response.familyId,
      path: relativePortable(packageRoot, path),
      sha256: hashBytes(readFileSync(path)),
      bytes: statSync(path).size,
    });
  }

  const missing = manifest.families.map((entry) => entry.familyId).filter((familyId) => !responses.has(familyId));
  if (missing.length) throw new Error(`Missing response for family/families: ${missing.join(', ')}`);

  const config = assertSuite(manifest.suite);
  const rows = [];
  const stabilityRows = [];
  const sampleRows = [];
  for (const { entry } of contracts) {
    const result = responses.get(entry.familyId);
    const aggregated = aggregateFamilySamples(entry.familyId, [{ sampleIndex: 0, seed: null, result, telemetry: null }], entry.caseIds);
    rows.push(aggregated.aggregateResult);
    stabilityRows.push(aggregated.stability);
    sampleRows.push({ familyId: entry.familyId, sampleIndex: 0, seed: null, result, telemetry: null });
  }

  const defaultOutputDir = manifest.suite === 'persona' && manifest.variant === 'hybrid_expansion'
    ? config.hybridOutputDir
    : config.outputDir;
  const destination = resolve(outputDir ?? defaultOutputDir);
  mkdirSync(destination, { recursive: true });
  for (const [outputName, content] of contractArtifacts) {
    const target = resolve(destination, outputName);
    if (target !== destination && !target.startsWith(`${destination}${sep}`)) throw new Error(`Contract artifact output path escapes the suite directory: ${outputName}`);
    writeFileSync(target, content, 'utf8');
  }
  writeFileSync(join(destination, 'judge-scores.jsonl'), `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8');
  writeFileSync(join(destination, 'judge-samples.jsonl'), `${sampleRows.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8');
  const stability = manifest.suite === 'plan'
    ? { schema: config.stabilitySchema, samples: 1, familiesCount: stabilityRows.length, maxContextUtilization: 0, totalPromptTokens: 0, totalCompletionTokens: 0, families: stabilityRows }
    : stabilityRows;
  writeJson(join(destination, 'judge-stability.json'), stability);

  const completedManifest = {
    schema: config.runManifestSchema,
    suite: manifest.suite,
    variant: manifest.variant,
    judgeModel: model,
    judgeProvider: 'manual_external',
    corpusCommit: manifest.provenance?.corpusCommit ?? 'unknown',
    corpusSchema: manifest.provenance?.corpusSchema ?? 'unknown',
    samples: 1,
    packetVersion: manifest.packetVersion,
    responseSchema: manifest.responseSchema,
    familiesSha256: manifest.hashes.familiesSha256,
    corpusSha256: manifest.hashes.corpusSha256,
    promptSha256: manifest.hashes.promptSha256,
    responseSchemaSha256: manifest.hashes.responseSchemaSha256,
    completedAt: new Date().toISOString(),
    completedFamilies: rows.length,
    externalRunManifestSha256: hashBytes(readFileSync(manifestPath)),
    externalResponses: responseProvenance,
    provenance: {
      sourcePackage: relativePortable(resolve('.'), packageRoot),
      privacy: manifest.privacy,
      note: 'Manual external evaluation; raw response hashes and paths are retained only in this run manifest.',
    },
  };
  writeJson(join(destination, 'judge-run-manifest.json'), completedManifest);
  summaryFor(manifest.suite, rows, stability, {
    ...completedManifest,
    corpusCommit: manifest.provenance?.corpusCommit ?? 'unknown',
    corpusSchema: manifest.provenance?.corpusSchema ?? 'unknown',
    familiesSha256: manifest.hashes.familiesSha256,
    promptSha256: manifest.hashes.promptSha256,
    responseSchemaSha256: manifest.hashes.responseSchemaSha256,
  }, destination);
  return { manifest: completedManifest, rows, stability, outputDir: destination };
}

export function suiteConfig(suite) {
  return assertSuite(suite);
}
