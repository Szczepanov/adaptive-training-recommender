import fs from 'node:fs';

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

function write(path, content) {
  fs.writeFileSync(path, content);
}

function replaceOnce(path, from, to) {
  const source = read(path);
  const index = source.indexOf(from);
  if (index < 0) throw new Error(`Missing replacement anchor in ${path}: ${from.slice(0, 120)}`);
  write(path, source.slice(0, index) + to + source.slice(index + from.length));
}

function insertBeforeAfter(path, anchor, marker, addition) {
  const source = read(path);
  const anchorIndex = source.indexOf(anchor);
  if (anchorIndex < 0) throw new Error(`Missing section anchor in ${path}: ${anchor}`);
  const markerIndex = source.indexOf(marker, anchorIndex);
  if (markerIndex < 0) throw new Error(`Missing insertion marker in ${path}: ${marker}`);
  write(path, source.slice(0, markerIndex) + addition + source.slice(markerIndex));
}

function addEquipmentToOutdoorCyclingTemplates(path) {
  let source = read(path);
  let cursor = 0;
  let patched = 0;
  while (cursor < source.length) {
    const doubleIndex = source.indexOf('modality: "Cycling"', cursor);
    const singleIndex = source.indexOf("modality: 'Cycling'", cursor);
    const candidates = [doubleIndex, singleIndex].filter(index => index >= 0);
    if (candidates.length === 0) break;
    const modalityIndex = Math.min(...candidates);
    const start = source.lastIndexOf('\n    {', modalityIndex);
    const end = source.indexOf('\n    },', modalityIndex);
    if (start < 0 || end < 0) throw new Error('Could not isolate cycling template');
    let block = source.slice(start, end + '\n    },'.length);
    const isOutdoor = block.includes("environment: 'outdoor'") || block.includes('environment: "outdoor"');
    if (isOutdoor) {
      if (block.includes("'outdoor_bike'")) {
        // Already patched.
      } else if (block.includes('requiredEquipment: []')) {
        block = block.replace('requiredEquipment: []', "requiredEquipment: ['outdoor_bike']");
        source = source.slice(0, start) + block + source.slice(end + '\n    },'.length);
        patched += 1;
      } else if (block.includes('requiredEquipment: [')) {
        block = block.replace('requiredEquipment: [', "requiredEquipment: ['outdoor_bike', ");
        source = source.slice(0, start) + block + source.slice(end + '\n    },'.length);
        patched += 1;
      } else {
        throw new Error(`Outdoor cycling template lacks requiredEquipment: ${block.slice(0, 160)}`);
      }
    }
    cursor = start + block.length;
  }
  if (patched === 0) throw new Error('No outdoor cycling templates received outdoor_bike gating');
  write(path, source);

  const after = read(path);
  cursor = 0;
  while (cursor < after.length) {
    const doubleIndex = after.indexOf('modality: "Cycling"', cursor);
    const singleIndex = after.indexOf("modality: 'Cycling'", cursor);
    const candidates = [doubleIndex, singleIndex].filter(index => index >= 0);
    if (candidates.length === 0) break;
    const modalityIndex = Math.min(...candidates);
    const start = after.lastIndexOf('\n    {', modalityIndex);
    const end = after.indexOf('\n    },', modalityIndex);
    const block = after.slice(start, end + '\n    },'.length);
    if ((block.includes("environment: 'outdoor'") || block.includes('environment: "outdoor"')) && !block.includes('outdoor_bike')) {
      throw new Error(`Outdoor cycling template is still ungated: ${block.slice(0, 180)}`);
    }
    cursor = end + 6;
  }
}

// ---------------------------------------------------------------------------
// Domain model: Swimming is executable; outdoor bicycle and swim access are hard gates.
// New access keys remain optional in the TypeScript storage shape so historical fixtures
// and persisted v2/v3 profiles are source-compatible; the parser materializes false.
// ---------------------------------------------------------------------------
replaceOnce(
  'app/src/engine/models.ts',
  "export type ExternalSessionModality = 'cycling' | 'running' | 'strength' | 'field' | 'mobility' | 'cross_training';",
  "export type ExternalSessionModality = 'cycling' | 'running' | 'swimming' | 'strength' | 'field' | 'mobility' | 'cross_training';",
);
replaceOnce(
  'app/src/engine/models.ts',
  "    modality: 'Running' | 'Cycling' | 'Strength' | 'Field' | 'Mobility' | 'Cross Training' | 'None';",
  "    modality: 'Running' | 'Cycling' | 'Swimming' | 'Strength' | 'Field' | 'Mobility' | 'Cross Training' | 'None';",
);
replaceOnce(
  'app/src/engine/models.ts',
  "export type EquipmentKey = 'free_weights' | 'cable_machine' | 'treadmill' | 'indoor_bike' | 'pullup_bar';",
  "export type LegacyEquipmentKey = 'free_weights' | 'cable_machine' | 'treadmill' | 'indoor_bike' | 'pullup_bar';\nexport type SportAccessKey = 'outdoor_bike' | 'swim_access';\nexport type EquipmentKey = LegacyEquipmentKey | SportAccessKey;",
);
replaceOnce(
  'app/src/engine/models.ts',
  "    equipment: Record<EquipmentKey, boolean>;",
  "    equipment: Record<LegacyEquipmentKey, boolean> & Partial<Record<SportAccessKey, boolean>>;",
);
replaceOnce(
  'app/src/engine/models.ts',
  "     *  matching template in the catalog (e.g. 'Swimming') simply can't be honored; the\n     *  engine says so in the rationale rather than silently ignoring it. */",
  "     *  matching template in the catalog simply can't be honored; the engine says so in\n     *  the rationale rather than silently ignoring it. */",
);

