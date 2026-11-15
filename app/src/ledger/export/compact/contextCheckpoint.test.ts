import { describe, expect, it } from 'vitest';
import { buildLedgerExport } from '../buildLedgerExport.ts';
import { fullInput } from '../ledgerExportFixtures.testSupport.ts';
import {
    CHECKPOINT_FORMAT_VERSION,
    mergeCheckpoint,
    userContextCheckpoint,
    userContextItemHashes,
    type PreviousContext,
} from './contextCheckpoint.ts';

const build = () => buildLedgerExport(fullInput({ purpose: 'morning' }));
const confirmed = (ledger = build()): PreviousContext => ({ ...userContextCheckpoint(ledger), exportedOn: '2026-11-19' });
const keysOf = (hashes: Readonly<Record<string, string>>, name: string) =>
    Object.keys(hashes).filter(key => key === name || key.startsWith(`${name}/`));

describe('userContextCheckpoint', () => {
    it('carries the format version and a scope and completeness for every user-context name', () => {
        const ledger = build();
        const checkpoint = userContextCheckpoint(ledger);
        const start = ledger.window.startDate;
        expect(checkpoint.formatVersion).toBe(CHECKPOINT_FORMAT_VERSION);
        expect(Object.keys(checkpoint.collections).sort()).toEqual(Object.keys(ledger.userContext).sort());
        expect(checkpoint.collections.availability).toEqual({ scope: `from:${start}`, complete: true, from: start });
        expect(checkpoint.collections.injuries).toEqual({ scope: `active+resolved-from:${start}`, complete: true, from: start });
        expect(checkpoint.collections.goals).toEqual({ scope: 'all-active', complete: true });
        expect(checkpoint.collections.equipment).toEqual({ scope: 'current', complete: true });
        expect(checkpoint.itemHashes).toEqual(userContextItemHashes(ledger));
    });

    it('stores the date each windowed item is selected by, and none for unbounded items', () => {
        const { selectionDates } = userContextCheckpoint(build());
        expect(selectionDates).toMatchObject({
            'availability/window-win-1': '2026-11-21',
            'availability/fixed-fx-1': '2026-11-26',
            'events/block-ib-1': '2026-12-14',
            'events/goal-goal-1': '2027-04-18',
            'travel/block-1': '2026-11-28',
            'venueRestrictions/fx-1': '2026-11-26',
        });
        expect(Object.keys(selectionDates).filter(key => /^(goals|constraints)\//.test(key))).toEqual([]);
        // An active injury is selected regardless of date.
        expect(selectionDates['injuries/injury-001']).toBeUndefined();
    });

    it('is complete only for a measured read with nothing omitted', () => {
        const failed = build();
        failed.userContext.goals.state = 'unavailable';
        const omitted = build();
        omitted.userContext.availability.droppedUndated = 2;
        const staleSettings = build();
        staleSettings.sources = staleSettings.sources.map(source =>
            source.source === 'training_settings' ? { ...source, state: 'stale' } : source);
        expect(userContextCheckpoint(failed).collections.goals.complete).toBe(false);
        expect(userContextCheckpoint(omitted).collections.availability.complete).toBe(false);
        expect(userContextCheckpoint(staleSettings).collections.equipment.complete).toBe(false);
        const failedDislikes = build();
        failedDislikes.userContext.trainingDislikes = { value: null, source: 'athlete', state: 'unavailable' };
        expect(userContextCheckpoint(failedDislikes).collections.trainingDislikes.complete).toBe(false);
        // No source exists to read; the schema fixes its state.
        expect(userContextCheckpoint(build()).collections.trainingDislikes.complete).toBe(true);
    });

    it('hashes the semantic date and ignores export and read timestamps', () => {
        const a = build();
        const dated = build();
        dated.userContext.availability.items[0].observedOn = '2020-01-01';
        const stamped = build();
        stamped.exportedAt = '2030-01-01T00:00:00Z';
        stamped.sources = stamped.sources.map(source => ({ ...source, readAt: '2030-01-01T00:00:00Z' }));
        const key = `availability/${a.userContext.availability.items[0].id}`;
        expect(userContextItemHashes(dated)[key]).not.toBe(userContextItemHashes(a)[key]);
        expect(userContextItemHashes(stamped)).toEqual(userContextItemHashes(a));
    });
});

describe('mergeCheckpoint', () => {
    it('a complete read replaces the collection; the result is the current format', () => {
        const ledger = build();
        const current = userContextCheckpoint(ledger);
        const merged = mergeCheckpoint(undefined, current, '2026-11-20');
        expect(merged.formatVersion).toBe(CHECKPOINT_FORMAT_VERSION);
        expect(merged.exportedOn).toBe('2026-11-20');
        expect(merged.collections).toEqual(current.collections);
        expect(merged.itemHashes).toEqual(current.itemHashes);
    });

    it('a failed read keeps the prior hashes and metadata for that collection', () => {
        const prior = confirmed();
        const now = build();
        now.userContext.goals.items = [];
        now.userContext.goals.state = 'unavailable';
        const merged = mergeCheckpoint(prior, userContextCheckpoint(now), '2026-11-20');
        const goalKeys = keysOf(prior.itemHashes, 'goals');
        expect(goalKeys.length).toBeGreaterThan(0);
        for (const key of goalKeys) expect(merged.itemHashes[key]).toBe(prior.itemHashes[key]);
        expect(merged.collections.goals).toEqual(prior.collections.goals);
    });

    it('a truncated read keeps prior hashes for absent items and takes current hashes for present ones', () => {
        const prior = confirmed();
        const now = build();
        now.userContext.availability.droppedUndated = 1;
        const [absent, ...present] = now.userContext.availability.items;
        present[0].fields.startLocal.value = '05:00';
        now.userContext.availability.items = present;
        const current = userContextCheckpoint(now);
        const merged = mergeCheckpoint(prior, current, '2026-11-20');
        expect(keysOf(merged.itemHashes, 'availability')).toEqual(keysOf(prior.itemHashes, 'availability'));
        const absentKey = `availability/${absent.id}`;
        const presentKey = `availability/${present[0].id}`;
        expect(merged.itemHashes[absentKey]).toBe(prior.itemHashes[absentKey]);
        expect(merged.itemHashes[presentKey]).toBe(current.itemHashes[presentKey]);
        expect(merged.itemHashes[presentKey]).not.toBe(prior.itemHashes[presentKey]);
        expect(merged.selectionDates[absentKey]).toBe(prior.selectionDates[absentKey]);
        expect(merged.collections.availability).toEqual(prior.collections.availability);
    });

    it('an incomplete read with no prior stores nothing for that collection', () => {
        const now = build();
        now.userContext.goals.state = 'unavailable';
        const merged = mergeCheckpoint(undefined, userContextCheckpoint(now), '2026-11-20');
        expect(keysOf(merged.itemHashes, 'goals')).toEqual([]);
        expect(merged.collections.goals).toBeUndefined();
    });

    it('a prior checkpoint of another format version is not merged', () => {
        const prior = { ...confirmed(), formatVersion: CHECKPOINT_FORMAT_VERSION + 1 };
        const now = build();
        now.userContext.goals.state = 'unavailable';
        const merged = mergeCheckpoint(prior, userContextCheckpoint(now), '2026-11-20');
        expect(keysOf(merged.itemHashes, 'goals')).toEqual([]);
    });
});
