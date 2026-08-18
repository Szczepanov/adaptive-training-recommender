import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer } from 'vite';

const [inputPath, planPath] = process.argv.slice(2);
if (!inputPath) {
  console.error('Usage: npm run replay:recommendation -- <recommendation-audit.json> [external-plan-revision.json]');
  console.error('An external decision needs the plan revision it names; without it the replay reports why.');
  console.error('M3.2: a decision carrying primarySession/additionalSessions bindings needs a live Firestore');
  console.error('read (replayRecommendationAuditAgainstSessions) that this offline CLI does not perform; it');
  console.error('will report those bindings as "not supplied" rather than verify them.');
  process.exit(2);
}

function readJson(path, label) {
  const resolved = resolve(path);
  if (!existsSync(resolved)) {
    console.error(`${label} file not found: ${resolved}`);
    process.exit(2);
  }
  try {
    return JSON.parse(readFileSync(resolved, 'utf8'));
  } catch (error) {
    console.error(`Unable to parse ${label} JSON: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(2);
  }
}

const recommendation = readJson(inputPath, 'Recommendation audit');
const plan = planPath ? readJson(planPath, 'External plan revision') : null;

// Engine files use bundler-style extensionless imports. Vite's SSR loader resolves
// them exactly as the app and Vitest do, without changing production source imports.
const server = await createServer({
  configFile: false,
  root: resolve('.'),
  logLevel: 'warn',
  server: { middlewareMode: true },
  appType: 'custom',
});

try {
  const { replayRecommendationAuditAgainstRevision } = await server.ssrLoadModule('/src/engine/replay.ts');
  // Always the hashing wrapper: the hash must be recomputed from the supplied bytes, never
  // read back out of the audit that is being checked.
  const result = await replayRecommendationAuditAgainstRevision(recommendation, plan);
  console.log(JSON.stringify(result, null, 2));
  if (!result.reproducible) process.exitCode = 1;
} finally {
  await server.close();
}