// ---------------------------------------------------------------------------
// Training settings: additive/backward-compatible parsing + explicit UI access controls.
// ---------------------------------------------------------------------------
replaceOnce(
  'app/src/services/trainingSettingsService.ts',
  "const equipmentKeys = ['free_weights', 'cable_machine', 'treadmill', 'indoor_bike', 'pullup_bar'] as const;",
  "const requiredEquipmentKeys = ['free_weights', 'cable_machine', 'treadmill', 'indoor_bike', 'pullup_bar'] as const;\nconst additiveEquipmentKeys = ['outdoor_bike', 'swim_access'] as const;",
);
replaceOnce(
  'app/src/services/trainingSettingsService.ts',
  "const validModalities: SessionTemplate['modality'][] = ['Running', 'Cycling', 'Strength', 'Field', 'Mobility', 'Cross Training', 'None'];",
  "const validModalities: SessionTemplate['modality'][] = ['Running', 'Cycling', 'Swimming', 'Strength', 'Field', 'Mobility', 'Cross Training', 'None'];",
);
replaceOnce(
  'app/src/services/trainingSettingsService.ts',
  "        equipment: { free_weights: false, cable_machine: false, treadmill: false, indoor_bike: false, pullup_bar: false },",
  "        equipment: { free_weights: false, cable_machine: false, treadmill: false, indoor_bike: false, pullup_bar: false, outdoor_bike: false, swim_access: false },",
);
replaceOnce(
  'app/src/services/trainingSettingsService.ts',
  "    if (!equipmentKeys.every(key => typeof equipment[key] === 'boolean')) return null;",
  "    if (!requiredEquipmentKeys.every(key => typeof equipment[key] === 'boolean')) return null;\n    if (!additiveEquipmentKeys.every(key => equipment[key] === undefined || typeof equipment[key] === 'boolean')) return null;",
);
replaceOnce(
  'app/src/services/trainingSettingsService.ts',
  "    return {\n        ...(data as unknown as TrainingSettings),\n        schemaVersion: CURRENT_TRAINING_SETTINGS_SCHEMA_VERSION,\n        injuries: (data.injuries as TrainingSettings['injuries']) ?? [],\n    };",
  "    return {\n        ...(data as unknown as TrainingSettings),\n        schemaVersion: CURRENT_TRAINING_SETTINGS_SCHEMA_VERSION,\n        equipment: {\n            free_weights: equipment.free_weights as boolean,\n            cable_machine: equipment.cable_machine as boolean,\n            treadmill: equipment.treadmill as boolean,\n            indoor_bike: equipment.indoor_bike as boolean,\n            pullup_bar: equipment.pullup_bar as boolean,\n            // Additive sport-access fields are fail-safe for historical settings: unknown\n            // access never becomes permission to prescribe an outdoor ride or pool swim.\n            outdoor_bike: typeof equipment.outdoor_bike === 'boolean' ? equipment.outdoor_bike : false,\n            swim_access: typeof equipment.swim_access === 'boolean' ? equipment.swim_access : false,\n        },\n        injuries: (data.injuries as TrainingSettings['injuries']) ?? [],\n    };",
);

replaceOnce(
  'app/src/components/TrainingSettings.tsx',
  "  pullup_bar: 'Pull-up bar',\n};",
  "  pullup_bar: 'Pull-up bar',\n  outdoor_bike: 'Bicycle (outdoor)',\n  swim_access: 'Pool / swim access',\n};",
);
replaceOnce(
  'app/src/components/TrainingSettings.tsx',
  "const injuryModalities: SessionTemplate['modality'][] = ['Running', 'Cycling', 'Strength', 'Field', 'Mobility', 'Cross Training'];",
  "const injuryModalities: SessionTemplate['modality'][] = ['Running', 'Cycling', 'Swimming', 'Strength', 'Field', 'Mobility', 'Cross Training'];",
);
replaceOnce(
  'app/src/components/TrainingSettings.tsx',
  '<h2 id="equipment-title">Available equipment</h2>\n        <p className="section-intro">Turn on only equipment you can use for a typical session.</p>',
  '<h2 id="equipment-title">Available equipment & sport access</h2>\n        <p className="section-intro">Turn on only equipment and venues you can reliably use for a typical session. Pool access may be indoor or outdoor.</p>',
);

