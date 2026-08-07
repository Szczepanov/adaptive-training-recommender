import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer } from 'vite';

const inputPath = process.argv[2];
if (!inputPath) {
  console.error('Usage: npm run replay:recommendation -- <recommendation-audit.json>');
  process.exit(2);
}

const resolvedInput = resolve(inputPath);
if (!existsSync(resolvedInput)) {
  console.error(`Recommendation audit file not found: ${resolvedInput}`);
  process.exit(2);
}

let recommendation;
try {
  recommendation = JSON.parse(readFileSync(resolvedInput, 'utf8'));
} catch (error) {
  console.error(`Unable to parse recommendation audit JSON: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
}

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
  const { replayRecommendationAudit } = await server.ssrLoadModule('/src/engine/replay.ts');
  const result = replayRecommendationAudit(recommendation);
  console.log(JSON.stringify(result, null, 2));
  if (!result.reproducible) process.exitCode = 1;
} finally {
  await server.close();
}
