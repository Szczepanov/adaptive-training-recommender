import { describe, expect, it } from 'vitest';
import { getFamilyEdges } from '../edges.mjs';

describe('edges module', () => {
  const expectedFamilies = [
    'objective_recovery',
    'subjective_recovery',
    'recent_training',
    'event_proximity',
    'preferences_capacity',
    'event_demand',
    'interactions',
    'delivered_dose_variance',
    'concurrent_strength_endurance',
    'injury_constraints',
    'planning_modes_overlays',
  ];

  it('defines comparison edges for all 11 sensitivity families', () => {
    for (const familyId of expectedFamilies) {
      const edges = getFamilyEdges(familyId);
      expect(edges.length).toBeGreaterThan(0);
      for (const edge of edges) {
        expect(edge.from).toBeDefined();
        expect(edge.to).toBeDefined();
        expect(edge.from).not.toBe(edge.to); // No self-loops
        expect(edge.axis).toBeDefined();
        expect(edge.expectedDirection).toBeDefined();
      }
    }
  });

  it('returns empty array for unknown family', () => {
    expect(getFamilyEdges('unknown_family')).toEqual([]);
  });
});