// Rapid onboarding: honest running range, triathlon focus, independent sport-access gates,
// and sessions/week (not days/week) so multisport athletes can declare double-day volume.
replaceOnce(
  'app/src/components/OnboardingWizard.tsx',
  "type GoalFocus = 'general_fitness' | 'running_10k_half' | 'cycling' | 'strength';",
  "type GoalFocus = 'general_fitness' | 'running' | 'cycling' | 'triathlon' | 'strength';",
);
replaceOnce(
  'app/src/components/OnboardingWizard.tsx',
  "    const [daysPerWeek, setDaysPerWeek] = useState<number>(4);",
  "    const [sessionsPerWeek, setSessionsPerWeek] = useState<number>(4);\n    const [sportAccess, setSportAccess] = useState({ outdoor_bike: false, swim_access: false });",
);
replaceOnce(
  'app/src/components/OnboardingWizard.tsx',
  "            if (focus === 'running_10k_half') {\n                domain = 'endurance';\n                title = '10k / Half Marathon Preparation';\n            } else if (focus === 'cycling') {",
  "            if (focus === 'running') {\n                domain = 'endurance';\n                title = '5K / 10K / Half / Marathon Preparation';\n            } else if (focus === 'cycling') {",
);
replaceOnce(
  'app/src/components/OnboardingWizard.tsx',
  "                title = 'Endurance Cycling Development';\n            } else if (focus === 'strength') {",
  "                title = 'Endurance Cycling Development';\n            } else if (focus === 'triathlon') {\n                domain = 'endurance';\n                title = 'Triathlon Preparation';\n            } else if (focus === 'strength') {",
);
replaceOnce(
  'app/src/components/OnboardingWizard.tsx',
  "                pullup_bar: equipment === 'full_gym' || equipment === 'home_dumbbells',\n            };",
  "                pullup_bar: equipment === 'full_gym' || equipment === 'home_dumbbells',\n                outdoor_bike: sportAccess.outdoor_bike,\n                swim_access: sportAccess.swim_access,\n            };",
);
replaceOnce(
  'app/src/components/OnboardingWizard.tsx',
  "                    weekdayMaxMinutes: daysPerWeek >= 5 ? 60 : 45,\n                    weekendMaxMinutes: 90,",
  "                    weekdayMaxMinutes: sessionsPerWeek >= 5 ? 60 : 45,\n                    weekendMaxMinutes: focus === 'running' || focus === 'cycling' || focus === 'triathlon' ? 180 : 90,",
);
replaceOnce(
  'app/src/components/OnboardingWizard.tsx',
  "                    minSessions: Math.max(1, daysPerWeek - 1),\n                    targetSessions: daysPerWeek,\n                    maxSessions: Math.min(7, daysPerWeek + 1),",
  "                    minSessions: Math.max(1, sessionsPerWeek - 1),\n                    targetSessions: sessionsPerWeek,\n                    maxSessions: Math.min(14, sessionsPerWeek + 1),",
);
replaceOnce(
  'app/src/components/OnboardingWizard.tsx',
  "                            <button type=\"button\" className={`choice-card ${focus === 'running_10k_half' ? 'active' : ''}`} onClick={() => setFocus('running_10k_half')}>\n                                <span className=\"choice-icon\">🏃</span>\n                                <strong>Running (10k / Half / Marathon)</strong>\n                                <p>Pacing, lactate threshold, VO2 max, and aerobic volume.</p>\n                            </button>",
  "                            <button type=\"button\" className={`choice-card ${focus === 'running' ? 'active' : ''}`} onClick={() => setFocus('running')}>\n                                <span className=\"choice-icon\">🏃</span>\n                                <strong>Running (5K / 10K / Half / Marathon)</strong>\n                                <p>Aerobic volume, long-run durability, threshold, VO2 max, and race specificity.</p>\n                            </button>",
);
replaceOnce(
  'app/src/components/OnboardingWizard.tsx',
  "                            <button type=\"button\" className={`choice-card ${focus === 'strength' ? 'active' : ''}`} onClick={() => setFocus('strength')}>\n                                <span className=\"choice-icon\">🏋️</span>",
  "                            <button type=\"button\" className={`choice-card ${focus === 'triathlon' ? 'active' : ''}`} onClick={() => setFocus('triathlon')}>\n                                <span className=\"choice-icon\">🏊</span>\n                                <strong>Triathlon</strong>\n                                <p>Swim, bike, and run exposure for short-course through half-distance racing.</p>\n                            </button>\n                            <button type=\"button\" className={`choice-card ${focus === 'strength' ? 'active' : ''}`} onClick={() => setFocus('strength')}>\n                                <span className=\"choice-icon\">🏋️</span>",
);
replaceOnce(
  'app/src/components/OnboardingWizard.tsx',
  "                        <div className=\"choice-group\">\n                            <label className=\"group-heading\">Weekly Training Target:</label>\n                            <div className=\"days-selector-row\">\n                                {[3, 4, 5, 6].map(days => (\n                                    <button key={days} type=\"button\" className={`days-pill ${daysPerWeek === days ? 'active' : ''}`} onClick={() => setDaysPerWeek(days)} disabled={saving}>\n                                        {days} days / week\n                                    </button>\n                                ))}\n                            </div>\n                        </div>",
  "                        <div className=\"choice-group\">\n                            <label className=\"group-heading\">Sport access:</label>\n                            <div className=\"choice-grid-small\">\n                                <label className=\"choice-card-mini\">\n                                    <input type=\"checkbox\" checked={sportAccess.outdoor_bike} onChange={(event) => setSportAccess(current => ({ ...current, outdoor_bike: event.target.checked }))} disabled={saving} />\n                                    🚴 Bicycle available for outdoor riding\n                                </label>\n                                <label className=\"choice-card-mini\">\n                                    <input type=\"checkbox\" checked={sportAccess.swim_access} onChange={(event) => setSportAccess(current => ({ ...current, swim_access: event.target.checked }))} disabled={saving} />\n                                    🏊 Pool / swim venue access\n                                </label>\n                            </div>\n                        </div>\n\n                        <div className=\"choice-group\">\n                            <label className=\"group-heading\">Weekly Training Sessions:</label>\n                            <div className=\"days-selector-row\">\n                                {[3, 4, 5, 6, 7, 8, 9, 10].map(sessions => (\n                                    <button key={sessions} type=\"button\" className={`days-pill ${sessionsPerWeek === sessions ? 'active' : ''}`} onClick={() => setSessionsPerWeek(sessions)} disabled={saving}>\n                                        {sessions} / week\n                                    </button>\n                                ))}\n                            </div>\n                        </div>",
);

// ---------------------------------------------------------------------------
// Preferences / Firestore boundary alignment. Swimming was already visible in the
// canonical preference UI, but unavailable-modality validation rejected it.
// ---------------------------------------------------------------------------
replaceOnce(
  'app/src/engine/validationCore.ts',
  "        const validUnavailableModalities = ['Running', 'Cycling', 'Strength', 'Field', 'Mobility', 'Cross Training'];",
  "        const validUnavailableModalities = ['Running', 'Cycling', 'Swimming', 'Strength', 'Field', 'Mobility', 'Cross Training', 'Rowing'];",
);
replaceOnce(
  'app/src/engine/validationCore.ts',
  "const EXTERNAL_MODALITIES: ExternalSessionModality[] = ['cycling', 'running', 'strength', 'field', 'mobility', 'cross_training'];",
  "const EXTERNAL_MODALITIES: ExternalSessionModality[] = ['cycling', 'running', 'swimming', 'strength', 'field', 'mobility', 'cross_training'];",
);
replaceOnce(
  'app/src/engine/validationCore.ts',
  "const EXTERNAL_EQUIPMENT: EquipmentKey[] = ['free_weights', 'cable_machine', 'treadmill', 'indoor_bike', 'pullup_bar'];",
  "const EXTERNAL_EQUIPMENT: EquipmentKey[] = ['free_weights', 'cable_machine', 'treadmill', 'indoor_bike', 'pullup_bar', 'outdoor_bike', 'swim_access'];",
);
replaceOnce(
  'app/firestore.rules',
  "          && data.unavailableModalities.size() <= 6\n          && data.unavailableModalities.hasOnly(['Running', 'Cycling', 'Strength', 'Field', 'Mobility', 'Cross Training']));",
  "          && data.unavailableModalities.size() <= 8\n          && data.unavailableModalities.hasOnly(['Running', 'Cycling', 'Swimming', 'Strength', 'Field', 'Mobility', 'Cross Training', 'Rowing']));",
);
replaceOnce(
  'app/firestore.rules',
  "        && data.overriddenModality in ['Running', 'Cycling', 'Strength', 'Mobility', 'Field', 'Cross Training', 'Unknown']",
  "        && data.overriddenModality in ['Running', 'Cycling', 'Swimming', 'Strength', 'Mobility', 'Field', 'Cross Training', 'Unknown']",
);

