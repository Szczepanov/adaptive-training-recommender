import fs from 'node:fs';

const path = 'scripts/apply-multisport-patch.mjs';
const source = fs.readFileSync(path, 'utf8');
const startMarker = 'function addEquipmentToOutdoorCyclingTemplates(path) {';
const endMarker = '\n}\n\n// ---------------------------------------------------------------------------\n// Domain model';
const start = source.indexOf(startMarker);
const endStart = source.indexOf(endMarker, start);
if (start < 0 || endStart < 0) throw new Error('Could not locate transformer function');
const end = endStart + 2;

const replacement = String.raw`function findContainingObject(source, index) {
  const start = source.lastIndexOf('{', index);
  if (start < 0) throw new Error('Could not locate template object start');
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let i = start; i < source.length; i += 1) {
    const char = source[i];
    if (quote !== null) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return { start, end: i + 1 };
    }
  }
  throw new Error('Could not locate template object end');
}

function nextCyclingModalityIndex(source, cursor) {
  const indexes = [
    source.indexOf('modality: "Cycling"', cursor),
    source.indexOf("modality: 'Cycling'", cursor),
  ].filter(index => index >= 0);
  return indexes.length === 0 ? -1 : Math.min(...indexes);
}

function addEquipmentToOutdoorCyclingTemplates(path) {
  let source = read(path);
  let cursor = 0;
  let patched = 0;
  while (cursor < source.length) {
    const modalityIndex = nextCyclingModalityIndex(source, cursor);
    if (modalityIndex < 0) break;
    const bounds = findContainingObject(source, modalityIndex);
    let block = source.slice(bounds.start, bounds.end);
    const isOutdoor = block.includes("environment: 'outdoor'") || block.includes('environment: "outdoor"');
    if (isOutdoor && !block.includes('outdoor_bike')) {
      if (block.includes('requiredEquipment: []')) {
        block = block.replace('requiredEquipment: []', "requiredEquipment: ['outdoor_bike']");
      } else if (block.includes('requiredEquipment: [')) {
        block = block.replace('requiredEquipment: [', "requiredEquipment: ['outdoor_bike', ");
      } else {
        throw new Error('Outdoor cycling template lacks requiredEquipment: ' + block.slice(0, 180));
      }
      source = source.slice(0, bounds.start) + block + source.slice(bounds.end);
      patched += 1;
    }
    cursor = bounds.start + block.length;
  }
  if (patched === 0) throw new Error('No outdoor cycling templates received outdoor_bike gating');
  write(path, source);

  const after = read(path);
  cursor = 0;
  while (cursor < after.length) {
    const modalityIndex = nextCyclingModalityIndex(after, cursor);
    if (modalityIndex < 0) break;
    const bounds = findContainingObject(after, modalityIndex);
    const block = after.slice(bounds.start, bounds.end);
    if ((block.includes("environment: 'outdoor'") || block.includes('environment: "outdoor"')) && !block.includes('outdoor_bike')) {
      throw new Error('Outdoor cycling template is still ungated: ' + block.slice(0, 180));
    }
    cursor = bounds.end;
  }
}`;

fs.writeFileSync(path, source.slice(0, start) + replacement + source.slice(end));
console.log('Hardened multisport transformer object matching.');
