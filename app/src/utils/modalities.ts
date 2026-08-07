export interface CanonicalModality {
  value: string;
  label: string;
  category: 'Endurance' | 'Gym' | 'Recovery' | 'Athletics';
}

export const CANONICAL_MODALITIES: CanonicalModality[] = [
  { value: 'Running', label: '🏃 Running', category: 'Endurance' },
  { value: 'Cycling', label: '🚴 Cycling', category: 'Endurance' },
  { value: 'Swimming', label: '🏊 Swimming', category: 'Endurance' },
  { value: 'Rowing', label: '🚣 Rowing / Erg', category: 'Endurance' },
  { value: 'Cross Training', label: '⚡ Other Low-Impact Cardio', category: 'Endurance' },
  { value: 'Strength', label: '🏋️ Strength & Resistance', category: 'Gym' },
  { value: 'Mobility', label: '🧘 Mobility & Yoga', category: 'Recovery' },
  { value: 'Field', label: '⚽ Field / Sport Training', category: 'Athletics' },
];