// ---------------------------------------------------------------------------
// Completed-training evidence and external plans understand Swimming as a first-class
// modality rather than collapsing it into Cross Training.
// ---------------------------------------------------------------------------
const swimCost = `    Swimming: {\n        easy: { systemic: 0.2, cardiovascular: 0.3, lowerBody: 0.1, upperBody: 0.25, impactTissue: 0.02, neuromuscular: 0.15 },\n        moderate: { systemic: 0.45, cardiovascular: 0.6, lowerBody: 0.15, upperBody: 0.45, impactTissue: 0.03, neuromuscular: 0.3 },\n        hard: { systemic: 0.7, cardiovascular: 0.85, lowerBody: 0.2, upperBody: 0.65, impactTissue: 0.05, neuromuscular: 0.5 },\n        unknown: { systemic: 0.4, cardiovascular: 0.5, lowerBody: 0.15, upperBody: 0.4, impactTissue: 0.03, neuromuscular: 0.25 },\n    },\n`;
insertBeforeAfter(
  'app/src/engine/completedTraining.ts',
  'export const DEFAULT_COST_BY_MODALITY',
  '    Strength: {',
  swimCost,
);
const swimStimulus = `    Swimming: {\n        easy: { aerobicEndurance: 0.55, thresholdPower: 0.10, vo2MaxPower: 0, repeatedSurges: 0.02, sprintPower: 0, fatigueResistance: 0.10, maxStrength: 0, hypertrophy: 0 },\n        moderate: { aerobicEndurance: 0.70, thresholdPower: 0.35, vo2MaxPower: 0.10, repeatedSurges: 0.05, sprintPower: 0, fatigueResistance: 0.25, maxStrength: 0, hypertrophy: 0 },\n        hard: { aerobicEndurance: 0.55, thresholdPower: 0.70, vo2MaxPower: 0.45, repeatedSurges: 0.10, sprintPower: 0.05, fatigueResistance: 0.50, maxStrength: 0, hypertrophy: 0 },\n        unknown: { aerobicEndurance: 0.55, thresholdPower: 0.20, vo2MaxPower: 0.05, repeatedSurges: 0.05, sprintPower: 0, fatigueResistance: 0.15, maxStrength: 0, hypertrophy: 0 },\n    },\n`;
insertBeforeAfter(
  'app/src/engine/completedTraining.ts',
  'export const DEFAULT_STIMULUS_BY_MODALITY',
  '    Strength: {',
  swimStimulus,
);
replaceOnce(
  'app/src/engine/completedTraining.ts',
  "    if (normalized.includes('run')) return 'Running';\n    if (normalized.includes('strength')",
  "    if (normalized.includes('run')) return 'Running';\n    if (normalized.includes('swim')) return 'Swimming';\n    if (normalized.includes('strength')",
);
replaceOnce(
  'app/src/engine/completedTraining.ts',
  "    if (normalized.includes('swim') || normalized.includes('row') || normalized.includes('ellipt') || normalized.includes('cardio')) return 'Cross Training';",
  "    if (normalized.includes('row') || normalized.includes('ellipt') || normalized.includes('cardio')) return 'Cross Training';",
);
replaceOnce(
  'app/src/engine/externalSessionProfiles.ts',
  "    running: 'Running',\n    strength: 'Strength',",
  "    running: 'Running',\n    swimming: 'Swimming',\n    strength: 'Strength',",
);

// ---------------------------------------------------------------------------
// Event presets: keep World Triathlon Sprint/Standard separate from Polish fractional
// race naming. 1/2 and 70.3 are equivalent distance families; 1/4 is not Olympic.
// ---------------------------------------------------------------------------
const fractionalPresets = `        {\n            id: 'eighth_im',\n            label: '1/8 distance (475 m / 22.5 km / 5.25 km)',\n            demandProfile: { aerobicEndurance: 0.6, thresholdPower: 0.75, vo2MaxPower: 0.65, repeatedSurges: 0.3, sprintPower: 0.2, fatigueResistance: 0.5, neuromuscular: 0.2 },\n        },\n        {\n            id: 'quarter_im',\n            label: '1/4 distance (950 m / 45 km / 10.55 km)',\n            demandProfile: { aerobicEndurance: 0.8, thresholdPower: 0.8, vo2MaxPower: 0.4, repeatedSurges: 0.2, sprintPower: 0.1, fatigueResistance: 0.7, neuromuscular: 0.15 },\n        },\n`;
insertBeforeAfter(
  'app/src/engine/eventPresets.ts',
  '    triathlon: [',
  "        {\n            id: 'sprint',",
  fractionalPresets,
);
replaceOnce(
  'app/src/engine/eventPresets.ts',
  "            label: 'Half iron (70.3)',",
  "            label: '1/2 distance / 70.3 (1.9 km / 90 km / 21.1 km)',",
);

