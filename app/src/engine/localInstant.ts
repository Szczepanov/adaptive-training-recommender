/**
 * ADR-0036 (H4) D-TIME: resolve a local wall-clock date/time to a real instant with an
 * explicit UTC offset, fail closed on nonexistent (spring-forward gap) local times, and
 * surface ambiguous (fall-back repeated hour) local times for explicit resolution rather
 * than silently choosing an offset.
 *
 * Pure and timestamp-only: no Firestore, no wiring into any decision path, and no
 * physiological threshold. This module answers "what instant is 07:00 on this date in
 * this timezone", nothing about whether that time is safe or sufficient to train.
 *
 * No timezone library is used -- `Intl.DateTimeFormat` is enough to detect both DST edge
 * cases without one. A naive fixed-point ("guess an offset, apply it, re-read the offset
 * at the result") approach can silently converge onto just one of two valid answers
 * during a fall-back fold and never discover the other exists, so this instead samples
 * every offset the zone could plausibly be using in a window around the requested
 * wall-clock reading (a DST transition is always a single hour-aligned instant, so a
 * +-2h sample window is guaranteed to see both offsets around any transition), builds
 * the candidate instant for each distinct offset found, and keeps only the candidates
 * that actually reproduce the requested wall-clock reading when reformatted back into
 * that zone: zero surviving candidates means the local time never occurred (spring-
 * forward gap), one means an ordinary unambiguous instant, two means the fall-back fold.
 */

export interface ResolvedLocalInstant {
    status: 'resolved';
    /** ISO-8601 UTC instant, e.g. "2026-08-17T05:00:00.000Z". */
    instant: string;
    offsetMinutes: number;
}

export interface NonexistentLocalInstant {
    status: 'nonexistent';
}

export interface AmbiguousLocalInstant {
    status: 'ambiguous';
    /** Both real instants this wall-clock time could mean, earlier offset (still-daylight
     * side) first. An athlete-resolved explicit choice must pick one; this module never
     * guesses. */
    candidates: [{ instant: string; offsetMinutes: number }, { instant: string; offsetMinutes: number }];
}

export type LocalInstantResolution = ResolvedLocalInstant | NonexistentLocalInstant | AmbiguousLocalInstant;

const HHMM_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** UTC-offset minutes (east-positive, matching `Date.getTimezoneOffset`'s sign convention
 * inverted -- e.g. Europe/Warsaw is +60 in winter) the given IANA zone uses at `instantMs`. */
function offsetMinutesAt(instantMs: number, timeZone: string): number {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone,
        hourCycle: 'h23',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(new Date(instantMs));
    const get = (type: string) => Number(parts.find(p => p.type === type)?.value);
    // Reinterpret the zone's wall-clock reading of this instant as if it were UTC, then
    // diff against the real instant -- the difference is exactly the zone's offset.
    const wallAsUtcMs = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
    return Math.round((wallAsUtcMs - instantMs) / 60000);
}

/** Formats `instantMs` in `timeZone` as `{ dateStr, timeStr }` (YYYY-MM-DD / HH:mm), for
 * verifying a candidate instant actually reproduces the requested wall-clock reading. */
function wallClockAt(instantMs: number, timeZone: string): { dateStr: string; timeStr: string } {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone,
        hourCycle: 'h23',
        year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    }).formatToParts(new Date(instantMs));
    const get = (type: string) => parts.find(p => p.type === type)?.value ?? '';
    return {
        dateStr: `${get('year')}-${get('month')}-${get('day')}`,
        timeStr: `${get('hour')}:${get('minute')}`,
    };
}

/**
 * Resolves a Warsaw-local (or any IANA zone's) `dateStr` (`YYYY-MM-DD`) + `timeStr`
 * (`HH:mm`) wall-clock reading to a real instant. Never guesses across a DST boundary:
 * a nonexistent local time (the spring-forward gap) and an ambiguous one (the fall-back
 * repeated hour) are both reported explicitly rather than resolved to a default offset.
 */
export function resolveLocalInstant(dateStr: string, timeStr: string, timeZone: string = 'Europe/Warsaw'): LocalInstantResolution {
    if (!DATE_PATTERN.test(dateStr)) throw new RangeError(`dateStr must be YYYY-MM-DD, got "${dateStr}"`);
    if (!HHMM_PATTERN.test(timeStr)) throw new RangeError(`timeStr must be HH:mm, got "${timeStr}"`);

    const [year, month, day] = dateStr.split('-').map(Number);
    const [hour, minute] = timeStr.split(':').map(Number);
    const naiveUtcMs = Date.UTC(year, month - 1, day, hour, minute);

    // A DST transition is always a single hour-aligned instant shifting the offset by a
    // fixed amount (1 hour for every zone this app targets). Sampling every hour across a
    // +-2h window around the naive instant is guaranteed to observe every offset that
    // could possibly apply to this wall-clock reading, without assuming which side of a
    // transition the naive instant itself landed on -- a plain two-pass fixed-point
    // iteration can converge onto just one of two valid answers during a fall-back fold
    // and never discover the other one exists.
    const distinctOffsets = new Set<number>();
    for (let hourOffset = -2; hourOffset <= 2; hourOffset += 1) {
        distinctOffsets.add(offsetMinutesAt(naiveUtcMs + hourOffset * 3600000, timeZone));
    }

    const matches: { instant: number; offsetMinutes: number }[] = [];
    for (const offsetMinutes of distinctOffsets) {
        const candidateInstant = naiveUtcMs - offsetMinutes * 60000;
        const wall = wallClockAt(candidateInstant, timeZone);
        if (wall.dateStr === dateStr && wall.timeStr === timeStr) {
            matches.push({ instant: candidateInstant, offsetMinutes });
        }
    }
    // Two different offsets can independently round-trip to the same candidate instant
    // (each offset is only actually valid within its own window), so de-duplicate by the
    // resolved instant itself before deciding resolved/ambiguous/nonexistent.
    const uniqueMatches = [...new Map(matches.map(m => [m.instant, m])).values()].sort((a, b) => a.instant - b.instant);

    if (uniqueMatches.length === 0) return { status: 'nonexistent' };
    if (uniqueMatches.length === 1) {
        return { status: 'resolved', instant: new Date(uniqueMatches[0].instant).toISOString(), offsetMinutes: uniqueMatches[0].offsetMinutes };
    }
    // Fall-back: the same wall-clock reading occurs twice. Earlier real instant (the
    // still-daylight side) first.
    const [first, second] = uniqueMatches;
    return {
        status: 'ambiguous',
        candidates: [
            { instant: new Date(first.instant).toISOString(), offsetMinutes: first.offsetMinutes },
            { instant: new Date(second.instant).toISOString(), offsetMinutes: second.offsetMinutes },
        ],
    };
}

/**
 * Prospective separation is "start minus the predecessor's actual end instant", never
 * start-to-start, calendar-day distance or an AM/PM label (ADR-0036 D-TIME). Returns
 * whole minutes; a negative result means `endInstant` is after `startInstant`.
 */
export function elapsedMinutesBetweenInstants(startInstant: string, endInstant: string): number {
    return Math.round((Date.parse(startInstant) - Date.parse(endInstant)) / 60000);
}
