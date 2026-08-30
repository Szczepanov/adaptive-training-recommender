import { describe, expect, it } from 'vitest';
import {
    deduplicateByLineage,
    evaluateAnchorLineageIndependence,
    groupByLineage,
    isLineageIndependent,
} from './identityLineage';
import type { ObservationBundleRef } from '../observations/identityModels';

function ref(overrides: Partial<ObservationBundleRef> = {}): ObservationBundleRef {
    return {
        id: 'ref-1',
        provider: 'garmin',
        transport: 'garmin_direct',
        revision: 1,
        sourcePayloadHash: 'sha256:abc',
        lineageKey: 'garmin:device:xyz',
        ...overrides,
    };
}

describe('identityLineage (PI2, ADR-0028 P-PI-13)', () => {
    describe('isLineageIndependent', () => {
        it('is independent when lineage keys differ', () => {
            const a = ref({ lineageKey: 'garmin:device:xyz' });
            const b = ref({ id: 'ref-2', provider: 'eight_sleep', lineageKey: 'eight_sleep:pod-side:abc' });
            expect(isLineageIndependent(a, b)).toBe(true);
        });

        it('K. mirrored evidence: same upstream Garmin signal re-exported by another transport is dependent', () => {
            const garminDirect = ref({ id: 'ref-1', provider: 'garmin', transport: 'garmin_direct' });
            const reExported = ref({
                id: 'ref-2',
                provider: 'garmin',
                transport: 'third_party_aggregator',
                // Same lineageKey: it is the *same* upstream sensor lineage, just a different transport.
                lineageKey: garminDirect.lineageKey,
            });

            expect(isLineageIndependent(garminDirect, reExported)).toBe(false);
        });

        it('provider/transport difference alone is not proof of independence', () => {
            const a = ref({ provider: 'garmin', transport: 'garmin_direct', lineageKey: 'shared-lineage' });
            const b = ref({ provider: 'garmin', transport: 'google_health', lineageKey: 'shared-lineage' });
            expect(isLineageIndependent(a, b)).toBe(false);
        });
    });

    describe('evaluateAnchorLineageIndependence', () => {
        it('returns independent anchors with no reason codes when lineage differs', () => {
            const shared = ref({ id: 'shared', provider: 'eight_sleep', lineageKey: 'eight_sleep:pod-side:abc' });
            const anchor = ref({ id: 'anchor', provider: 'garmin', lineageKey: 'garmin:device:xyz' });

            const result = evaluateAnchorLineageIndependence([anchor], shared);
            expect(result.independentAnchorRefs).toEqual([anchor]);
            expect(result.dependentAnchorRefs).toEqual([]);
            expect(result.reasonCodes).toEqual([]);
        });

        it('excludes a dependent anchor and emits EVIDENCE_LINEAGE_DEPENDENT', () => {
            const shared = ref({ id: 'shared', lineageKey: 'garmin:device:xyz' });
            const dependentAnchor = ref({ id: 'anchor', lineageKey: 'garmin:device:xyz' });

            const result = evaluateAnchorLineageIndependence([dependentAnchor], shared);
            expect(result.independentAnchorRefs).toEqual([]);
            expect(result.dependentAnchorRefs).toEqual([dependentAnchor]);
            expect(result.reasonCodes).toEqual(['EVIDENCE_LINEAGE_DEPENDENT']);
        });

        it('keeps an independent anchor even when another candidate anchor is dependent', () => {
            const shared = ref({ id: 'shared', lineageKey: 'eight_sleep:pod-side:abc' });
            const independentAnchor = ref({ id: 'anchor-1', lineageKey: 'garmin:device:xyz' });
            const dependentAnchor = ref({ id: 'anchor-2', lineageKey: 'eight_sleep:pod-side:abc' });

            const result = evaluateAnchorLineageIndependence([independentAnchor, dependentAnchor], shared);
            expect(result.independentAnchorRefs).toEqual([independentAnchor]);
            expect(result.dependentAnchorRefs).toEqual([dependentAnchor]);
            expect(result.reasonCodes).toEqual(['EVIDENCE_LINEAGE_DEPENDENT']);
        });
    });

    describe('groupByLineage / deduplicateByLineage', () => {
        it('groups mirrored refs under one lineage key', () => {
            const original = ref({ id: 'a', revision: 1, lineageKey: 'garmin:device:xyz' });
            const mirror = ref({ id: 'b', revision: 1, provider: 'garmin', transport: 'aggregator', lineageKey: 'garmin:device:xyz' });
            const distinct = ref({ id: 'c', lineageKey: 'eight_sleep:pod-side:abc' });

            const groups = groupByLineage([original, mirror, distinct]);
            expect(groups).toHaveLength(2);
            expect(groups[0].refs).toEqual([original, mirror]);
            expect(groups[1].refs).toEqual([distinct]);
        });

        it('deduplicates to one representative per lineage, preferring the highest revision', () => {
            const stale = ref({ id: 'a', revision: 1, lineageKey: 'garmin:device:xyz' });
            const fresh = ref({ id: 'b', revision: 2, lineageKey: 'garmin:device:xyz' });

            expect(deduplicateByLineage([stale, fresh])).toEqual([fresh]);
        });

        it('breaks a revision tie deterministically by id', () => {
            const b = ref({ id: 'b', revision: 1, lineageKey: 'garmin:device:xyz' });
            const a = ref({ id: 'a', revision: 1, lineageKey: 'garmin:device:xyz' });

            expect(deduplicateByLineage([b, a])).toEqual([a]);
            expect(deduplicateByLineage([a, b])).toEqual([a]); // order-independent
        });

        it('is a no-op when every ref is already lineage-independent', () => {
            const refs = [
                ref({ id: 'a', lineageKey: 'garmin:device:xyz' }),
                ref({ id: 'b', lineageKey: 'eight_sleep:pod-side:abc' }),
            ];
            expect(deduplicateByLineage(refs)).toEqual(refs);
        });
    });
});