// ---------------------------------------------------------------------------
// Catalog: add actual swimming choices and race-distance running choices.
// ---------------------------------------------------------------------------
const multisportTemplates = `    {\n        id: 'swim_technique_01',\n        category: 'Technical Skill',\n        modality: 'Swimming',\n        durationMin: 25,\n        durationMax: 45,\n        title: 'Pool Swim Technique',\n        description: 'Easy technique-focused pool session with relaxed repeats, body-position work, and generous recovery. Stop technical work when stroke quality deteriorates.',\n        requiredEquipment: ['swim_access'],\n        environment: 'either', safetyTags: [],\n        systemicCost: 0.2,\n        objectiveTransferable: false,\n        stimulusProfile: { aerobicEndurance: 0.3, thresholdPower: 0.1, vo2MaxPower: 0, repeatedSurges: 0, sprintPower: 0, fatigueResistance: 0.1, maxStrength: 0, hypertrophy: 0 },\n        costProfile: { systemic: 0.2, cardiovascular: 0.25, lowerBody: 0.05, upperBody: 0.25, impactTissue: 0.02, neuromuscular: 0.3 }\n    },\n    {\n        id: 'swim_easy_01',\n        category: 'Easy Endurance',\n        modality: 'Swimming',\n        durationMin: 30,\n        durationMax: 60,\n        title: 'Easy Aerobic Swim',\n        description: 'Conversational-equivalent aerobic swimming in repeatable relaxed sets. Keep breathing and stroke mechanics controlled rather than chasing pace.',\n        requiredEquipment: ['swim_access'],\n        environment: 'either', safetyTags: [],\n        systemicCost: 0.3,\n        objectiveTransferable: true,\n        stimulusProfile: { aerobicEndurance: 0.8, thresholdPower: 0.15, vo2MaxPower: 0.05, repeatedSurges: 0, sprintPower: 0, fatigueResistance: 0.3, maxStrength: 0, hypertrophy: 0 },\n        costProfile: { systemic: 0.3, cardiovascular: 0.4, lowerBody: 0.08, upperBody: 0.3, impactTissue: 0.02, neuromuscular: 0.15 }\n    },\n    {\n        id: 'swim_threshold_01',\n        category: 'Moderate Endurance',\n        modality: 'Swimming',\n        durationMin: 35,\n        durationMax: 60,\n        title: 'Sustained Swim Intervals',\n        description: 'Controlled moderate-to-threshold pool repeats with enough recovery to preserve stroke mechanics. Use RPE and repeat consistency until swim-specific pace anchors are available.',\n        requiredEquipment: ['swim_access'],\n        environment: 'either', safetyTags: [],\n        systemicCost: 0.6,\n        objectiveTransferable: true,\n        stimulusProfile: { aerobicEndurance: 0.7, thresholdPower: 0.8, vo2MaxPower: 0.3, repeatedSurges: 0.1, sprintPower: 0, fatigueResistance: 0.5, maxStrength: 0, hypertrophy: 0 },\n        costProfile: { systemic: 0.6, cardiovascular: 0.7, lowerBody: 0.12, upperBody: 0.5, impactTissue: 0.03, neuromuscular: 0.35 }\n    },\n    {\n        id: 'run_long_01',\n        category: 'Race-Specific Endurance',\n        modality: 'Running',\n        durationMin: 60,\n        durationMax: 180,\n        title: 'Long Aerobic Run',\n        description: 'Progressive long-run exposure for half-marathon and marathon durability. Keep most of the session easy; duration is capped by the athlete time budget and current planned dose.',\n        requiredEquipment: [],\n        environment: 'outdoor', safetyTags: ['avoid_high_impact', 'avoid_heavy_lower_body'],\n        systemicCost: 0.75,\n        objectiveTransferable: true,\n        stimulusProfile: { aerobicEndurance: 0.9, thresholdPower: 0.35, vo2MaxPower: 0.1, repeatedSurges: 0.05, sprintPower: 0, fatigueResistance: 0.9, maxStrength: 0, hypertrophy: 0 },\n        costProfile: { systemic: 0.75, cardiovascular: 0.75, lowerBody: 0.78, upperBody: 0.02, impactTissue: 0.85, neuromuscular: 0.28 },\n        phaseEligibility: { requiresFocusEvent: true, excludeTaper: true }\n    },\n    {\n        id: 'run_race_pace_01',\n        category: 'Race-Specific Endurance',\n        modality: 'Running',\n        durationMin: 40,\n        durationMax: 90,\n        title: 'Running Race-Pace Specificity',\n        description: 'Race-specific running with controlled work near the event-relevant sustainable pace, separated by easy running. The exact pace remains athlete-specific rather than inferred from event distance alone.',\n        requiredEquipment: [],\n        environment: 'outdoor', safetyTags: ['avoid_high_impact', 'avoid_heavy_lower_body'],\n        systemicCost: 0.75,\n        objectiveTransferable: true,\n        stimulusProfile: { aerobicEndurance: 0.65, thresholdPower: 0.85, vo2MaxPower: 0.45, repeatedSurges: 0.15, sprintPower: 0.05, fatigueResistance: 0.65, maxStrength: 0, hypertrophy: 0 },\n        costProfile: { systemic: 0.75, cardiovascular: 0.82, lowerBody: 0.78, upperBody: 0.02, impactTissue: 0.85, neuromuscular: 0.5 },\n        phaseEligibility: { requiresFocusEvent: true, maxDaysToEvent: 56, excludeTaper: true }\n    },\n    {\n        id: 'run_taper_sharpen_01',\n        category: 'Race-Specific Endurance',\n        modality: 'Running',\n        durationMin: 20,\n        durationMax: 40,\n        title: 'Running Taper Sharpening',\n        description: 'Short race-week run retaining a little event-relevant intensity while removing volume. Finish feeling fresher than you started.',\n        requiredEquipment: [],\n        environment: 'outdoor', safetyTags: ['avoid_high_impact', 'avoid_heavy_lower_body'],\n        systemicCost: 0.4,\n        objectiveTransferable: false,\n        stimulusProfile: { aerobicEndurance: 0.35, thresholdPower: 0.55, vo2MaxPower: 0.4, repeatedSurges: 0.1, sprintPower: 0.05, fatigueResistance: 0.35, maxStrength: 0, hypertrophy: 0 },\n        costProfile: { systemic: 0.4, cardiovascular: 0.5, lowerBody: 0.42, upperBody: 0.01, impactTissue: 0.5, neuromuscular: 0.35 },\n        phaseEligibility: { requiresFocusEvent: true, requiresTaper: true }\n    },\n`;
insertBeforeAfter(
  'app/src/engine/templates.ts',
  'export const TEMPLATES',
  '    {\n        id: "end_race_specific_01",',
  multisportTemplates,
);
addEquipmentToOutdoorCyclingTemplates('app/src/engine/templates.ts');

