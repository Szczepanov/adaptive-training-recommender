import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProgressionBlockEditor } from './ProgressionBlockEditor';
import { buildBlock, defaultDraft } from './progressionBlockDraft';
import { validateIntentBlock } from '../engine/blockIntent';
import { SELECTION_WIRED_COVERAGE_KEYS } from '../engine/confirmedProgressionOverrides';

const TODAY = '2026-09-01';

describe('ProgressionBlockEditor', () => {
    it('renders the form with its default fields', () => {
        const html = renderToStaticMarkup(<ProgressionBlockEditor userId="u1" />);
        expect(html).toContain('New progression block');
        expect(html).toContain('Track a bounded progression target for this objective');
    });

    it('builds a valid IntentBlock from the default draft without progression tracking', () => {
        const block = buildBlock(defaultDraft(TODAY));
        expect(validateIntentBlock(block)).toEqual({ valid: true, issues: [] });
        expect(block.progressionContract).toBeUndefined();
    });

    it('builds a valid IntentBlock with progression tracking enabled', () => {
        const block = buildBlock({ ...defaultDraft(TODAY), trackProgression: true });
        const validation = validateIntentBlock(block);
        expect(validation).toEqual({ valid: true, issues: [] });
        expect(block.progressionContract?.currentValue).toBe(defaultDraft(TODAY).doseTarget);
    });

    it('is self-sourced with sourcePlanId equal to its own block id, per the manual-authoring identity', () => {
        const block = buildBlock(defaultDraft(TODAY));
        expect(block.sourcePlanId).toBe(block.id);
        expect(block.sourcePlanRevision).toBe(1);
    });

    it('omits the optional title field entirely when left blank, rather than persisting an empty string', () => {
        const block = buildBlock(defaultDraft(TODAY));
        expect('title' in block).toBe(false);
    });

    it('keeps the block-level and progression-contract review cadence in agreement, as validateIntentBlock requires', () => {
        const draft = { ...defaultDraft(TODAY), trackProgression: true, reviewCadenceDays: 21 };
        const block = buildBlock(draft);
        expect(block.progressionContract?.reviewCadenceDays).toBe(21);
        expect(validateIntentBlock(block).valid).toBe(true);
    });

    it('defaults to a coverage key already wired into evergreen selection, so the unsupported notice does not fire unprompted', () => {
        expect(SELECTION_WIRED_COVERAGE_KEYS).toContain(defaultDraft(TODAY).coverageKey);
    });
});
