import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const outputDir = resolve('artifacts/visual-review/latest');
rmSync(outputDir, { recursive: true, force: true });
mkdirSync(outputDir, { recursive: true });
writeFileSync(resolve(outputDir, 'entries.ndjson'), '');