// ---------------------------------------------------------------------------
// Periodization: sport-specific aerobic credit, triathlon requires all three disciplines,
// and running gets distance-appropriate race-specific work instead of generic 30-60 min only.
// ---------------------------------------------------------------------------
replaceOnce(
  'app/src/engine/periodization.ts',
  "        case 'triathlon': return ['Cycling', 'Running'];",
  "        case 'triathlon': return ['Swimming', 'Cycling', 'Running'];",
);
replaceOnce(
  'app/src/engine/periodization.ts',
  `    if (demand.aerobicEndurance >= 0.4) {\n        objectives.push({\n            id: 'obj_z2_aerobic', key: 'zone2_aerobic', title: 'Aerobic Base (Zone 2)',\n            targetExposures: demand.aerobicEndurance >= 0.7 ? 2 : 1,\n            completedExposures: 0,\n            targetStimulus: { aerobicEndurance: 0.8 },\n        });\n    }`,
  `    if (demand.aerobicEndurance >= 0.4) {\n        if (category === 'triathlon' && !isPostEventRecovery) {\n            // A generic aerobic bucket lets a triathlete satisfy the entire week by cycling.\n            // Keep one low-intensity exposure per race discipline instead. Shared objective\n            // keys are safe because qualification is modality-scoped and each objective has\n            // a stable unique id.\n            for (const [id, modality, title] of [\n                ['obj_tri_swim_aerobic', 'Swimming', 'Triathlon Swim Aerobic Exposure'],\n                ['obj_tri_bike_aerobic', 'Cycling', 'Triathlon Bike Aerobic Exposure'],\n                ['obj_tri_run_aerobic', 'Running', 'Triathlon Run Aerobic Exposure'],\n            ] as const) {\n                objectives.push({\n                    id, key: 'zone2_aerobic', title,\n                    targetExposures: 1, completedExposures: 0,\n                    targetStimulus: { aerobicEndurance: 0.7 },\n                    qualification: {\n                        minimumStimulus: { aerobicEndurance: 0.45 },\n                        allowedModalities: [modality],\n                    },\n                });\n            }\n        } else {\n            objectives.push({\n                id: 'obj_z2_aerobic', key: 'zone2_aerobic', title: 'Aerobic Base (Zone 2)',\n                targetExposures: demand.aerobicEndurance >= 0.7 ? 2 : 1,\n                completedExposures: 0,\n                targetStimulus: { aerobicEndurance: 0.8 },\n                qualification: allowedModalities.length > 0 ? { allowedModalities } : undefined,\n            });\n        }\n    }`,
);
const runningObjectiveBranch = `\n    if (category === 'running_race' && !isPostEventRecovery) {\n        if (taperActive) {\n            objectives.push({\n                id: 'obj_running_taper_sharpening', key: 'race_specific_endurance', title: 'Running Taper Sharpening',\n                targetExposures: 1, completedExposures: 0,\n                targetStimulus: { thresholdPower: 0.5, aerobicEndurance: 0.3 },\n                qualification: {\n                    minimumStimulus: { thresholdPower: 0.4 },\n                    allowedModalities: ['Running'],\n                    allowedCategories: ['Race-Specific Endurance'],\n                },\n            });\n        } else if (rawDemand.fatigueResistance >= 0.75 && rawDemand.aerobicEndurance >= 0.8) {\n            objectives.push({\n                id: 'obj_running_long_durability', key: 'race_specific_endurance', title: 'Running Long-Run Durability',\n                targetExposures: 1, completedExposures: 0,\n                targetStimulus: { aerobicEndurance: 0.85, fatigueResistance: 0.85 },\n                qualification: {\n                    minimumStimulus: { aerobicEndurance: 0.7, fatigueResistance: 0.65 },\n                    allowedModalities: ['Running'],\n                    allowedCategories: ['Race-Specific Endurance'],\n                },\n            });\n        } else if (rawDemand.thresholdPower >= 0.65 || rawDemand.vo2MaxPower >= 0.7) {\n            objectives.push({\n                id: 'obj_running_race_specific', key: 'race_specific_endurance', title: 'Running Race-Pace Specificity',\n                targetExposures: 1, completedExposures: 0,\n                targetStimulus: { thresholdPower: 0.75, aerobicEndurance: 0.5 },\n                qualification: {\n                    minimumStimulus: { thresholdPower: 0.6 },\n                    allowedModalities: ['Running'],\n                    allowedCategories: ['Race-Specific Endurance'],\n                },\n            });\n        }\n    }\n`;
insertBeforeAfter(
  'app/src/engine/periodization.ts',
  "    if (category === 'cycling_event' && !isPostEventRecovery) {",
  '\n    return objectives;',
  runningObjectiveBranch,
);

// Legacy free-text credit must fail closed for newly modality-scoped objectives. Otherwise
// one old "easy endurance" record could credit swim + bike + run objectives at once.
insertBeforeAfter(
  'app/src/engine/microcycle.ts',
  'export const COMPATIBILITY_CREDIT_PER_EXPOSURE',
  '/** One compatibility projection',
  `const LEGACY_MODALITY_TOKENS: Partial<Record<SessionTemplate['modality'], string[]>> = {\n    Running: ['run'],\n    Cycling: ['cycl', 'bike'],\n    Swimming: ['swim'],\n    Strength: ['strength', 'weight', 'lift'],\n    Field: ['field', 'football', 'soccer'],\n    Mobility: ['mobility', 'yoga'],\n    'Cross Training': ['cross training', 'ellipt', 'row'],\n};\n\nfunction legacyTextCanCreditScopedObjective(activityType: string, objective: WeeklyObjective): boolean {\n    const allowed = objective.qualification?.allowedModalities;\n    if (!allowed || allowed.length === 0) return true;\n    return allowed.some(modality => (LEGACY_MODALITY_TOKENS[modality] ?? []).some(token => activityType.includes(token)));\n}\n\n`,
);
replaceOnce(
  'app/src/engine/microcycle.ts',
  "        if (matched) {\n            const requiredCredit = obj.requiredCredit ?? obj.targetExposures;",
  "        if (matched && legacyTextCanCreditScopedObjective(actType, obj)) {\n            const requiredCredit = obj.requiredCredit ?? obj.targetExposures;",
);

// ---------------------------------------------------------------------------
// Policy provenance: every persisted decision after this behavior change is identifiable.
// ---------------------------------------------------------------------------
replaceOnce(
  'app/src/engine/policy.ts',
  "export const POLICY_VERSION = '2026-08-evergreen-priority-time-cap-v2';",
  "export const POLICY_VERSION = '2026-08-multisport-running-triathlon-v1';",
);
replaceOnce(
  'app/src/engine/policy.ts',
  "export const HISTORICAL_POLICY_VERSIONS = [\n    '2026-08-evergreen-priority-time-cap-v1',",
  "export const HISTORICAL_POLICY_VERSIONS = [\n    '2026-08-evergreen-priority-time-cap-v2',\n    '2026-08-evergreen-priority-time-cap-v1',",
);

