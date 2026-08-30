import { describe, expect, it } from 'vitest';
import { EVENT_PRESETS } from './eventPresets';
import { objectivesFromDemand, modalitiesForEventCategory } from './periodization';
import { TEMPLATES } from './templates';
import { createDefaultTrainingSettings, parseTrainingSettings } from '../services/trainingSettingsService';

describe('running and triathlon support contract', () => {
    it('keeps Polish fractional triathlon distances distinct from World Triathlon presets', () => {
        const presets = EVENT_PRESETS.triathlon;
        expect(presets.find(preset => preset.id === 'eighth_im')?.label).toContain('475 m / 22.5 km / 5.25 km');
        expect(presets.find(preset => preset.id === 'quarter_im')?.label).toContain('950 m / 45 km / 10.55 km');
        expect(presets.find(preset => preset.id === 'sprint')?.label).toBe('Sprint');
        expect(presets.find(preset => preset.id === 'olympic')?.label).toBe('Olympic');
        expect(presets.find(preset => preset.id === 'half_iron')?.label).toContain('1.9 km / 90 km / 21.1 km');
    });

    it('requires swim, bike and run aerobic exposure for triathlon demand', () => {
        const demand = EVENT_PRESETS.triathlon.find(preset => preset.id === 'quarter_im')!.demandProfile;
        const modalities = modalitiesForEventCategory('triathlon');
        expect(modalities).toEqual(['Swimming', 'Cycling', 'Running']);
        const objectives = objectivesFromDemand(demand, 'triathlon', false, false, modalities, demand);
        const disciplineAerobic = objectives.filter(objective => objective.id.startsWith('obj_tri_'));
        expect(disciplineAerobic).toHaveLength(3);
        expect(disciplineAerobic.map(objective => objective.qualification?.allowedModalities?.[0])).toEqual(['Swimming', 'Cycling', 'Running']);
    });

    it('adds long-run durability for half marathon and marathon profiles', () => {
        for (const presetId of ['half_marathon', 'marathon']) {
            const demand = EVENT_PRESETS.running_race.find(preset => preset.id === presetId)!.demandProfile;
            const objectives = objectivesFromDemand(demand, 'running_race', false, false, ['Running'], demand);
            expect(objectives.some(objective => objective.id === 'obj_running_long_durability')).toBe(true);
        }
    });

    it('makes every outdoor cycling template require a bicycle and every swim template require swim access', () => {
        const outdoorCycling = TEMPLATES.filter(template => template.modality === 'Cycling' && template.environment === 'outdoor');
        expect(outdoorCycling.length).toBeGreaterThan(0);
        expect(outdoorCycling.every(template => template.requiredEquipment.includes('outdoor_bike'))).toBe(true);

        const swimming = TEMPLATES.filter(template => template.modality === 'Swimming');
        expect(swimming.length).toBeGreaterThanOrEqual(3);
        expect(swimming.every(template => template.requiredEquipment.includes('swim_access'))).toBe(true);
    });

    it('parses legacy settings without new sport-access fields as unavailable and accepts Swimming restrictions', () => {
        const base = createDefaultTrainingSettings('athlete', '2026-08-30T05:00:00.000Z');
        const legacyEquipment = { ...base.equipment };
        delete legacyEquipment.outdoor_bike;
        delete legacyEquipment.swim_access;
        const parsed = parseTrainingSettings({
            ...base,
            equipment: legacyEquipment,
            injuries: [{ severity: 'limit', restrictedModalities: ['Swimming'] }],
        }, 'athlete');
        expect(parsed).not.toBeNull();
        expect(parsed?.equipment.outdoor_bike).toBe(false);
        expect(parsed?.equipment.swim_access).toBe(false);
        expect(parsed?.injuries?.[0].restrictedModalities).toEqual(['Swimming']);
    });
});
