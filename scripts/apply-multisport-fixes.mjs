import fs from 'node:fs';

function replaceOnce(path, from, to) {
  const source = fs.readFileSync(path, 'utf8');
  const index = source.indexOf(from);
  if (index < 0) throw new Error(`Missing follow-up anchor in ${path}: ${from.slice(0, 120)}`);
  fs.writeFileSync(path, source.slice(0, index) + to + source.slice(index + from.length));
}

replaceOnce(
  'app/src/components/Home.tsx',
  "      free_weights: 'Free weights available', cable_machine: 'Cable machine available', treadmill: 'Treadmill available', indoor_bike: 'Stationary bike available', pullup_bar: 'Pull-up bar available'",
  "      free_weights: 'Free weights available', cable_machine: 'Cable machine available', treadmill: 'Treadmill available', indoor_bike: 'Stationary bike available', pullup_bar: 'Pull-up bar available', outdoor_bike: 'Outdoor bicycle available', swim_access: 'Pool / swim access available'",
);

replaceOnce(
  'app/src/engine/eligibility.ts',
  "    if (settings) return settings.equipment[equipment];",
  "    if (settings) return settings.equipment[equipment] ?? false;",
);

replaceOnce(
  'app/src/engine/rules.ts',
  "        case 'running': return event.category === 'running_race' || event.category === 'triathlon';\n        case 'strength': return event.category === 'strength_meet';",
  "        case 'running': return event.category === 'running_race' || event.category === 'triathlon';\n        case 'swimming': return event.category === 'triathlon';\n        case 'strength': return event.category === 'strength_meet';",
);

replaceOnce(
  'app/src/engine/rules.ts',
  "    const allowedModalities = (['Running', 'Cycling', 'Strength', 'Field', 'Mobility', 'Cross Training', 'None'] as const)",
  "    const allowedModalities = (['Running', 'Cycling', 'Swimming', 'Strength', 'Field', 'Mobility', 'Cross Training', 'None'] as const)",
);

replaceOnce(
  'app/src/engine/multisportSupport.test.ts',
  "        const { outdoor_bike: _bike, swim_access: _swim, ...legacyEquipment } = base.equipment;",
  "        const legacyEquipment = { ...base.equipment };\n        delete legacyEquipment.outdoor_bike;\n        delete legacyEquipment.swim_access;",
);

console.log('Applied multisport exhaustiveness and regression-test follow-up fixes.');