// Existing malformed-settings test used Swimming as the unsupported sentinel; Swimming is
// now valid, so keep the test's purpose with an actually unsupported token.
replaceOnce(
  'app/src/services/trainingSettingsService.test.ts',
  "            { severity: 'limit', restrictedModalities: ['Swimming'] },",
  "            { severity: 'limit', restrictedModalities: ['Unsupported'] },",
);

// ---------------------------------------------------------------------------
// Regression coverage for the support contract.
// ---------------------------------------------------------------------------
const supportTest = `import { describe, expect, it } from 'vitest';\nimport { EVENT_PRESETS } from './eventPresets';\nimport { objectivesFromDemand, modalitiesForEventCategory } from './periodization';\nimport { TEMPLATES } from './templates';\nimport { createDefaultTrainingSettings, parseTrainingSettings } from '../services/trainingSettingsService';\n\ndescribe('running and triathlon support contract', () => {\n    it('keeps Polish fractional triathlon distances distinct from World Triathlon presets', () => {\n        const presets = EVENT_PRESETS.triathlon;\n        expect(presets.find(preset => preset.id === 'eighth_im')?.label).toContain('475 m / 22.5 km / 5.25 km');\n        expect(presets.find(preset => preset.id === 'quarter_im')?.label).toContain('950 m / 45 km / 10.55 km');\n        expect(presets.find(preset => preset.id === 'sprint')?.label).toBe('Sprint');\n        expect(presets.find(preset => preset.id === 'olympic')?.label).toBe('Olympic');\n        expect(presets.find(preset => preset.id === 'half_iron')?.label).toContain('1.9 km / 90 km / 21.1 km');\n    });\n\n    it('requires swim, bike and run aerobic exposure for triathlon demand', () => {\n        const demand = EVENT_PRESETS.triathlon.find(preset => preset.id === 'quarter_im')!.demandProfile;\n        const modalities = modalitiesForEventCategory('triathlon');\n        expect(modalities).toEqual(['Swimming', 'Cycling', 'Running']);\n        const objectives = objectivesFromDemand(demand, 'triathlon', false, false, modalities, demand);\n        const disciplineAerobic = objectives.filter(objective => objective.id.startsWith('obj_tri_'));\n        expect(disciplineAerobic).toHaveLength(3);\n        expect(disciplineAerobic.map(objective => objective.qualification?.allowedModalities?.[0])).toEqual(['Swimming', 'Cycling', 'Running']);\n    });\n\n    it('adds long-run durability for half marathon and marathon profiles', () => {\n        for (const presetId of ['half_marathon', 'marathon']) {\n            const demand = EVENT_PRESETS.running_race.find(preset => preset.id === presetId)!.demandProfile;\n            const objectives = objectivesFromDemand(demand, 'running_race', false, false, ['Running'], demand);\n            expect(objectives.some(objective => objective.id === 'obj_running_long_durability')).toBe(true);\n        }\n    });\n\n    it('makes every outdoor cycling template require a bicycle and every swim template require swim access', () => {\n        const outdoorCycling = TEMPLATES.filter(template => template.modality === 'Cycling' && template.environment === 'outdoor');\n        expect(outdoorCycling.length).toBeGreaterThan(0);\n        expect(outdoorCycling.every(template => template.requiredEquipment.includes('outdoor_bike'))).toBe(true);\n\n        const swimming = TEMPLATES.filter(template => template.modality === 'Swimming');\n        expect(swimming.length).toBeGreaterThanOrEqual(3);\n        expect(swimming.every(template => template.requiredEquipment.includes('swim_access'))).toBe(true);\n    });\n\n    it('parses legacy settings without new sport-access fields as unavailable and accepts Swimming restrictions', () => {\n        const base = createDefaultTrainingSettings('athlete', '2026-08-30T05:00:00.000Z');\n        const { outdoor_bike: _bike, swim_access: _swim, ...legacyEquipment } = base.equipment;\n        const parsed = parseTrainingSettings({\n            ...base,\n            equipment: legacyEquipment,\n            injuries: [{ severity: 'limit', restrictedModalities: ['Swimming'] }],\n        }, 'athlete');\n        expect(parsed).not.toBeNull();\n        expect(parsed?.equipment.outdoor_bike).toBe(false);\n        expect(parsed?.equipment.swim_access).toBe(false);\n        expect(parsed?.injuries?.[0].restrictedModalities).toEqual(['Swimming']);\n    });\n});\n`;
write('app/src/engine/multisportSupport.test.ts', supportTest);

// ---------------------------------------------------------------------------
// Architecture + audit documentation. Keep the claim deliberately narrower than "full
// marathon/triathlon coach": this PR establishes safe native foundations and names the
// distance-aware features that still need dedicated planning work.
// ---------------------------------------------------------------------------
replaceOnce(
  'docs/architecture/recommendation-engine.md',
  'Running, triathlon, strength, and general events retain demand-derived planning.',
  'Running, triathlon, strength, and general events retain demand-derived planning. Running aerobic objectives are modality-scoped and half-marathon/marathon demand adds a long-run durability objective. Triathlon demand creates separate swim, bike, and run aerobic objectives so one discipline cannot silently satisfy the whole sport. Outdoor cycling and swimming are hard-gated by declared bicycle/swim access.',
);

