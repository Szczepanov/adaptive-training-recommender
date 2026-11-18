import { describe, expect, it } from 'vitest';
import { jumpMeasureFor } from './jumpMeasure';

const catalog = (exerciseId: string) => ({ exerciseRef: { kind: 'catalog' as const, exerciseId } });
const freeText = (name: string) => ({ exerciseRef: { kind: 'unresolved_free_text' as const, name } });

describe('jumpMeasureFor', () => {
    it('records height for vertical catalog jumps and distance for horizontal or lateral ones', () => {
        expect(jumpMeasureFor(catalog('countermovement_jump'))).toBe('height');
        expect(jumpMeasureFor(catalog('drop_jump_low'))).toBe('height');
        expect(jumpMeasureFor(catalog('broad_jump'))).toBe('distance');
        expect(jumpMeasureFor(catalog('lateral_bound_stick'))).toBe('distance');
        expect(jumpMeasureFor(catalog('single_leg_hop_stick'))).toBe('distance');
    });

    it('records nothing for non-jumping exercises', () => {
        expect(jumpMeasureFor(catalog('back_squat'))).toBeNull();
        expect(jumpMeasureFor(catalog('farmer_carry'))).toBeNull();
        expect(jumpMeasureFor(freeText('Back extension'))).toBeNull();
        expect(jumpMeasureFor(freeText('Jumping jacks'))).toBeNull();
        expect(jumpMeasureFor(freeText('Jump rope'))).toBeNull();
        expect(jumpMeasureFor(freeText('Jump-rope intervals'))).toBeNull();
    });

    it('falls back to the free-text name', () => {
        expect(jumpMeasureFor(freeText('Box jump'))).toBe('height');
        expect(jumpMeasureFor(freeText('Standing broad jump'))).toBe('distance');
        expect(jumpMeasureFor(freeText('Single-leg hop'))).toBe('distance');
        expect(jumpMeasureFor(freeText('single leg hop and stick'))).toBe('distance');
    });
});
