import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const outputDir = resolve('artifacts/visual-review/latest');
const entriesPath = resolve(outputDir, 'entries.ndjson');
const entries = existsSync(entriesPath)
  ? readFileSync(entriesPath, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))
  : [];
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const capturedAt = new Date().toISOString();

const manifest = { commit, capturedAt, screenshots: entries };
writeFileSync(resolve(outputDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

const scenarioNotes = entries.map((entry) => `- **${entry.id}** — ${entry.scenarioTitle}\n  - ${entry.expectedFocus.join('\n  - ')}`).join('\n');
writeFileSync(resolve(outputDir, 'review-context.md'), `# Adaptive Coach visual review\n\n- Commit: \`${commit}\`\n- Captured: ${capturedAt}\n- Viewports: desktop 1440×1000; mobile 390×844\n- Locale/timezone: en-US / Europe/Warsaw\n- Data: synthetic fixtures only; no Garmin or Firebase data\n\n## Review rubric\n\nAssess hierarchy, scanability, spacing, action clarity, responsive behavior, interaction states, and accessibility cues. Treat the fixture copy and scenario labels as intentional; report layout and product-design recommendations separately.\n\n## Screenshot intent\n\n${scenarioNotes}\n`);

const tiles = entries.map((entry) => `<figure><img src="${entry.path}" alt="${entry.id}"><figcaption><strong>${entry.id}</strong><br>${entry.scenarioTitle}</figcaption></figure>`).join('\n');
writeFileSync(resolve(outputDir, 'contact-sheet.html'), `<!doctype html><html><head><meta charset="utf-8"><title>Adaptive Coach visual review</title><style>body{font-family:system-ui;background:#0f172a;color:#f8fafc;margin:24px}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:20px}figure{margin:0;background:#1e293b;padding:12px;border-radius:12px}img{width:100%;height:auto;border-radius:8px;border:1px solid #475569}figcaption{margin-top:8px;color:#cbd5e1;font-size:14px}</style></head><body><h1>Adaptive Coach visual review</h1><p>Commit ${commit}</p><main>${tiles}</main></body></html>`);
rmSync(entriesPath, { force: true });