fs.mkdirSync('docs/analysis', { recursive: true });
const auditDoc = `# Running + triathlon athlete support audit (2026-08-30)\n\n## Question\n\nCan the app honestly support an athlete training for 5K, 10K, half marathon, marathon, and short-to-middle-distance triathlon?\n\n## Pre-change answer\n\n**Running: partial. Triathlon: no, not as a native three-discipline coach.**\n\nThe repository already had 5K, 10K, half-marathon, and marathon event presets, plus Sprint, Olympic, 70.3, and Iron-distance triathlon labels. But the executable model did not contain a Swimming modality, triathlon sport-specific exposure was defined as Cycling + Running only, Garmin swims were collapsed into Cross Training, and there was no bicycle or pool-access feasibility gate. The running catalog also topped out at generic roughly 30-60 minute easy/tempo/interval sessions, so half-marathon/marathon event metadata did not create a long-run requirement.\n\nThat mismatch is more dangerous than simply lacking a feature: the UI could express \"Swimming\" as an enjoyed modality while the engine could not honor it, and outdoor bike workouts could remain feasible when no bicycle had ever been declared.\n\n## Changes in this PR\n\n### 1. Hard feasibility for sport access\n\n- Adds \`outdoor_bike\` and \`swim_access\` to training settings.\n- Historical settings without those additive fields parse safely as **false** rather than inventing access.\n- Every outdoor Cycling catalog template requires \`outdoor_bike\`.\n- Every Swimming template requires \`swim_access\`.\n- Rapid onboarding asks these independently of gym tier: a \"full gym\" does not imply ownership of a bicycle or reliable pool access.\n\n### 2. Swimming becomes a first-class modality\n\n- Adds \`Swimming\` to the executable session vocabulary and \`swimming\` to external-plan gating.\n- Adds technique, easy-aerobic, and sustained-interval swim templates.\n- Classifies Garmin swim activities as Swimming rather than Cross Training and gives Swimming its own conservative load/stimulus fallback tables.\n- Aligns injury, preference-unavailability, activity-override, and Firestore validation with the modality.\n\n### 3. Triathlon requires all three disciplines\n\nFor a triathlon governing event, the demand-derived weekly objectives now include one aerobic exposure scoped independently to Swimming, Cycling, and Running. A week of cycling can no longer fully satisfy \"triathlon aerobic base\" simply because cycling carries a generic aerobic stimulus.\n\nThe deprecated free-text history fallback was also tightened: a modality-scoped objective only receives legacy keyword credit when the activity text actually identifies the allowed modality. This prevents one old \"easy endurance\" record from crediting swim + bike + run at the same time.\n\n### 4. Running race specificity\n\n- 5K/10K demand gets a race-pace-specific running objective/session in the specific build window.\n- Half marathon and marathon demand gets a long-run durability objective and a 60-180 minute long-run template, still capped by the athlete's time budget and planned dose.\n- Running taper receives a short sharpening template/objective instead of relying only on generic sessions.\n- Generic aerobic objective credit is now scoped to the governing event's sport rather than letting cross-training satisfy a running or cycling race's primary aerobic exposure.\n\n### 5. Distance naming is made explicit\n\nPolish fractional triathlon nomenclature is not treated as an alias for World Triathlon nomenclature:\n\n- 1/8: 475 m swim / 22.5 km bike / 5.25 km run.\n- 1/4: 950 m / 45 km / 10.55 km.\n- Sprint remains a distinct preset (World Triathlon commonly 750 m / 20 km / 5 km).\n- Olympic/Standard remains 1.5 km / 40 km / 10 km.\n- 1/2 / 70.3 is labeled 1.9 km / 90 km / 21.1 km.\n\nThis avoids the tempting but wrong product shortcut \"1/4 = Olympic\".\n\n## Research basis and interpretation\n\n- World Triathlon competition rules / age-group material use 750 m / 20 km / 5 km for Sprint and 1.5 km / 40 km / 10 km for Standard.\n  - https://triathlon.org/age-group\n- Polish race series use the fractional convention 1/8 = 475 m / 22.5 km / 5.25 km and 1/4 = 950 m / 45 km / ~10.5 km; 1/2 uses 1.9 km / 90 km / 21.1 km.\n  - https://ligatriathlonu.pl/dystans-1-8-im/\n  - https://ligatriathlonu.pl/dystans-1-4-im/\n  - https://triathlon-zg.pl/kalendarz/\n- A systematic review of distance-running intensity distribution supports the broad pattern of high low-intensity volume plus smaller doses of threshold/high-intensity work; it does **not** justify one rigid universal weekly recipe.\n  - https://pubmed.ncbi.nlm.nih.gov/35038601/\n- Reviews of cycling-to-running transition show that prior cycling can impair subsequent running in at least some contexts, while exact optimal transition strategies remain mixed. That supports eventually modeling race-specific brick exposure, but not pretending evidence establishes one mandatory brick prescription.\n  - https://pubmed.ncbi.nlm.nih.gov/19437186/\n\n## What this PR deliberately does **not** claim\n\nThis is a safe native multisport foundation, **not yet full parity with a specialist marathon or triathlon coach**. Remaining work should be explicit rather than hidden behind event labels:\n\n1. **Distance-aware weekly volume progression:** the engine still uses demand-derived objectives rather than a running/triathlon plan builder that grows weekly running distance, long-run duration, swim volume, and bike duration from history and time-to-event.\n2. **Brick / transition sessions:** the current single-template modality model cannot represent bike-to-run as one native multi-block multisport session without either abusing Cross Training or extending the session-definition/planner contract.\n3. **Swim-specific performance anchors:** no CSS/critical-swim-speed, 100 m pace, stroke-rate, or technique-quality model yet. Swim sessions therefore use RPE/repeat consistency language rather than invented pace targets.\n4. **Open-water specificity:** sighting, starts, drafting, wetsuit, currents, and open-water safety/access are not modeled. \`swim_access\` means a safe usable swim venue, not necessarily open water.\n5. **Triathlon discipline-volume allocation:** the three-discipline floor prevents omission, but it does not yet optimize the proportion of weekly load among swim/bike/run by race distance, athlete weakness, or training history.\n6. **Running injury-load progression:** adding a long-run template does not by itself constitute an evidence-based mileage-ramp algorithm. Existing readiness/injury gates still apply, but chronic running-load progression deserves its own design.\n\n## Product support statement after this PR\n\n- **5K / 10K:** native event-directed support is credible at the objective/template level (easy aerobic, threshold/VO2, race specificity, taper), but still demand-derived rather than a complete authored plan.\n- **Half marathon / marathon:** materially improved and now includes long-run durability, but should still be described as **adaptive demand-derived support**, not a distance-calibrated marathon plan generator.\n- **1/8 / 1/4 / Sprint / Olympic / 1/2-70.3 triathlon:** native three-discipline adaptive support becomes real (swim + bike + run, access-gated), but brick programming, swim pace modeling, and discipline-volume optimization remain follow-up work.\n\nThat is the honest boundary: the app can adapt sensible sport-specific sessions without omitting swimming or prescribing unavailable equipment, while future work is still required before marketing it as a fully periodized specialist marathon/triathlon plan builder.\n`;
write('docs/analysis/2026-08-30-running-triathlon-support-audit.md', auditDoc);

console.log('Multisport patch applied successfully.');
