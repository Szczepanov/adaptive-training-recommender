import { describe, expect, it } from 'vitest';
import { archivedSavedDefinitionError } from './sessionLaunch';

// M4.3 follow-up: SessionRunner's startCompanion resolves a saved definition by header the
// same way startSavedDefinition does, so both must reject the same archived headers -- see
// the shared guard's usage in both flows in SessionRunner.tsx.
describe('archivedSavedDefinitionError', () => {
    it('rejects an archived header', () => {
        expect(archivedSavedDefinitionError({ status: 'archived' }, 'This template'))
            .toBe('This template is archived -- restore it before starting.');
    });

    it('allows an active header', () => {
        expect(archivedSavedDefinitionError({ status: 'active' }, 'This template')).toBeNull();
    });

    it('allows a header with no status (pre-lifecycle headers default to active)', () => {
        expect(archivedSavedDefinitionError({}, 'This template')).toBeNull();
    });
});
